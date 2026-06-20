// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: renameAccount flow. Asserts the Account `name` is updated and
// persisted (trimmed), and that bad input / unknown ids are rejected.

import { describe, it, expect } from 'vitest';
import { renameAccount } from '../../../packages/core/src/flows/renameAccount.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        _map: m,
    };
}

function makeVault(accounts = []) {
    return { accounts: memCollection(accounts) };
}

const baseAccount = {
    schemaVersion: 1,
    id: 'acct-1',
    walletId: 'wallet-1',
    name: 'Account 1',
    index: 0,
    createdAt: '2026-06-17T00:00:00.000Z',
};

describe('renameAccount', () => {
    it('updates and persists the account name (trimmed)', async () => {
        const vault = makeVault([baseAccount]);
        const updated = await renameAccount({ accountId: 'acct-1', name: '  Trading  ', vault });
        expect(updated.name).toBe('Trading');
        const stored = await vault.accounts.get('acct-1');
        expect(stored.name).toBe('Trading');
        // Other fields are preserved.
        expect(stored.index).toBe(0);
        expect(stored.walletId).toBe('wallet-1');
    });

    it('rejects an empty / whitespace name', async () => {
        const vault = makeVault([baseAccount]);
        await expect(renameAccount({ accountId: 'acct-1', name: '   ', vault }))
            .rejects.toThrow(/non-empty/);
        expect((await vault.accounts.get('acct-1')).name).toBe('Account 1');
    });

    it('rejects a missing accountId', async () => {
        const vault = makeVault([baseAccount]);
        await expect(renameAccount({ accountId: '', name: 'X', vault }))
            .rejects.toThrow(/accountId is required/);
    });

    it('throws when the account does not exist', async () => {
        const vault = makeVault([baseAccount]);
        await expect(renameAccount({ accountId: 'nope', name: 'X', vault }))
            .rejects.toThrow(/not found/);
    });

    it('requires a vault', async () => {
        await expect(renameAccount({ accountId: 'acct-1', name: 'X', vault: null }))
            .rejects.toThrow(/vault is required/);
    });
});
