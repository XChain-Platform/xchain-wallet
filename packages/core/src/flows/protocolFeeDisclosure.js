// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// protocolFeeDisclosure . The confirm screen's XCHAIN-lane
// protocol-fee line.
//
// A fee-bearing action (ISSUE, the BET_* and VM_* families, per-recipient
// AIRDROP/DIVIDEND) charges a protocol fee on top of the miner fee, and the
// confirm screen disclosed it in exactly one of the two payment lanes. In
// NATIVE-coin mode the fee rides as an output to FEE_DESTINATION, the wallet
// quotes it to size that output, and  folds that number into the
// projection. In the DEFAULT XCHAIN mode nothing was quoted, so the fee was
// invisible: the screen priced the miner fee to eight decimals and said
// nothing about the larger of the two charges.
//
// The number now arrives for free.  made `/preflight` echo the fee
// record the dry-run already staged, and the SDK lands it at
// `report.quote.xchainFee` on every confirm (an XCHAIN-denominated decimal
// string, 8dp, in EVERY payment mode - the fee row is always
// XCHAIN-denominated; native mode only changes how it is settled). So the
// disclosure needs no extra round-trip, only a reader.
//
// Which is also why the native lane must NOT take this line: it already shows
// the same fee as a native-coin debit, and adding an XCHAIN line beside it
// would read as a second, separate charge.

/** The tick every protocol fee is denominated in. */
export const PROTOCOL_FEE_TICK = 'XCHAIN';

/**
 * @typedef {Object} ProtocolFeeDisclosure
 * @property {string} amount   the fee as a decimal string, trailing zeros trimmed
 * @property {string} tick     always 'XCHAIN'
 * @property {string} text     the full line to render
 */

/**
 * The XCHAIN protocol-fee line for a confirm screen, or null when there is
 * nothing honest to say.
 *
 * Null in four cases, each deliberate:
 *   - the fee is being paid in the native coin (the composed envelope carries
 *     a quote), where it is already disclosed as a native debit;
 *   - the pre-flight report is absent or predates  (legacy `/feequote`
 *     answers carry no `xchainFee`), where the wallet does not know the fee
 *     and must not imply it is zero;
 *   - `xchainFee` is null, which means the dry-run was rejected before the
 *     handler staged a fee record - a "fee: none" line there would be a claim
 *     about an action that is not going to run;
 *   - the fee is zero, i.e. the action genuinely charges nothing.
 *
 * @param {object} [args]
 * @param {{ quote?: { xchainFee?: string|number|null } | null } | null} [args.report]
 *   the SDK PreflightReport
 * @param {{ protocolFeeSats?: number|null, quote?: object|null } | null} [args.composed]
 *   the composed-action envelope (composeActionForConfirm)
 * @returns {ProtocolFeeDisclosure | null}
 */
export function xchainProtocolFeeLine({ report, composed } = {}) {
    if (paysFeeInNativeCoin(composed)) return null;

    const raw = report?.quote?.xchainFee;
    if (raw === undefined || raw === null) return null;

    const amount = trimDecimal(String(raw).trim());
    if (!isPositiveDecimal(amount)) return null;

    return {
        amount,
        tick: PROTOCOL_FEE_TICK,
        // Plain language, and it says both things a user cannot infer from a
        // bare number: which balance it comes out of, and that (unlike a
        // native-coin fee, which is spent on broadcast either way) it is only
        // charged if the action is accepted.
        text: `Protocol fee: ${amount} ${PROTOCOL_FEE_TICK}`
            + ` (from your ${PROTOCOL_FEE_TICK} balance, charged only if the action is accepted)`,
    };
}

/**
 * Is this composed action paying its protocol fee in the native coin?
 *
 * Read off the QUOTE, not off `protocolFeeSats`: the two-phase chunk lane
 *  defers the fee output to the reveal transaction, and only the
 * quote is present on both lanes. Either field being a positive number means
 * a native-coin fee output exists somewhere in this action, so the native
 * disclosure owns the line.
 */
function paysFeeInNativeCoin(composed) {
    if (!composed) return false;
    const quoted = Number(composed.quote?.requiredFeeSats);
    if (Number.isFinite(quoted) && quoted > 0) return true;
    const sats = Number(composed.protocolFeeSats);
    return Number.isFinite(sats) && sats > 0;
}

// A plain non-negative decimal string, greater than zero. String-tested
// rather than Number-tested: the fee arrives as an 8dp decimal string and a
// float round-trip is the one thing a fee display must not do.
function isPositiveDecimal(s) {
    if (!/^\d+(\.\d+)?$/.test(s)) return false;
    return /[1-9]/.test(s);
}

// '0.50000000' -> '0.5', '1.00000000' -> '1'. Left alone if it is not a
// plain decimal, so an unexpected shape is shown verbatim rather than mangled.
function trimDecimal(s) {
    if (!/^\d+\.\d+$/.test(s)) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}
