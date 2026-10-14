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
// Wallet, account and network ids live in both the key and value so malformed
// or misplaced storage cannot cross any display boundary.

const NS = 'xc:balanceCache:v2:';
const clearedWallets = new Set();

function scopePart(value) {
    return encodeURIComponent(value || '');
}

function walletPrefix(walletId) {
    return `${NS}${scopePart(walletId)}:`;
}

function cacheKey(walletId, accountId, activeNetwork) {
    return `${walletPrefix(walletId)}${scopePart(accountId)}:${scopePart(activeNetwork)}`;
}

function networkScope(activeNetwork) {
    if (activeNetwork === undefined) return 'mainnet';
    return typeof activeNetwork === 'string' && activeNetwork ? activeNetwork : null;
}

/**
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @param {string | null} [activeNetwork]
 * @returns {{ balances: Record<string, any[]>, activeByChain: Record<string, any>, fetchedAt: number } | null}
 */
export function readBalanceCache(walletId, accountId, activeNetwork) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const network = networkScope(activeNetwork);
    if (!network) return null;
    const normalizedAccountId = typeof accountId === 'string' && accountId ? accountId : null;
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(cacheKey(walletId, normalizedAccountId, network));
        if (!raw) return null;
        const stored = JSON.parse(raw);
        if (stored?.walletId !== walletId
            || stored?.accountId !== normalizedAccountId
            || stored?.activeNetwork !== network) return null;
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
 * @param {string | null} [activeNetwork]
 */
export function writeBalanceCache(walletId, accountId, value, activeNetwork) {
    if (typeof walletId !== 'string' || !walletId) return;
    // Removal can race an explorer request that already holds this wallet's
    // addresses. Keep that late result from recreating storage before reload.
    if (clearedWallets.has(walletId)) return;
    if (!value?.balances || typeof value.balances !== 'object' || Array.isArray(value.balances)) return;
    if (!Number.isFinite(value.fetchedAt) || value.fetchedAt < 0) return;
    const network = networkScope(activeNetwork);
    if (!network) return;
    const normalizedAccountId = typeof accountId === 'string' && accountId ? accountId : null;
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(cacheKey(walletId, normalizedAccountId, network), JSON.stringify({
            walletId,
            accountId: normalizedAccountId,
            activeNetwork: network,
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
