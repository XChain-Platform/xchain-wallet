// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// oracleFeeDisclosure. The confirm screen's oracle usage fee line.
//
// A Mode B dispenser create/refill pays its price oracle's operator as a real
// coin output (oracleFeePreflight). That output is neither miner fee nor
// protocol fee, so neither of those lines names it; this one does.

import { satsToCoinDecimal } from './feeEstimate.js';

/**
 * @typedef {Object} OracleFeeDisclosure
 * @property {string} amount   the fee in coin units, trailing zeros trimmed
 * @property {string} tick     the native ticker, '' when the caller had none
 * @property {string} text     the full line to render
 */

/**
 * The oracle usage fee line for a confirm screen, or null when these bytes
 * carry no oracle output.
 *
 * Null when there is no quote, when the quote is below dust or zero (the
 * preflight appends no output then), and when the amount is not a whole
 * positive sat count: a number the wallet cannot state exactly is absent,
 * never a zero.
 *
 * @param {object} [args]
 * @param {{ oracleFeeQuote?: { requiredFeeSats?: number|string, belowDust?: boolean } | null } | null} [args.composed]
 *   the composed-action envelope (composeActionForConfirm)
 * @param {string} [args.ticker]   the chain's native ticker
 * @returns {OracleFeeDisclosure | null}
 */
export function oracleUsageFeeLine({ composed, ticker } = {}) {
    const quote = composed?.oracleFeeQuote;
    if (!quote || quote.belowDust) return null;
    const sats = Number(quote.requiredFeeSats);
    if (!Number.isSafeInteger(sats) || sats <= 0) return null;

    const amount = satsToCoinDecimal(sats);
    const tick = ticker ? String(ticker) : '';
    return {
        amount,
        tick,
        // Names who is paid and when, so it cannot read as part of the
        // protocol fee or as a recurring charge.
        text: `Oracle usage fee: ${amount}${tick ? ` ${tick}` : ''}`
            + ' (paid once, now, to the price oracle\'s operator from this transaction)',
    };
}
