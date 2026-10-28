// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One address's balance of one token, read so a caller can tell "holds none"
// from "could not read". The wallet balance route answers a failed read with
// `balances: null`, a failed token half with `unavailable: ['tokens']` and
// empty rows, and a quantity it could not scale with an `unknown` row; each of
// those is an unknown balance, never zero. An irreversible action such as a
// destroy is judged only against a balance this returns as `ok`.

import { balancesFromSdk } from '../decoder/balanceAdapter.js';
import { compareDecimal } from '../shared/utils/dividendPerUnit.js';

const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * @param {object} args
 * @param {any} args.messaging                       host messaging (getWalletBalances)
 * @param {string} args.walletId
 * @param {string} [args.accountId]
 * @param {string} args.chainId
 * @param {string} args.address                      the source address
 * @param {string} args.tick
 * @returns {Promise<{ ok: true, amount: string } | { ok: false }>}
 */
export async function readSourceTickBalance({ messaging, walletId, accountId, chainId, address, tick }) {
    const tickUpper = String(tick || '').trim().toUpperCase();
    if (!chainId || !address || !tickUpper) return { ok: false };
    if (typeof messaging?.getWalletBalances !== 'function') return { ok: false };
    let byChain;
    try {
        byChain = await messaging.getWalletBalances(walletId, accountId, chainId);
    } catch {
        return { ok: false };
    }
    const entries = Array.isArray(byChain?.[chainId]) ? byChain[chainId] : [];
    const entry = entries.find((e) => e && e.address === address);
    if (!entry || entry.error || !entry.balances || typeof entry.balances !== 'object') return { ok: false };
    const unavailable = Array.isArray(entry.balances.unavailable) ? entry.balances.unavailable : [];
    if (unavailable.includes('tokens')) return { ok: false };
    const rows = balancesFromSdk(entry.balances) || [];
    const match = rows.find((b) => !b.isCoin && String(b.tick).toUpperCase() === tickUpper);
    if (!match) return { ok: true, amount: '0' };
    const amount = String(match.amount ?? '');
    if (match.unknown || !PLAIN_DECIMAL.test(amount)) return { ok: false };
    return { ok: true, amount };
}

/**
 * How long Approve waits on the re-read. The explorer client retries a dead
 * connection with backoff and the wallet read falls back per address, which
 * can hold Approve for minutes; past this the balance counts as unread.
 */
export const RECHECK_TIMEOUT_MS = 15000;

/**
 * Re-read the source balance just before signing and say whether it still
 * covers `amount`.
 *
 * @param {Parameters<typeof readSourceTickBalance>[0] & { amount: string, timeoutMs?: number }} args
 * @returns {Promise<{ ok: true, balance: string } | { ok: false, reason: 'unread' } | { ok: false, reason: 'short', balance: string }>}
 */
export async function recheckSourceTickBalance({ amount, timeoutMs = RECHECK_TIMEOUT_MS, ...read }) {
    let timer;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), timeoutMs); });
    let fresh;
    try {
        fresh = await Promise.race([readSourceTickBalance(read), timedOut]);
    } finally {
        clearTimeout(timer);
    }
    if (!fresh.ok) return { ok: false, reason: 'unread' };
    if (compareDecimal(amount, fresh.amount) === 1) return { ok: false, reason: 'short', balance: fresh.amount };
    return { ok: true, balance: fresh.amount };
}
