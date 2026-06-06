// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Watchlist CRUD flows — §41.2. Thin wrappers around the vault's
// watchlistEntries collection, mirroring the pendingAirdrops flow
// shape. The MarketsList UI reads via listWatchlistForWallet, the
// star button writes via saveWatchlistEntry / clearWatchlistEntry.

import {
    createWatchlistEntry as buildEntry,
    watchlistEntryKey,
} from '../schemas/watchlistEntry.js';

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} params
 */
export async function listWatchlistForWallet({ vault, walletId }) {
    if (!vault) throw new Error('listWatchlistForWallet: vault is required');
    if (!walletId) throw new Error('listWatchlistForWallet: walletId is required');
    return vault.watchlistEntries.findBy('walletId', walletId);
}

/**
 * Add a watchlist entry. Idempotent by (walletId, chainId, tick1, tick2).
 * Returns the stored record (existing or newly created).
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string, chainId: string, tick1: string, tick2: string }} params
 */
export async function saveWatchlistEntry({ vault, walletId, chainId, tick1, tick2 }) {
    if (!vault) throw new Error('saveWatchlistEntry: vault is required');
    if (!walletId) throw new Error('saveWatchlistEntry: walletId is required');
    if (!chainId) throw new Error('saveWatchlistEntry: chainId is required');
    if (!tick1) throw new Error('saveWatchlistEntry: tick1 is required');
    if (!tick2) throw new Error('saveWatchlistEntry: tick2 is required');
    const existing = await vault.watchlistEntries.findBy('walletId', walletId);
    const targetKey = `${chainId}::${tick1}::${tick2}`;
    const match = (existing || []).find((e) => watchlistEntryKey(e) === targetKey);
    if (match) return match;
    const record = buildEntry({ walletId, chainId, tick1, tick2 });
    await vault.watchlistEntries.put(record);
    return record;
}

/**
 * Remove an entry by id.
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string }} params
 */
export async function clearWatchlistEntry({ vault, id }) {
    if (!vault) throw new Error('clearWatchlistEntry: vault is required');
    if (!id) throw new Error('clearWatchlistEntry: id is required');
    return vault.watchlistEntries.delete(id);
}
