// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: passiveCoSign orchestration (§22, P4). Tested against a mock
// sdk.coSigner.CoSigner (the wallet layer's job is the orchestration:
// panic gate, load-before-process, flush-after, fail-closed verdicts; the
// partial-signing cryptography is the SDK's own tested responsibility).

import { describe, it, expect, afterEach } from 'vitest';
import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import {
    VaultWindowStore,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';
import {
    activatePanicMode,
    deactivatePanicMode,
} from '../../../packages/core/src/flows/panicMode.js';

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const POLICY = { allowedActions: ['SEND'] };
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };

// A mock CoSigner that consults the window store (so a missing load() would
// throw) and records a budget entry on approval (so flush() has work to do).
function mockSdk(verdict, { onProcess } = {}) {
    const calls = [];
    const sdk = {
        coSigner: {
            CoSigner: class {
                constructor(config) { this.config = config; calls.push({ phase: 'construct', config }); }
                process(req) {
                    calls.push({ phase: 'process', req });
                    if (onProcess) onProcess(this.config, req);
                    return verdict;
                }
            },
        },
    };
    return { sdk, calls };
}

afterEach(() => {
    deactivatePanicMode();
});

describe('passiveCoSign validation', () => {
    it('rejects missing sdk.coSigner.CoSigner', async () => {
        await expect(passiveCoSign({ sdk: {}, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST }))
            .rejects.toThrow(/sdk.coSigner.CoSigner/);
    });
    it('rejects a non-32-byte secret key', async () => {
        const { sdk } = mockSdk({ approved: false });
        await expect(passiveCoSign({ sdk, secretKey: new Uint8Array(16), publicKeys: PUBKEYS, policy: POLICY, request: REQUEST }))
            .rejects.toThrow(/32-byte/);
    });
    it('rejects a policy without allowedActions', async () => {
        const { sdk } = mockSdk({ approved: false });
        await expect(passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: {}, request: REQUEST }))
            .rejects.toThrow(/allowedActions/);
    });
    it('rejects a request without a psbt', async () => {
        const { sdk } = mockSdk({ approved: false });
        await expect(passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: {} }))
            .rejects.toThrow(/psbt/);
    });
});

describe('passiveCoSign approval path', () => {
    it('loads the window before process(), returns the verdict, and flushes the consumed budget', async () => {
        const persistence = createInMemoryWindowPersistence(null);
        const windowStore = new VaultWindowStore({ persistence, hours: 24, now: () => 5_000_000_000_000 });
        const approved = { approved: true, publicNonce: 'aa', sig: 'bb', msg: 'cc', action: 'SEND' };
        // process() reads the snapshot (throws if load() was skipped) and records a budget entry.
        const { sdk, calls } = mockSdk(approved, {
            onProcess: (config) => {
                config.windowStore.snapshot();
                config.windowStore.record({ action: 'SEND', tick: 'X', amount: '3', txid: 'tx1' });
            },
        });

        const result = await passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
            windowStore, request: REQUEST,
        });

        expect(result).toEqual(approved);
        // CoSigner was constructed with the window store and our config.
        const construct = calls.find((c) => c.phase === 'construct');
        expect(construct.config.windowStore).toBe(windowStore);
        expect(construct.config.publicKeys).toBe(PUBKEYS);
        // budget was flushed to persistence.
        expect(persistence.dump().entries).toHaveLength(1);
        expect(persistence.dump().entries[0]).toMatchObject({ action: 'SEND', tick: 'X', amount: '3', txid: 'tx1' });
    });

    it('passes recoveryPublicKey / network / allowedOutputs / allowConfirmable through to the CoSigner', async () => {
        const recoveryPublicKey = '02' + 'c'.repeat(64);
        const allowedOutputs = [{ address: 'bc1qexample', maxValue: 1000 }];
        const { sdk, calls } = mockSdk({ approved: false, reason: 'POLICY_ACTION_DENIED' });
        await passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST,
            recoveryPublicKey, network: { name: 'regtest' }, allowedOutputs, allowConfirmable: true,
        });
        const cfg = calls.find((c) => c.phase === 'construct').config;
        expect(cfg.recoveryPublicKey).toBe(recoveryPublicKey);
        // A raw taproot tweak is not a configuration surface at all any more: it
        // is an unverifiable commitment to a script tree the daemon cannot
        // inspect, so it must never be forwarded (G3).
        expect(cfg.tweaks).toBeUndefined();
        expect(cfg.allowedOutputs).toBe(allowedOutputs);
        expect(cfg.allowConfirmable).toBe(true);
        expect(cfg.network).toEqual({ name: 'regtest' });
    });

    it('relays a CoSigner denial verdict unchanged', async () => {
        const denial = { approved: false, reason: 'UNAUTHORIZED_OUTPUT', detail: { index: 1, value: 50000 } };
        const { sdk } = mockSdk(denial);
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST });
        expect(result).toEqual(denial);
    });
});

describe('passiveCoSign fail-closed paths', () => {
    it('refuses while panic mode is active without calling the CoSigner', async () => {
        const { sdk, calls } = mockSdk({ approved: true });
        activatePanicMode({ durationMs: 60 * 60 * 1000 });
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, request: REQUEST });
        expect(result.approved).toBe(false);
        expect(result.reason).toBe('PANIC_MODE');
        expect(calls.find((c) => c.phase === 'process')).toBeUndefined();
    });

    it('refuses with WINDOW_STATE_CORRUPT when the window fails to load', async () => {
        const corrupt = new VaultWindowStore({
            persistence: { async read() { throw new Error('unreadable'); }, async write() {} },
            hours: 24,
        });
        const { sdk, calls } = mockSdk({ approved: true });
        const result = await passiveCoSign({
            sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
            windowStore: corrupt, request: REQUEST,
        });
        expect(result.approved).toBe(false);
        expect(result.reason).toBe('WINDOW_STATE_CORRUPT');
        expect(calls.find((c) => c.phase === 'process')).toBeUndefined();
    });
});
