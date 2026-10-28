// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The extension popup and its expanded tab share one background vault, so
// two stars on the same market can reach saveWatchlistEntry together. Each
// read the list before either wrote, and both wrote a row; removing the star
// then cleared one and the other kept it lit.

import { describe, it, expect } from 'vitest';
import {
    listWatchlistForWallet,
    saveWatchlistEntry,
} from '../../../packages/core/src/flows/watchlist.js';

function slowCollection() {
    const m = new Map();
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    return {
        get: async (id) => (m.has(id) ? m.get(id) : null),
        put: async (rec) => { await tick(); m.set(rec.id, rec); },
        delete: async (id) => m.delete(id),
        findBy: async (field, value) => {
            const rows = Array.from(m.values()).filter((r) => r[field] === value);
            await tick();
            return rows;
        },
    };
}

const MARKET = { walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'XCP', tick2: 'BTC' };

describe('flows/watchlist concurrent saves', () => {
    it('writes one row when the same market is saved twice at once', async () => {
        const vault = { watchlistEntries: slowCollection() };
        const [a, b] = await Promise.all([
            saveWatchlistEntry({ vault, ...MARKET }),
            saveWatchlistEntry({ vault, ...MARKET }),
        ]);
        expect(a.id).toBe(b.id);
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(1);
    });

    it('keeps both rows when two different markets are saved at once', async () => {
        const vault = { watchlistEntries: slowCollection() };
        await Promise.all([
            saveWatchlistEntry({ vault, ...MARKET }),
            saveWatchlistEntry({ vault, ...MARKET, tick1: 'PEPE' }),
        ]);
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(2);
    });

    it('lets a later save run after an earlier one failed', async () => {
        const collection = slowCollection();
        let fail = true;
        const put = collection.put;
        collection.put = async (rec) => {
            if (fail) { fail = false; throw new Error('disk full'); }
            return put(rec);
        };
        const vault = { watchlistEntries: collection };
        await expect(saveWatchlistEntry({ vault, ...MARKET })).rejects.toThrow('disk full');
        await saveWatchlistEntry({ vault, ...MARKET });
        expect(await listWatchlistForWallet({ vault, walletId: 'w1' })).toHaveLength(1);
    });
});
