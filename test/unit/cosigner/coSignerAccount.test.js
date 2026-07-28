// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: CoSignerAccount schema + Vault collection + the Vault-backed window
// persistence adapter (§22, P4 passive co-signer, slice 2).

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    createCoSignerAccount,
    validateCoSignerAccount,
} from '../../../packages/core/src/schemas/coSignerAccount.js';
import {
    createVaultWindowPersistence,
    buildAccountWindowStore,
    VaultWindowStore,
} from '../../../packages/core/src/cosigner/index.js';

const MASTER_KEY = new Uint8Array(32).fill(7);

function baseInput(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        name: 'Trading agent',
        aggregateAddress: 'bc1pexampleaggregate',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        recoveryPublicKey: '02' + 'c'.repeat(64),
        policy: { allowedActions: ['send'], maxPerWindow: { hours: 24, maxActions: 10 } },
        allowedOutputs: [{ address: 'bc1qfee', maxValue: 1000 }],
        ...overrides,
    };
}

describe('coSignerAccount schema', () => {
    it('creates a valid, normalized record', () => {
        const rec = createCoSignerAccount(baseInput());
        expect(rec.schemaVersion).toBe(1);
        expect(rec.id).toBeTruthy();
        expect(rec.policy.allowedActions).toEqual(['SEND']); // uppercased
        expect(rec.agentPubkey).toBe(('02' + 'a'.repeat(64)).toLowerCase());
        expect(rec.window).toBeNull();
        expect(rec.enabled).toBe(true);
        expect(validateCoSignerAccount(rec).ok).toBe(true);
    });

    it('requires the essential fields', () => {
        expect(() => createCoSignerAccount({ ...baseInput(), walletId: '' })).toThrow(/walletId/);
        expect(() => createCoSignerAccount({ ...baseInput(), agentPubkey: 'zz' })).toThrow(/agentPubkey/);
        expect(() => createCoSignerAccount({ ...baseInput(), publicKeyOrder: ['02aa'] })).toThrow(/publicKeyOrder/);
        expect(() => createCoSignerAccount({ ...baseInput(), policy: { allowedActions: [] } })).toThrow(/allowedActions/);
    });

    it('rejects a malformed record in validation', () => {
        const rec = createCoSignerAccount(baseInput());
        expect(validateCoSignerAccount({ ...rec, schemaVersion: 2 }).ok).toBe(false);
        expect(validateCoSignerAccount({ ...rec, daemonPubkey: 'nothex' }).ok).toBe(false);
        expect(validateCoSignerAccount({ ...rec, policy: { allowedActions: [] } }).ok).toBe(false);
        expect(validateCoSignerAccount({ ...rec, window: { version: 1 } }).ok).toBe(false); // entries missing
        expect(validateCoSignerAccount({ ...rec, window: { version: 1, entries: [{}] } }).ok).toBe(false); // entry has no t
    });

    it('accepts a well-formed embedded window', () => {
        const rec = createCoSignerAccount(baseInput());
        const withWindow = { ...rec, window: { version: 1, entries: [{ t: 123, action: 'SEND', tick: 'X', amount: '5' }] } };
        expect(validateCoSignerAccount(withWindow).ok).toBe(true);
    });
});

describe('coSignerAccount Vault collection', () => {
    /** @type {Vault} */
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
    });

    it('round-trips through the new collection', async () => {
        const rec = createCoSignerAccount(baseInput());
        await vault.coSignerAccounts.put(rec);
        const got = await vault.coSignerAccounts.get(rec.id);
        expect(got).toEqual(rec);
        expect(await vault.coSignerAccounts.count()).toBe(1);
        const byWallet = await vault.coSignerAccounts.findBy('walletId', 'wallet-1');
        expect(byWallet).toHaveLength(1);
    });

    it('rejects an invalid record on put', async () => {
        const rec = createCoSignerAccount(baseInput());
        await expect(vault.coSignerAccounts.put({ ...rec, agentPubkey: 'nothex' })).rejects.toThrow();
    });

    it('survives a save + reopen (collection persists in the encrypted blob)', async () => {
        const rec = createCoSignerAccount(baseInput());
        await vault.coSignerAccounts.put(rec);
        await vault.save();
        const backend = vault._backend;
        const reopened = new Vault({ backend, masterKey: MASTER_KEY });
        await reopened.open();
        expect(await reopened.coSignerAccounts.get(rec.id)).toEqual(rec);
    });
});

describe('coSignerAccount Vault-backed window persistence', () => {
    /** @type {Vault} */
    let vault;
    let account;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
        account = createCoSignerAccount(baseInput());
        await vault.coSignerAccounts.put(account);
    });

    it('persists window state onto the account record via the adapter', async () => {
        const persistence = createVaultWindowPersistence(vault, account.id);
        expect(await persistence.read()).toBeNull();
        await persistence.write({ version: 1, entries: [{ t: 1000, action: 'SEND', tick: 'X', amount: '3' }] });
        const reread = await persistence.read();
        expect(reread.entries).toHaveLength(1);
        // and it landed on the account record itself
        const acct = await vault.coSignerAccounts.get(account.id);
        expect(acct.window.entries[0]).toMatchObject({ action: 'SEND', amount: '3' });
    });

    it('throws for an unknown account', async () => {
        const persistence = createVaultWindowPersistence(vault, 'does-not-exist');
        await expect(persistence.read()).rejects.toThrow(/not found/);
    });

    it('buildAccountWindowStore returns a working store wired to the account', async () => {
        const store = buildAccountWindowStore({ vault, account, now: () => 5_000 });
        expect(store).toBeInstanceOf(VaultWindowStore);
        await store.load();
        store.record({ action: 'SEND', tick: 'X', amount: '2', txid: 'tx1' });
        await store.flush();
        // reload from a fresh store over the same vault account
        const reloaded = buildAccountWindowStore({ vault, account, now: () => 5_000 });
        await reloaded.load();
        expect(reloaded.snapshot()).toEqual({ count: 1, perTick: { X: '2' } });
    });

    it('returns null when the policy has no maxPerWindow cap', () => {
        const noCap = createCoSignerAccount(baseInput({ policy: { allowedActions: ['SEND'] } }));
        expect(buildAccountWindowStore({ vault, account: noCap })).toBeNull();
    });
});
