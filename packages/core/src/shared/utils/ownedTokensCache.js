// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// My Tokens' last complete ownership read, device-local and disposable. One
// slot per wallet; the address set the read covered is stored with it, so an
// account switch or an added or removed address never reuses the old list.

import { isWalletDataFresh, readTimeOf } from './walletDataFreshness.js';

/** Prefix every owned-tokens key starts with; the wipe and the quota trim read it from here. */
export const OWNED_TOKENS_CACHE_PREFIX = 'xc:ownedTokens:v1:';
const clearedWallets = new Set();

function walletPrefix(walletId) {
    return `${OWNED_TOKENS_CACHE_PREFIX}${encodeURIComponent(walletId)}:`;
}

function cacheKey(walletId) {
    return `${walletPrefix(walletId)}list`;
}

/**
 * One string naming every (chain, address) pair a read covers, order-free.
 *
 * @param {Record<string, any[]> | null | undefined} addressesByChain
 */
export function ownedTokensAddressKey(addressesByChain) {
    const pairs = [];
    for (const [chainId, addrs] of Object.entries(addressesByChain || {})) {
        if (!Array.isArray(addrs)) continue;
        for (const a of addrs) {
            if (typeof a?.address === 'string' && a.address) pairs.push(`${chainId}|${a.address}`);
        }
    }
    return pairs.sort().join(',');
}

/**
 * The saved list when it covers these addresses and is still fresh.
 *
 * @param {string} walletId
 * @param {string} addressKey
 * @param {number} [now]
 * @returns {any[] | null}
 */
export function readFreshOwnedTokens(walletId, addressKey, now = Date.now()) {
    if (typeof walletId !== 'string' || !walletId) return null;
    try {
        const raw = globalThis.localStorage?.getItem(cacheKey(walletId));
        if (!raw) return null;
        const stored = JSON.parse(raw);
        if (stored?.walletId !== walletId
            || !addressKey
            || stored?.addressKey !== addressKey
            || !Array.isArray(stored?.tokens)) return null;
        return isWalletDataFresh(stored.readAt, now) ? stored.tokens : null;
    } catch {
        return null;
    }
}

/**
 * Save a complete read. Only a read with no failed address is saved.
 *
 * @param {string} walletId
 * @param {string} addressKey
 * @param {any[]} tokens
 * @param {number} startedAt  when the read began
 */
export function writeOwnedTokensCache(walletId, addressKey, tokens, startedAt) {
    if (typeof walletId !== 'string' || !walletId || clearedWallets.has(walletId)) return;
    if (!Array.isArray(tokens) || !Number.isFinite(startedAt)) return;
    try {
        globalThis.localStorage?.setItem(cacheKey(walletId), JSON.stringify({
            walletId,
            addressKey,
            tokens,
            readAt: readTimeOf(startedAt),
        }));
    } catch { /* best-effort cache */ }
}

/** Remove every saved list owned by one wallet. */
export function clearOwnedTokensCache(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    clearedWallets.add(walletId);
    try {
        const storage = globalThis.localStorage;
        if (!storage) return;
        const prefix = walletPrefix(walletId);
        for (let i = storage.length - 1; i >= 0; i -= 1) {
            const key = storage.key(i);
            if (key?.startsWith(prefix)) storage.removeItem(key);
        }
    } catch { /* best-effort cache cleanup */ }
}
