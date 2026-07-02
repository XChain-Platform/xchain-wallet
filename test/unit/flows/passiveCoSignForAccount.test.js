// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: passiveCoSignForAccount (§22, P4 slice 2b). Exercises this flow's
// orchestration: account load, enabled + panic gates (before unlock), key
// derivation -> passiveCoSign -> window flush, key zeroed.
//
// `withUnlocked` is stubbed to hand the callback a fake signer whose
// exportWifForPath returns a real (test-dummy) WIF, so decodeWif and
// passiveCoSign run for real. The real unlock + WIF export is covered by the
// exportPrivateKey / SoftwareSigner suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test-dummy key (0x09 * 32) and its mainnet compressed WIF. Not a real
// secret: a fixed vector so decodeWif recovers exactly these 32 bytes.
const TEST_WIF = 'KwXGs3HkgjKA5exN3UiMQtGQakRrJ9zysFDa4rY4dcEdqeerF1tF';
const TEST_KEY_HEX = '09'.repeat(32);

let unlockCalls = 0;
vi.mock('../../../packages/core/src/flows/unlockWallet.js', () => ({
    withUnlocked: async (_opts, fn) => {
        unlockCalls += 1;
        return fn({
            exportWifForPath: () => TEST_WIF,
            lock: () => {},
        });
    },
}));

import { passiveCoSignForAccount } from '../../../packages/core/src/flows/passiveCoSignForAccount.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import {
    activatePanicMode,
    deactivatePanicMode,
} from '../../../packages/core/src/flows/panicMode.js';

const MASTER_KEY = new Uint8Array(32).fill(7);
const chainRegistry = { get: () => ({ coin: 'bitcoin' }) };

function accountInput(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        name: 'Agent',
        aggregateAddress: 'bc1pagg',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
        allowedOutputs: [],
        ...overrides,
    };
}

// A mock sdk.coSigner.CoSigner capturing the secret key it was handed and
// (on approval) recording a budget entry so the flow's flush persists it.
function mockSdkRegistry(verdict, { recordBudget = false } = {}) {
    const seen = {};
    const sdk = {
        coSigner: {
            CoSigner: class {
                constructor(config) {
                    seen.secretKeyHex = Buffer.from(config.secretKey).toString('hex');
                    seen.publicKeys = config.publicKeys;
                    seen.windowStore = config.windowStore;
                    seen.tweaks = config.tweaks;
                }
                process() {
                    if (recordBudget && seen.windowStore) {
                        seen.windowStore.snapshot();
                        seen.windowStore.record({ action: 'SEND', tick: 'X', amount: '1', txid: 'tx1' });
                    }
                    return verdict;
                }
            },
        },
    };
    return { sdkRegistry: { get: () => sdk }, seen };
}

/** @type {Vault} */
let vault;
let account;
beforeEach(async () => {
    unlockCalls = 0;
    vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
    await vault.open();
    account = createCoSignerAccount(accountInput());
    await vault.coSignerAccounts.put(account);
});
afterEach(() => {
    deactivatePanicMode();
});

describe('passiveCoSignForAccount validation', () => {
    it('rejects missing required inputs', async () => {
        const { sdkRegistry } = mockSdkRegistry({ approved: false });
        await expect(passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: '', password: 'p', request: { psbt: 'aa' } }))
            .rejects.toThrow(/accountId/);
        await expect(passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: account.id, password: '', request: { psbt: 'aa' } }))
            .rejects.toThrow(/password/);
        await expect(passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: account.id, password: 'p', request: {} }))
            .rejects.toThrow(/psbt/);
    });

    it('throws for an unknown account', async () => {
        const { sdkRegistry } = mockSdkRegistry({ approved: false });
        await expect(passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: 'nope', password: 'p', request: { psbt: 'aa' } }))
            .rejects.toThrow(/no co-signer account/);
    });
});

describe('passiveCoSignForAccount gates (before unlock)', () => {
    it('refuses a disabled account without unlocking', async () => {
        await vault.coSignerAccounts.put({ ...account, enabled: false });
        const { sdkRegistry } = mockSdkRegistry({ approved: true });
        const res = await passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: account.id, password: 'pw', request: { psbt: 'aa' } });
        expect(res).toEqual({ approved: false, reason: 'ACCOUNT_DISABLED', detail: { accountId: account.id } });
        expect(unlockCalls).toBe(0);
    });

    it('refuses while panic mode is active without unlocking', async () => {
        activatePanicMode({ durationMs: 60 * 60 * 1000 });
        const { sdkRegistry } = mockSdkRegistry({ approved: true });
        const res = await passiveCoSignForAccount({ vault, chainRegistry, sdkRegistry, accountId: account.id, password: 'pw', request: { psbt: 'aa' } });
        expect(res.approved).toBe(false);
        expect(res.reason).toBe('PANIC_MODE');
        expect(unlockCalls).toBe(0);
    });
});

describe('passiveCoSignForAccount decision path', () => {
    it('derives the daemon key, runs the co-sign, and persists the window budget', async () => {
        const approved = { approved: true, publicNonce: 'aa', sig: 'bb', msg: 'cc', action: 'SEND' };
        const { sdkRegistry, seen } = mockSdkRegistry(approved, { recordBudget: true });

        const res = await passiveCoSignForAccount({
            vault, chainRegistry, sdkRegistry, accountId: account.id, password: 'pw',
            request: { psbt: 'aabbcc', agentPublicNonce: '03' + 'c'.repeat(130) },
        });

        expect(res).toEqual(approved);
        expect(unlockCalls).toBe(1);
        // the co-signer received the decoded 32-byte daemon key and the account's pubkeys.
        expect(seen.secretKeyHex).toBe(TEST_KEY_HEX);
        expect(seen.publicKeys).toBe(account.publicKeyOrder);
        expect(seen.tweaks).toEqual([]); // 2-of-2 key-path: no tweak
        // budget flushed onto the account record.
        const reloaded = await vault.coSignerAccounts.get(account.id);
        expect(reloaded.window.entries).toHaveLength(1);
        expect(reloaded.window.entries[0]).toMatchObject({ action: 'SEND', tick: 'X', amount: '1' });
    });

    it('relays a CoSigner denial verdict unchanged', async () => {
        const denial = { approved: false, reason: 'POLICY_ACTION_DENIED', detail: { action: 'ISSUE' } };
        const { sdkRegistry } = mockSdkRegistry(denial);
        const res = await passiveCoSignForAccount({
            vault, chainRegistry, sdkRegistry, accountId: account.id, password: 'pw', request: { psbt: 'aabb' },
        });
        expect(res).toEqual(denial);
    });
});
