// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// nativeFeeRequote: the Approve-time re-check of a native-coin
// protocol fee.
//
// A native-coin fee is a REAL output to FEE_DESTINATION, sized at COMPOSE
// from the indexer's quote, and it is forfeited when the action is rejected.
// The size the chain requires moves INVERSELY with the coin's USD price, and
// consensus accepts an output only at or above `minAcceptable`
// (0.95 x expected, FEE_TOLERANCE_MIN). So an adverse price move of a little
// over 5 % between composing and pressing Approve is enough to turn the
// attached output into a short one, and a confirm screen left open while the
// user checks something else is the ordinary way to get there.
//
// Before this, the wallet re-ran its per-block pre-flight ("Checked at block
// N") but never re-checked the AMOUNT it was about to pay, so it broadcast
// the PSBT it had already built. Measured on LTC regtest (session 22): a
// composed 0.02 LTC fee against a doubled requirement indexed
// `invalid: insufficient native coin fee`, the token was never created, and
// 0.02 LTC was spent for nothing.
//
// This module is the comparison half, kept pure so it can be tested without
// a chain and shared by every confirm surface. The fetch half is one
// `sdk.quoteNativeFee` call host-side (`action.requoteNativeFee`), which is
// the SAME call compose made; useConfirmAction runs it at Approve and refuses
// on a verdict outside the band instead of signing a transaction already
// known to fail.
//
// It compares against the band rather than against the old number: paying
// slightly more or less than the current quote is fine and must not
// interrupt anyone, and only leaving [minAcceptable, maxAcceptable] means the
// user is either about to forfeit the fee (below min) or to overpay
// materially for no benefit (above max).

import { satsToCoinDecimal } from './feeEstimate.js';

/** `code` on the error a refused re-quote raises, for callers that branch on it. */
export const NATIVE_FEE_CHANGED = 'NATIVE_FEE_CHANGED';

/** Consensus defaults, used only when a quote omits its own band. */
const DEFAULT_TOLERANCE_MIN = 0.95;
const DEFAULT_TOLERANCE_MAX = 1.10;

/**
 * @typedef {'none'|'ok'|'short'|'excess'|'unavailable'} NativeFeeRequoteVerdict
 *   - `none`        the composed action attaches no native-coin fee; nothing to check
 *   - `ok`          the attached amount is still inside the current band
 *   - `short`       below `minAcceptable`: the chain WILL reject and keep the fee
 *   - `excess`      above `maxAcceptable`: accepted, but materially overpaid
 *   - `unavailable` the fee could not be re-quoted (offline, busy, unsupported)
 */

/**
 * @typedef {Object} NativeFeeRequoteComparison
 * @property {NativeFeeRequoteVerdict} verdict
 * @property {number} paidSats         what the composed transaction pays
 * @property {number|null} expectedSats  what the fresh quote asks for
 * @property {number|null} minSats     lowest amount consensus would accept now
 * @property {number|null} maxSats     highest amount worth paying now
 * @property {string|null} coin        the quote's own ticker, when it carries one
 * @property {string|null} reason      why an `unavailable` verdict could not judge
 */

/**
 * Judge the fee output a composed action already carries against a freshly
 * fetched quote.
 *
 * An `unavailable` verdict is deliberately NOT a refusal: an unreachable
 * explorer must never hard-block a transaction that is probably fine (§4.2),
 * which is the same posture the input-liveness and pre-flight re-checks take.
 *
 * @param {Object} [args]
 * @param {{ requiredFeeSats?: number|string } | null} [args.composed]  the compose-time quote
 * @param {object | null} [args.fresh]   the Approve-time quote (sdk.quoteNativeFee)
 * @returns {NativeFeeRequoteComparison}
 */
export function compareNativeFeeQuote({ composed, fresh } = {}) {
    const paidSats = intOrNull(composed && composed.requiredFeeSats);
    const base = { paidSats: paidSats || 0, expectedSats: null, minSats: null, maxSats: null, coin: null, reason: null };
    if (!paidSats || paidSats <= 0) return { ...base, verdict: 'none' };

    const coin = fresh && typeof fresh.coin === 'string' ? fresh.coin : null;
    if (!fresh || typeof fresh !== 'object') return { ...base, verdict: 'unavailable', reason: 'no quote' };
    // `supported:false` and `valid:false` both mean the indexer did not price
    // the action THIS time. That is not evidence the composed amount is wrong,
    // and a busy quote (its admission cap) lands here too, so it cannot be
    // allowed to refuse an otherwise good transaction.
    if (fresh.supported === false) {
        return { ...base, coin, verdict: 'unavailable', reason: fresh.error || 'not quotable' };
    }
    if (fresh.valid === false) {
        return { ...base, coin, verdict: 'unavailable', reason: fresh.error || 'not priceable' };
    }

    const expectedSats = intOrNull(fresh.requiredFeeSats);
    if (expectedSats === null) {
        return { ...base, coin, verdict: 'unavailable', reason: 'quote carries no amount' };
    }

    // Bounds come from the quote's own band when it carries one (the indexer
    // formats both to 8 dp, so they convert to satoshis exactly) and are
    // derived from the tolerances only as a fallback, rounded the conservative
    // way in each direction.
    const minSats = boundSats(fresh.minAcceptable, expectedSats, fresh.toleranceMin, DEFAULT_TOLERANCE_MIN, Math.ceil);
    const maxSats = boundSats(fresh.maxAcceptable, expectedSats, fresh.toleranceMax, DEFAULT_TOLERANCE_MAX, Math.floor);

    const cmp = { ...base, coin, expectedSats, minSats, maxSats };
    if (paidSats < minSats) return { ...cmp, verdict: 'short' };
    if (paidSats > maxSats) return { ...cmp, verdict: 'excess' };
    return { ...cmp, verdict: 'ok' };
}

/** True when a comparison means "do not broadcast this". */
export function isNativeFeeRefusal(cmp) {
    return !!cmp && (cmp.verdict === 'short' || cmp.verdict === 'excess');
}

/**
 * The sentence shown on the confirm screen when a re-quote refused.
 *
 * It says all three things the user cannot infer from a number: that the fee
 * moved, that NOTHING was signed or sent, and what to do next. The `short`
 * wording names the forfeiture explicitly, since that is the whole reason the
 * wallet stopped.
 *
 * @param {NativeFeeRequoteComparison} cmp
 * @param {{ coinTicker?: string }} [opts]
 * @returns {string}
 */
export function nativeFeeRequoteMessage(cmp, { coinTicker } = {}) {
    const coin = coinTicker || (cmp && cmp.coin) || '';
    const unit = coin ? ` ${coin}` : '';
    const paid = satsToCoinDecimal(Number(cmp && cmp.paidSats) || 0);
    const now = satsToCoinDecimal(Number(cmp && cmp.expectedSats) || 0);
    if (cmp && cmp.verdict === 'excess') {
        return `The protocol fee changed while this was on screen: it now costs ${now}${unit}, `
            + `but this transaction pays ${paid}${unit}. Nothing was signed or sent. `
            + 'Go back and start the action again to pay the current fee.';
    }
    return `The protocol fee changed while this was on screen: it now costs ${now}${unit}, `
        + `but this transaction pays ${paid}${unit}. The network would reject the action and keep `
        + `the ${paid}${unit}, so nothing was signed or sent. `
        + 'Go back and start the action again to pay the current fee.';
}

/**
 * The refusal as an Error, so a surface that renders `error` (the confirm
 * modal) and one that catches (a form) both get the same sentence and the
 * same `code`.
 *
 * @param {NativeFeeRequoteComparison} cmp
 * @param {{ coinTicker?: string }} [opts]
 */
export function nativeFeeChangedError(cmp, opts) {
    const err = new Error(nativeFeeRequoteMessage(cmp, opts));
    err.name = 'NativeFeeChangedError';
    /** @type {any} */ (err).code = NATIVE_FEE_CHANGED;
    /** @type {any} */ (err).requote = cmp;
    return err;
}

/**
 * A native-coin decimal string ('0.04000000') as an integer satoshi count.
 * String arithmetic, not `Number(x) * 1e8`: a float round-trip on a fee
 * amount is exactly the error that would push a comparison across the band
 * boundary it exists to police.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function satsFromNativeDecimal(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const sats = Number(whole) * 1e8 + Number((frac + '00000000').slice(0, 8));
    return Number.isSafeInteger(sats) ? sats : null;
}

// One end of the acceptance band in satoshis: the quote's own figure when it
// has one, otherwise expected x tolerance rounded by `round` (ceil for the
// floor of the band, floor for the ceiling) so a fallback never widens it.
function boundSats(quoted, expectedSats, tolerance, fallbackTolerance, round) {
    const exact = satsFromNativeDecimal(quoted);
    if (exact !== null) return exact;
    const t = Number(tolerance);
    const factor = Number.isFinite(t) && t > 0 ? t : fallbackTolerance;
    return round(expectedSats * factor);
}

function intOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
}
