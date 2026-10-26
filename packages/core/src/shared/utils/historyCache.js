// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/** Prefix every history snapshot key starts with; the wipe and the per-wallet clear read it from here. */
export const HISTORY_CACHE_PREFIX = 'xc:historyCache:v2:';

function walletPrefix(walletId) {
    return `${HISTORY_CACHE_PREFIX}${encodeURIComponent(String(walletId || ''))}:`;
}

function networkScope(activeNetwork) {
    if (activeNetwork === undefined) return 'mainnet';
    return typeof activeNetwork === 'string' && activeNetwork ? activeNetwork : null;
}

function historyCacheKey(walletId, accountId, activeNetwork) {
    return `${walletPrefix(walletId)}${encodeURIComponent(String(accountId || 'all'))}:${encodeURIComponent(activeNetwork)}`;
}

/** Return the last complete snapshot for this wallet, account and network. */
export function readHistoryCache(walletId, accountId, activeNetwork) {
    if (!walletId) return null;
    const network = networkScope(activeNetwork);
    if (!network) return null;
    try {
        const raw = globalThis.localStorage?.getItem(historyCacheKey(walletId, accountId, network));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.entries)
            || !parsed.addressesByChain
            || typeof parsed.addressesByChain !== 'object'
            || !Number.isFinite(parsed.fetchedAt)
            || parsed.activeNetwork !== network) {
            return null;
        }
        const { activeNetwork: _activeNetwork, ...snapshot } = parsed;
        return snapshot;
    } catch {
        return null;
    }
}

// Most rows a snapshot keeps. The feed is newest first, so the cap drops the
// oldest rows; a storage quota that is smaller still halves the kept rows
// until the write fits.
export const HISTORY_CACHE_MAX_ENTRIES = 2000;

/**
 * Save only a complete successful load so an interrupted refresh cannot
 * replace good rows. A snapshot too large for the storage quota is saved as
 * its newest rows rather than dropped, so offline still shows the cached part.
 */
export function writeHistoryCache(walletId, accountId, snapshot, activeNetwork) {
    if (!walletId) return false;
    const network = networkScope(activeNetwork);
    if (!network) return false;
    try {
        const storage = globalThis.localStorage;
        if (!storage) return false;
        const key = historyCacheKey(walletId, accountId, network);
        const all = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
        let keep = Math.min(all.length, HISTORY_CACHE_MAX_ENTRIES);
        for (;;) {
            try {
                storage.setItem(key, JSON.stringify({
                    ...snapshot,
                    entries: keep === all.length ? all : all.slice(0, keep),
                    activeNetwork: network,
                }));
                return true;
            } catch (err) {
                if (keep === 0) throw err;
                keep = Math.floor(keep / 2);
            }
        }
    } catch {
        return false;
    }
}

/** Remove every account snapshot owned by a wallet being removed. */
export function clearHistoryCacheForWallet(walletId) {
    if (!walletId) return;
    try {
        const storage = globalThis.localStorage;
        if (!storage) return;
        const prefix = walletPrefix(walletId);
        for (let i = storage.length - 1; i >= 0; i -= 1) {
            const key = storage.key(i);
            if (key?.startsWith(prefix)) storage.removeItem(key);
        }
    } catch { /* best-effort */ }
}
