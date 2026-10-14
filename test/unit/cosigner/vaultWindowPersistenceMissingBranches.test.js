// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    buildAccountWindowStore,
    createVaultWindowPersistence,
} from '../../../packages/core/src/cosigner/vaultWindowPersistence.js';

function account(overrides = {}) {
    return {
        id: 'account-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        policy: { maxPerWindow: { hours: 2 } },
        window: null,
        ...overrides,
    };
}

describe('vault window persistence remaining branches', () => {
    it.each([
        null,
        {},
        { coSignerAccounts: {} },
        { coSignerAccounts: { get: vi.fn() } },
    ])('rejects an incomplete vault port', (vault) => {
        expect(() => createVaultWindowPersistence(vault, 'account-1')).toThrow(/coSignerAccounts/);
    });

    it.each([null, '', '   '])('rejects invalid account id %j', (accountId) => {
        const vault = { coSignerAccounts: { get: vi.fn(), put: vi.fn() } };

        expect(() => createVaultWindowPersistence(vault, accountId)).toThrow(/accountId/);
    });

    it('fails closed when the account disappears and defaults an absent window to null', async () => {
        const get = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(account({ window: undefined }));
        const persistence = createVaultWindowPersistence({
            coSignerAccounts: { get, put: vi.fn() },
        }, 'account-1');

        await expect(persistence.read()).rejects.toThrow(/not found/);
        await expect(persistence.read()).resolves.toBeNull();
    });

    it('builds a scoped store that reads and writes the account window', async () => {
        let current = account();
        const vault = {
            coSignerAccounts: {
                async get() { return current; },
                async put(next) { current = next; },
            },
        };
        const store = buildAccountWindowStore({ vault, account: current, now: () => 5_000 });

        await store.load();
        store.record({ action: 'SEND', tick: 'X', amount: '2' });
        await store.flush();

        expect(current.window.entries).toEqual([
            { t: 5_000, action: 'SEND', tick: 'X', amount: '2', txid: null },
        ]);
        expect(current.updatedAt).toEqual(expect.any(String));
    });
});
