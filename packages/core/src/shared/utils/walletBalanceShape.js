// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One reader for the shape `messaging.getWalletBalances` actually returns.
//
// That call resolves to `Record<chainId, AddressBalancesEntry[]>`, where each
// entry is `{ address, balances: { native, tokens: [{ tick, quantity, ... }] } }`
// and every `quantity` is raw atomic units. It is NOT a flat row array and
// carries no `rows` / `data` envelope, which is what ManageToken assumed
// (D-75): its parse matched nothing, so "You hold" read 0 for every token,
// including one whose entire supply sat on the wallet's own address.
//
// Deduped by ADDRESS, not by record: two Address records can name one address
// (a WIF imported twice, or a WIF the wallet already derives), and each carries
// that address's full chain balance, so summing per record reports money the
// wallet does not have. Same rule buildBalanceRows enforces after D-67.

/**
 * Sum one tick's holdings across every address the wallet has on one chain.
 *
 * @param {Record<string, Array<any>> | null | undefined} byChain  getWalletBalances' result
 * @param {string} chainId
 * @param {string} tick                                  compared case-insensitively
 * @param {{ address?: string | null }} [opts]           restrict to a single address
 * @returns {string}                                     raw atomic units; '0' when none
 */
export function sumTickOnChain(byChain, chainId, tick, opts = {}) {
    const wanted = String(tick || '').trim().toUpperCase();
    if (!byChain || typeof byChain !== 'object' || !chainId || !wanted) return '0';

    const entries = Array.isArray(byChain[chainId]) ? byChain[chainId] : [];
    const only = opts.address || null;
    const seenAddresses = new Set();
    let total = 0n;

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (only && entry.address !== only) continue;
        if (seenAddresses.has(entry.address)) continue;
        seenAddresses.add(entry.address);

        const balances = entry.balances;
        if (!balances || typeof balances !== 'object') continue;

        const native = balances.native;
        if (native && String(native.tick || '').toUpperCase() === wanted) {
            total += safeBigInt(native.quantity);
        }

        const tokens = Array.isArray(balances.tokens) ? balances.tokens : [];
        for (const t of tokens) {
            if (!t || String(t.tick || '').toUpperCase() !== wanted) continue;
            total += safeBigInt(t.quantity);
        }
    }

    return total.toString();
}

/** @param {any} v */
function safeBigInt(v) {
    if (v === null || v === undefined) return 0n;
    try {
        return BigInt(String(v).trim().split('.')[0] || '0');
    } catch {
        return 0n;
    }
}
