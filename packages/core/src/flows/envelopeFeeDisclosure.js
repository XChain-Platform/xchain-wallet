// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// envelopeFeeDisclosure. The confirm screen's two-transaction lines for a
// Taproot envelope: the commit that funds the envelope and the reveal that
// publishes it, each with its own miner fee, both signed on one Approve.

import { satsToCoinDecimal } from './feeEstimate.js';

/**
 * @typedef {Object} EnvelopeTransactionLine
 * @property {'commit'|'reveal'} role
 * @property {number|null} feeSats   NULL when the fee is not knowable from the bytes
 * @property {string} text           the full line to render
 */

// A fee line for one transaction, or a plain statement that it is unknown.
function feePhrase(sats, tick) {
    if (!Number.isFinite(sats)) return 'fee not known from the built transaction';
    return `fee ${satsToCoinDecimal(sats)}${tick ? ` ${tick}` : ''}`;
}

/**
 * The commit and reveal lines for a confirm screen, or null off the envelope lane.
 *
 * @param {object} [args]
 * @param {{ revealPsbt?: string|null,
 *   envelopeFees?: { commitFeeSats: number|null, revealFeeSats: number|null }|null }|null} [args.composed]
 *   the composed-action envelope (composeActionForConfirm)
 * @param {string} [args.ticker]   the chain's native ticker
 * @returns {EnvelopeTransactionLine[] | null}
 */
export function envelopeTransactionLines({ composed, ticker } = {}) {
    if (!composed?.revealPsbt || !composed?.envelopeFees) return null;
    const tick = ticker ? String(ticker) : '';
    const { commitFeeSats, revealFeeSats } = composed.envelopeFees;
    return [
        {
            role: 'commit',
            feeSats: Number.isFinite(commitFeeSats) ? commitFeeSats : null,
            text: `1. Commit transaction: funds the envelope, ${feePhrase(commitFeeSats, tick)}`,
        },
        {
            role: 'reveal',
            feeSats: Number.isFinite(revealFeeSats) ? revealFeeSats : null,
            // Names why there is a second transaction, so it does not read as a duplicate.
            text: `2. Reveal transaction: publishes the data and returns the rest to you, `
                + `${feePhrase(revealFeeSats, tick)}`,
        },
    ];
}
