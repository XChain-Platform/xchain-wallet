// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §4.7: net a source address's UNCONFIRMED, committed spends into a
// concurrent approval window's pre-flight. The in-memory reservation only
// covers approve -> broadcast (it is released the instant the send is signed
// and handed off); this covers the much longer broadcast -> confirmation gap,
// where the send is real but the explorer balance does not yet reflect it. The
// PendingTx v2 tick/amount fields (§28.4) exist for exactly this, and the pair
// gives continuous protection: reservation, then pendingTx, then the on-chain
// balance itself once the tx indexes.

// Statuses where the spend is committed (signed) but the on-chain balance does
// not yet reflect it. 'indexed' is confirmed - the balance already accounts for
// it, so netting would double-count. 'composing'/'awaiting-signature' are
// pre-commit and covered by the still-held reservation. 'failed'/'rbf-replaced'
// are no longer live.
export const UNCONFIRMED_COMMITTED_STATUSES = /** @type {const} */ ([
    'signed', 'queued', 'broadcasting', 'broadcast',
]);

const UNCONFIRMED = new Set(UNCONFIRMED_COMMITTED_STATUSES);

/**
 * A plain positive decimal string, tested by shape rather than by parsing to a
 * Number: amounts are decimal strings precisely because they can exceed what a
 * float represents exactly (§4.5), so `Number(amount) > 0` would be the wrong
 * question asked in the wrong arithmetic.
 *
 * @param {unknown} amount
 */
function isPositiveDecimalString(amount) {
    const s = String(amount).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return false;
    return /[1-9]/.test(s);
}

/**
 * Pending debits to subtract from a source's balance in pre-flight.
 *
 * Pure: takes the raw PendingTx list and the venue/source to filter on, returns
 * `[{ tick, amount }]` (same shape the §4.7 reservation ledger yields). Only
 * records carrying a v2 single-tick debit contribute; the rest net nothing.
 *
 * @param {Array<import('../schemas/pendingTx.js').PendingTx>} pendingTxs
 * @param {{ coin: string, network: string, source: string }} venue
 * @returns {Array<{ tick: string, amount: string }>}
 */
export function unconfirmedPendingDeltas(pendingTxs, { coin, network, source } = {}) {
    if (!Array.isArray(pendingTxs) || !source) return [];
    const out = [];
    for (const p of pendingTxs) {
        if (!p || p.fromAddress !== source) continue;
        if (p.chain !== coin || p.network !== network) continue;
        if (!UNCONFIRMED.has(p.status)) continue;
        if (!p.tick || p.amount == null || p.amount === '') continue;
        // Every delta here is SUBTRACTED from what the user may spend, so a
        // non-positive amount would be netted as a credit and hand them
        // spendable balance for a transaction the network has not accepted.
        // The schema only checks that `amount` is a string, so nothing
        // upstream rules this out; refusing it here is the cheap half of
        // M2.5's rule that a pending amount is never added to a balance.
        if (!isPositiveDecimalString(p.amount)) continue;
        out.push({ tick: String(p.tick), amount: String(p.amount) });
    }
    return out;
}
