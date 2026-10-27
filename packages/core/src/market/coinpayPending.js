// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Own-vault double-pay defense for COINPAY: a payment for a match that is signed,
// queued or broadcast from this vault may already be in flight while the
// explorer still lists the obligation as pending. Shared by the auto-pay
// engine and the signing flow so a manual pay cannot repeat it.

/** PendingTx statuses that mean "a payment may already be in flight". */
export const ATTEMPTED_STATUSES = new Set([
    'signed', 'queued', 'broadcasting', 'broadcast', 'indexed',
]);

/**
 * Does a PendingTx row reference a COINPAY for this ORDER_MATCH?
 * Prefers the structured params snapshot; falls back to the two
 * summary wordings (manual CoinpayForm and this engine's).
 *
 * @param {import('../schemas/pendingTx.js').PendingTx} tx
 * @param {string} matchIndex
 * @returns {boolean}
 */
export function pendingTxReferencesMatch(tx, matchIndex) {
    if (!tx || tx.action !== 'COINPAY') return false;
    const idx = String(matchIndex);
    // The index reaches here straight from an API row; a non-numeric
    // value can never label a real payment and must not reach RegExp.
    if (!/^\d+$/.test(idx)) return false;
    const fromParams = tx.params && tx.params.ORDER_MATCH_ACTION_INDEX != null
        ? String(tx.params.ORDER_MATCH_ACTION_INDEX) === idx
        : false;
    if (fromParams) return true;
    const summary = typeof tx.actionSummary === 'string' ? tx.actionSummary : '';
    // Digit boundary after the index: "#900" must not match inside "#9001".
    const boundary = new RegExp(`(?:ORDER_MATCH|match) #${idx}(?!\\d)`);
    return boundary.test(summary);
}

/**
 * Is a payment for this ORDER_MATCH already in flight from this vault?
 *
 * @param {Array<import('../schemas/pendingTx.js').PendingTx>} pendingTxs
 * @param {string} matchIndex
 * @returns {boolean}
 */
export function hasAttemptedCoinpay(pendingTxs, matchIndex) {
    return Array.isArray(pendingTxs) && pendingTxs.some((tx) => (
        ATTEMPTED_STATUSES.has(tx?.status) && pendingTxReferencesMatch(tx, matchIndex)
    ));
}
