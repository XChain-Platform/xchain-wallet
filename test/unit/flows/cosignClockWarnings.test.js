// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A spending window written in the future means the host clock stepped
// backward. The warning must reach the owner (local log, approval preview)
// and must never ride the verdict relayed to the requester.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import { previewCoSignRequest } from '../../../packages/core/src/flows/previewCoSignRequest.js';
import {
    VaultWindowStore,
    createInMemoryWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowStore.js';
import { logConsole } from '../../../packages/core/src/shared/utils/logConsole.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const POLICY = { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } };
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };
const NOW = 5_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const FUTURE_STATE = { version: 1, entries: [{ t: NOW + HOUR, amount: '1' }] };

function mockSdk(verdict) {
    return {
        coSigner: {
            CoSigner: class {
                process() { return verdict; }
            },
        },
    };
}

const clockEntries = () => logConsole.entries().filter((e) => e.source === 'cosigner');

beforeEach(() => logConsole.clear());
afterEach(() => logConsole.clear());

describe('passiveCoSign reports a host clock fault to the local log only', () => {
    it('logs one warning per anomaly and leaves the verdict untouched', async () => {
        const windowStore = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence(FUTURE_STATE),
            hours: 24,
            now: () => NOW,
        });
        const approved = { approved: true, publicNonce: 'aa', sig: 'bb', msg: 'cc', action: 'SEND' };
        const result = await passiveCoSign({
            sdk: mockSdk(approved), secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY,
            windowStore, request: REQUEST,
        });

        expect(result).toEqual(approved);
        const warned = clockEntries();
        expect(warned).toHaveLength(1);
        expect(warned[0].level).toBe('warn');
        expect(warned[0].message).toMatch(/clamped/);
    });

    it('logs nothing when the window state is consistent with the clock', async () => {
        const windowStore = new VaultWindowStore({
            persistence: createInMemoryWindowPersistence({ version: 1, entries: [{ t: NOW - HOUR, amount: '1' }] }),
            hours: 24,
            now: () => NOW,
        });
        await passiveCoSign({
            sdk: mockSdk({ approved: false, reason: 'POLICY_ACTION_DENIED' }),
            secretKey: KEY, publicKeys: PUBKEYS, policy: POLICY, windowStore, request: REQUEST,
        });
        expect(clockEntries()).toEqual([]);
    });
});

describe('previewCoSignRequest carries window clock warnings to the approval screen', () => {
    let vault;
    let account;
    const sdkRegistry = {
        get: () => ({
            wallet: { getBitcoinNetwork: () => ({ bech32: 'bcrt' }) },
            coSigner: {
                decodeActionFromPsbt: () => ({ ok: true, action: 'SEND', params: {} }),
                evaluatePolicy: () => ({ ok: true, violation: null, evaluation: { action: 'SEND', destinations: [] } }),
            },
        }),
    };

    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();
        account = createCoSignerAccount({
            walletId: 'wallet-1',
            chainId: 'bitcoin-regtest',
            name: 'Agent',
            aggregateAddress: 'bcrt1pagg',
            agentPubkey: PUBKEYS[0],
            daemonPubkey: PUBKEYS[1],
            daemonDerivationPath: "m/86'/0'/0'/0/0",
            publicKeyOrder: PUBKEYS,
            policy: POLICY,
            allowedOutputs: [],
        });
        await vault.coSignerAccounts.put({ ...account, window: FUTURE_STATE });
    });

    it('lists the warnings for a future-dated window', async () => {
        const preview = await previewCoSignRequest({
            vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' }, now: () => NOW,
        });
        expect(preview.clockWarnings).toHaveLength(1);
        expect(preview.clockWarnings[0]).toMatch(/clamped/);
    });

    it('lists none when the window matches the clock', async () => {
        const preview = await previewCoSignRequest({
            vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' }, now: () => NOW + 2 * HOUR,
        });
        expect(preview.clockWarnings).toEqual([]);
    });
});
