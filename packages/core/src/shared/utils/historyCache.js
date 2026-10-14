// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const HISTORY_CACHE_PREFIX = 'xc:historyCache:v1:';

function walletPrefix(walletId) {
    return `${HISTORY_CACHE_PREFIX}${encodeURIComponent(String(walletId || ''))}:`;
}

function historyCacheKey(walletId, accountId) {
    return `${walletPrefix(walletId)}${encodeURIComponent(String(accountId || 'all'))}`;
}

/** Return the last complete snapshot for this wallet and account. */
export function readHistoryCache(walletId, accountId) {
    if (!walletId) return null;
    try {
        const raw = globalThis.localStorage?.getItem(historyCacheKey(walletId, accountId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.entries)
            || !parsed.addressesByChain
            || typeof parsed.addressesByChain !== 'object'
            || !Number.isFinite(parsed.fetchedAt)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/** Save only a complete successful load so an interrupted refresh cannot replace good rows. */
export function writeHistoryCache(walletId, accountId, snapshot) {
    if (!walletId) return false;
    try {
        const storage = globalThis.localStorage;
        if (!storage) return false;
        storage.setItem(
            historyCacheKey(walletId, accountId),
            JSON.stringify(snapshot),
        );
        return true;
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
