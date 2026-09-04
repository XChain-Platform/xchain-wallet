// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// protocolFeeRow. The words the authoring fee row says, derived from
// what the form actually knows about the fee.
//
// The row used to be written as if every action it appears on charges a
// protocol fee. On LTC/DOGE, where a later change turns it into a statement rather
// than a choice, that read "Protocol fee is paid in LTC ... The fee is sent
// on-chain and is not refunded if the network rejects this transaction" on
// MINT, BROADCAST, DESTROY, SLEEP, SWEEP, LIST create/fork, LINK, PUBLISH,
// ATTACH and address preferences, none of which have a gas-schedule entry, and
// on ORDER/SWAP/DISPENSER under UNIFIED_EXPIRATION_FEE_FREE_DAYS, which is the
// ordinary case for anything created by hand. `/feequote?action=BROADCAST`
// prices exactly zero on RBTC, RLTC and RDOGE alike, and the submit path
// handles that correctly (`applyNativeFeePreflight` builds no fee output for a
// zero quote); only the screen was claiming a charge.
//
// The client is deliberately NOT given a list of unpriced actions to check
// against. That list is consensus knowledge (the indexer's gas schedule plus
// the expiration free-days rule), it changes without the wallet, and a stale
// copy of it would go on lying in the confident voice. Instead the row takes
// the fee the FORM already holds, when it holds one, and otherwise speaks
// conditionally:
//
//   free    the form quoted the action and the answer was zero  -> say so, and
//           drop the forfeiture warning: there is nothing to forfeit
//   priced  the form quoted a positive fee -> today's definite wording, with
//           the amount when the quote carries one
//   unknown no quote in hand -> state the RULE ("protocol fees are paid in
//           LTC ... if this action charges one") instead of asserting a charge
//
// The unknown voice is the one every un-quoted surface lands in, and it is the
// point of the fix: it is true whether or not the action turns out to be
// priced, so no surface has to be enumerated for it to stop over-promising.
// The exact figure still arrives at the confirm screen, which quotes for real
// (protocolFeeDisclosure / the native pre-flight).

import { NATIVE_FEE_UNVERIFIED_NOTICE, nativeFeeToggleLabel } from '../sdk/nativeFeePreflight.js';

/**
 * @typedef {Object} NormalizedProtocolFee
 * @property {boolean} known   the form has an answer at all
 * @property {boolean} free    known AND the answer is zero
 * @property {string|null} amount  the XCHAIN-denominated fee, trailing zeros
 *   trimmed; null when priced-but-unquantified, or when not known
 */

/**
 * Read whatever fee-ish thing a form is holding into the three answers the row
 * can speak in.
 *
 * Tolerant by design: forms hold fee figures in several shapes already (the
 * bet-feed create quote's `{ free, fee }`, a `/feequote` or `/preflight`
 * answer's `xchainFee`, a bare decimal string), and a caller that has to
 * reshape its quote first is a caller that will wire it wrong or not at all.
 * Anything unrecognized answers "unknown", never "free": guessing zero is the
 * failure this whole module exists to stop, just in the opposite direction.
 *
 * Amounts are compared as STRINGS, never through Number: a fee is an 8dp
 * decimal and a float round-trip is the one thing a fee display must not do.
 *
 * @param {null|undefined|number|string|{ free?: boolean, fee?: string|number|null,
 *   xchainFee?: string|number|null, amount?: string|number|null }} fee
 * @returns {NormalizedProtocolFee}
 */
export function normalizeProtocolFee(fee) {
    if (fee === null || fee === undefined) return UNKNOWN;

    if (typeof fee === 'number' || typeof fee === 'string') return fromAmount(fee);

    if (typeof fee !== 'object') return UNKNOWN;

    // An explicit `free` verdict is the quote's own answer and outranks the
    // amount beside it (they agree in practice; when they disagree the verdict
    // is the one the pricing code computed).
    if (fee.free === true) return { known: true, free: true, amount: null };

    const raw = firstPresent(fee.xchainFee, fee.fee, fee.amount);
    if (raw !== undefined) {
        const parsed = fromAmount(raw);
        // `free: false` beside an unparsable amount still means "charged", we
        // just cannot say how much.
        if (!parsed.known && fee.free === false) return { known: true, free: false, amount: null };
        return parsed;
    }

    if (fee.free === false) return { known: true, free: false, amount: null };
    return UNKNOWN;
}

/**
 * The label + hint for the authoring fee row.
 *
 * @param {object} args
 * @param {*} [args.fee]              whatever the form holds; see normalizeProtocolFee
 * @param {string} args.coinTicker    native coin ticker (BTC/LTC/DOGE)
 * @param {boolean} [args.mandatory] chain has no XCHAIN fee lane
 * @param {boolean} [args.checked]    native-coin payment selected (Bitcoin only)
 * @param {boolean} [args.unverified] priced without a verdict (DEPLOY/EXECUTE)
 * @returns {{ variant: 'statement'|'toggle', label: string, hint: string }}
 *   `statement` renders as plain text (nothing to choose); `toggle` renders the
 *   switch. A free action is always a statement, on every chain: on Bitcoin the
 *   switch would otherwise offer a payment mode for a payment that never happens.
 */
export function protocolFeeRowCopy({
    fee, coinTicker, mandatory = false, checked = false, unverified = false,
} = {}) {
    const f = normalizeProtocolFee(fee);

    if (f.free) {
        return {
            variant: 'statement',
            label: 'This action has no protocol fee',
            hint: 'Only the network fee applies, so there is nothing to pay on top of it.',
        };
    }

    // Forfeiture is real money only when a fee is actually paid in coin. On
    // Bitcoin with the switch off it is an XCHAIN balance debit, which costs
    // nothing when the action is rejected.
    const paysInCoin = mandatory || checked;
    const forfeit = f.known
        ? 'The fee is sent on-chain and is not refunded if the network rejects this transaction.'
        : 'If this action charges one, it is sent on-chain and is not refunded if the network'
          + ' rejects this transaction.';
    const unverifiedNotice = (unverified && paysInCoin) ? ` ${NATIVE_FEE_UNVERIFIED_NOTICE}` : '';
    const amountSentence = f.amount ? `This action's protocol fee is ${f.amount} XCHAIN. ` : '';

    if (mandatory) {
        return {
            variant: 'statement',
            // Plural and general when unquoted: it describes how this chain
            // settles protocol fees, which is true of an action that charges
            // nothing too. Singular only once a charge is actually known.
            label: f.known ? `Protocol fee is paid in ${coinTicker}` : `Protocol fees are paid in ${coinTicker}`,
            hint: `${amountSentence}${coinTicker} is the only way to pay a protocol fee on this chain.`
                + ` ${forfeit}${unverifiedNotice}`,
        };
    }

    return {
        variant: 'toggle',
        // Shared with the refusal copy: nativeFeeErrorMessage tells the user to untick
        // this control BY NAME, and a second copy of the words is a second thing to
        // forget.
        label: nativeFeeToggleLabel(coinTicker),
        hint: `${amountSentence}${forfeit}${unverifiedNotice}`,
    };
}

const UNKNOWN = Object.freeze({ known: false, free: false, amount: null });

// The first argument that was actually supplied, so a quote carrying
// `xchainFee: null` (the indexer's "the dry-run never staged a fee record")
// is read as null rather than falling through to a sibling field.
function firstPresent(...values) {
    for (const v of values) if (v !== undefined) return v;
    return undefined;
}

// A fee figure as the wire carries it: a non-negative decimal, or a number
// that is one. Anything else (null, '', 'n/a', NaN) is unknown.
function fromAmount(raw) {
    if (raw === null) return UNKNOWN;
    const s = typeof raw === 'number'
        ? (Number.isFinite(raw) ? String(raw) : '')
        : String(raw).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return UNKNOWN;
    // Zero is any all-zero decimal: '0', '0.00000000', '0.0'.
    if (!/[1-9]/.test(s)) return { known: true, free: true, amount: null };
    return { known: true, free: false, amount: trimDecimal(s) };
}

// '0.16500000' -> '0.165', '1.00000000' -> '1'. Whole numbers pass through.
function trimDecimal(s) {
    if (!/^\d+\.\d+$/.test(s)) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}
