// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's last complete display state is device-local and disposable. The
// wallet and account ids live in both the key and value so malformed or
// misplaced storage can never put one wallet's balances on another.

const NS = 'xc:balanceCache:';
const clearedWallets = new Set();

function scopePart(value) {
    return encodeURIComponent(value || '');
}

function walletPrefix(walletId) {
    return `${NS}${scopePart(walletId)}:`;
}

function cacheKey(walletId, accountId) {
    return `${walletPrefix(walletId)}${scopePart(accountId)}`;
}

/**
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @returns {{ balances: Record<string, any[]>, activeByChain: Record<string, any>, fetchedAt: number } | null}
 */
export function readBalanceCache(walletId, accountId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const normalizedAccountId = typeof accountId === 'string' && accountId ? accountId : null;
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(cacheKey(walletId, normalizedAccountId));
        if (!raw) return null;
        const stored = JSON.parse(raw);
        if (stored?.walletId !== walletId || stored?.accountId !== normalizedAccountId) return null;
        if (!stored.balances || typeof stored.balances !== 'object' || Array.isArray(stored.balances)) return null;
        if (!Number.isFinite(stored.fetchedAt) || stored.fetchedAt < 0) return null;
        const activeByChain = stored.activeByChain
            && typeof stored.activeByChain === 'object'
            && !Array.isArray(stored.activeByChain)
            ? stored.activeByChain
            : {};
        return { balances: stored.balances, activeByChain, fetchedAt: stored.fetchedAt };
    } catch {
        return null;
    }
}

/**
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @param {{ balances: Record<string, any[]>, activeByChain?: Record<string, any>, fetchedAt: number }} value
 */
export function writeBalanceCache(walletId, accountId, value) {
    if (typeof walletId !== 'string' || !walletId) return;
    // Removal can race an explorer request that already holds this wallet's
    // addresses. Keep that late result from recreating storage before reload.
    if (clearedWallets.has(walletId)) return;
    if (!value?.balances || typeof value.balances !== 'object' || Array.isArray(value.balances)) return;
    if (!Number.isFinite(value.fetchedAt) || value.fetchedAt < 0) return;
    const normalizedAccountId = typeof accountId === 'string' && accountId ? accountId : null;
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(cacheKey(walletId, normalizedAccountId), JSON.stringify({
            walletId,
            accountId: normalizedAccountId,
            balances: value.balances,
            activeByChain: value.activeByChain || {},
            fetchedAt: value.fetchedAt,
        }));
    } catch { /* best-effort cache */ }
}

/** Remove every account-scoped balance cache owned by one wallet. */
export function clearBalanceCache(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    clearedWallets.add(walletId);
    try {
        if (typeof localStorage === 'undefined') return;
        const prefix = walletPrefix(walletId);
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (key?.startsWith(prefix)) localStorage.removeItem(key);
        }
    } catch { /* best-effort cache cleanup */ }
}
