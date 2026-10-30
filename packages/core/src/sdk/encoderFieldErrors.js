// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The encoder refuses two build requests for a reason the person at the form
// caused and can fix in one field: a fee rate under the node's relay minimum,
// and an amount plus fee larger than what the inputs hold. Its refusals are
// worded for a developer ("feePerKb 500 base units/kB produces fee 83, below
// the node relay minimum 165 base units for a ~165-byte transaction",
// "insufficient funds: selected inputs total 2000 but 2536 is required
// (outputs 1546 + fee 990)"). This module reads those two spellings off the
// message text (the only part that survives the messaging boundary, see
// encoderErrors.js) and answers with the field to mark and a sentence in the
// coin's own units.

import { decimalFromBaseUnits } from '../shared/utils/amountFormat.js';
import { perByteRateToDisplay } from '../flows/feeEstimate.js';

const RATE_BELOW_RELAY_RE = /feePerKb (\d+) base units\/kB produces fee (\d+), below the node relay minimum (\d+) base units for a ~(\d+)-byte transaction/;
const FEE_BELOW_RELAY_RE = /(?:^|[\s:])fee (\d+) is below the node relay minimum (\d+) base units for a ~(\d+)-byte transaction/;
const INSUFFICIENT_RE = /insufficient funds: selected inputs total (\d+) but (\d+) is required \(outputs (\d+) \+ fee (\d+)(?:, raised from the requested fee \d+)?\)(.*)$/s;

/** Base units as a coin-scale decimal with the ticker, trailing zeros dropped. */
function coinText(baseUnits, ticker, divisibility) {
    const decimal = decimalFromBaseUnits(String(baseUnits), divisibility);
    if (decimal == null) return `${baseUnits} base units`;
    const trimmed = decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
    return `${trimmed} ${ticker || 'coins'}`;
}

/** A rate rounded up at the places a person reads, never below the true minimum. */
function roundedUp(rate, places) {
    const factor = 10 ** places;
    return String(Math.ceil(rate * factor - 1e-9) / factor);
}

/**
 * @param {unknown} err
 * @param {object} [opts]
 * @param {string} [opts.coinTicker]      native coin of the chain (BTC, LTC, DOGE)
 * @param {string} [opts.feeUnit]         the fee selector's display unit ('sat/vB', 'DOGE/kB')
 * @param {number} [opts.divisibility]    native coin scale, 8 by default
 * @returns {{ field: 'fee' | 'amount', message: string } | null}
 *   null for every other error, and for an insufficient-funds refusal that blames
 *   reserved inputs, which no field edit fixes
 */
export function encoderFieldError(err, { coinTicker = '', feeUnit = 'sat/vB', divisibility = 8 } = {}) {
    const raw = err && typeof err === 'object'
        ? /** @type {any} */ (err).message
        : (typeof err === 'string' ? err : '');
    const text = String(raw || '');
    if (!text) return null;

    let m = RATE_BELOW_RELAY_RE.exec(text);
    if (m) {
        const minimumFee = Number(m[3]);
        const size = Number(m[4]);
        if (!(size > 0)) return null;
        const perKb = /\/kB$/.test(feeUnit);
        const minimumRate = perByteRateToDisplay(feeUnit, minimumFee / size);
        const shown = roundedUp(minimumRate, perKb ? 8 : 2);
        return {
            field: 'fee',
            message: `This fee rate is below the network minimum of ${shown} ${feeUnit}. Raise the fee rate and try again.`,
        };
    }

    m = FEE_BELOW_RELAY_RE.exec(text);
    if (m) {
        return {
            field: 'fee',
            message: `This fee is below the network minimum of ${coinText(m[2], coinTicker, divisibility)}. Raise the fee and try again.`,
        };
    }

    m = INSUFFICIENT_RE.exec(text);
    if (m) {
        if (/reserved/i.test(m[5] || '')) return null;
        const available = BigInt(m[1]);
        const required = BigInt(m[2]);
        const outputs = BigInt(m[3]);
        const fee = BigInt(m[4]);
        const short = required > available ? required - available : 0n;
        const shortText = short > 0n ? ` It is short by ${coinText(short, coinTicker, divisibility)}.` : '';
        const need = `${coinText(required, coinTicker, divisibility)} including a ${coinText(fee, coinTicker, divisibility)} network fee`;
        if (outputs === 0n) {
            return {
                field: 'fee',
                message: `This address holds ${coinText(available, coinTicker, divisibility)}, which does not cover the network fee of ${coinText(fee, coinTicker, divisibility)}.${shortText} Lower the fee or add funds.`,
            };
        }
        return {
            field: 'amount',
            message: `Not enough ${coinTicker || 'coins'}: this payment needs ${need}, and the address holds ${coinText(available, coinTicker, divisibility)}.${shortText} Lower the amount or the fee, or add funds.`,
        };
    }
    return null;
}
