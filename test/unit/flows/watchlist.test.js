// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/watchlist (§41.2). Thin CRUD over the vault's
// watchlistEntries collection. saveWatchlistEntry is idempotent by
// (chainId, tick1, tick2); required-arg guards throw with named errors.

import { describe, it, expect } from 'vitest';
import {
    listWatchlistForWallet,
    saveWatchlistEntry,
    clearWatchlistEntry,
} from '../../../packages/core/src/flows/watchlist.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, r]));
    return {
        get: async (id) => (m.has(id) ? m.get(id) : null),
        put: async (rec) => { m.set(rec.id, rec); },
        delete: async (id) => m.delete(id),
        findBy: async (field, value) => Array.from(m.values()).filter((r) => r[field] === value),
        _map: m,
    };
}

function makeVault(initial = []) {
    return { watchlistEntries: memCollection(initial) };
}

describe('flows/watchlist saveWatchlistEntry', () => {
    it('creates and persists a new entry', async () => {
        const vault = makeVault();
        const rec = await saveWatchlistEntry({
            vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC',
        });
        expect(rec).toMatchObject({ walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC' });
        expect(rec.id).toBeTruthy();
        const stored = await listWatchlistForWallet({ vault, walletId: 'w1' });
        expect(stored).toHaveLength(1);
    });

    it('is idempotent on (chainId, tick1, tick2): returns the existing row and writes nothing new', async () => {
        const vault = makeVault();
        const first = await saveWatchlistEntry({
            vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC',
        });
        const again = await saveWatchlistEntry({
            vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC',
        });
        expect(again.id).toBe(first.id);
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(1);
    });

    it('treats a different quote tick as a distinct market', async () => {
        const vault = makeVault();
        await saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC' });
        await saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'XCP' });
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(2);
    });

    it('rejects on any missing required field', async () => {
        const vault = makeVault();
        await expect(saveWatchlistEntry({ walletId: 'w1', chainId: 'c', tick1: 't', tick2: 'q' }))
            .rejects.toThrow(/vault is required/);
        await expect(saveWatchlistEntry({ vault, chainId: 'c', tick1: 't', tick2: 'q' }))
            .rejects.toThrow(/walletId is required/);
        await expect(saveWatchlistEntry({ vault, walletId: 'w1', tick1: 't', tick2: 'q' }))
            .rejects.toThrow(/chainId is required/);
        await expect(saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'c', tick2: 'q' }))
            .rejects.toThrow(/tick1 is required/);
        await expect(saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'c', tick1: 't' }))
            .rejects.toThrow(/tick2 is required/);
    });
});

describe('flows/watchlist list + clear', () => {
    it('scopes the list to the requested wallet', async () => {
        const vault = makeVault();
        await saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'c', tick1: 'A', tick2: 'BTC' });
        await saveWatchlistEntry({ vault, walletId: 'w2', chainId: 'c', tick1: 'B', tick2: 'BTC' });
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(1);
        expect(await listWatchlistForWallet({ vault, walletId: 'w2' })).toHaveLength(1);
    });

    it('removes an entry by id', async () => {
        const vault = makeVault();
        const rec = await saveWatchlistEntry({ vault, walletId: 'w1', chainId: 'c', tick1: 'A', tick2: 'BTC' });
        await clearWatchlistEntry({ vault, id: rec.id });
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(0);
    });

    it('guards required args on list and clear', async () => {
        const vault = makeVault();
        await expect(listWatchlistForWallet({ walletId: 'w1' })).rejects.toThrow(/vault is required/);
        await expect(listWatchlistForWallet({ vault })).rejects.toThrow(/walletId is required/);
        await expect(clearWatchlistEntry({ id: 'x' })).rejects.toThrow(/vault is required/);
        await expect(clearWatchlistEntry({ vault })).rejects.toThrow(/id is required/);
    });
});
