// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which transaction carries the native-coin protocol fee .
//
// The indexer validates the fee against the outputs of the transaction that
// carries the ACTION (`data['TX_OUTPUTS']` in the handlers). On the one-tx
// lane that is the only transaction there is. On the two-phase P2SH/P2WSH
// lane it is the phase-2 REVEAL: phase 1 commits to a script and carries no
// action at all.
//
// The wallet paid it on phase 1 in every case, so every chunked action that
// paid its fee in native coin spent the fee on a transaction with no action
// and was then rejected for not paying it. On LTC/DOGE the native fee is the
// ONLY lane, which made every DEPLOY unsendable, along with every large FILE,
// gated publish and multi-recipient SEND.
//
// THE FEE OUTPUT STAYS IN THE PHASE-1 BUILD, AND IS EMITTED ON PHASE 2
//
// : the first cut of this deferral removed the fee output from the
// phase-1 `createTx` call as well as from the phase-1 transaction, and that
// undersized the commit. The reveal's ONLY inputs are the phase-1 script
// outputs, so a reveal-side output has to be paid for out of value the commit
// locked up. Strip it from the build and the commit reserves nothing, and the
// reveal fails to balance - "Outputs are spending more than Inputs" - as soon
// as the fee is larger than the commit's incidental slack. It reproduced on
// litecoin-regtest at a ~0.069 LTC quote and hid on dogecoin-regtest at 2084
// sats, which is why the DOGE half of  passed and the LTC half did not.
//
// The encoder already does the right thing with a customOutput on this lane
// (xchain-encoder XChainEncoder.js, `revealCustomOutputsValue` /
// `skipCustomOutputs`): on a P2SH/P2WSH FUNDING tx it folds each customOutput's
// value AND its reveal-side byte cost into the first script output and emits
// none of them, and on the reveal it emits them. So the output must be PASSED
// to phase 1 and EMITTED on phase 2, which is what the wallet now does.
//
// WHICH TRANSACTION, DECIDED AFTER THE BUILD
//
// Placement is read off the encoding the encoder actually chose, never
// predicted from the action's byte length. It can be: the fee output no longer
// has to be removed before the build, so nothing has to be known before it.
// That is also why there is no prediction-mismatch guard here any more - a
// prediction is the only thing such a guard could catch, and both callers now
// branch on `encoded.encoding`.

import { sameSats } from './confirmChecks.js';

/** Encodings whose action rides a second, revealing transaction. */
const CHUNK_LANE = Object.freeze(['P2SH', 'P2WSH']);

/**
 * The `{address, value}` the native-fee pre-flight sized, or null when the
 * action pays no native fee. Derived from the quote rather than fished out of
 * `customOutputs`, so it cannot be confused with an ADS donation or an oracle
 * usage fee that happen to share the shape.
 *
 * @param {{ feeDestination?: string, requiredFeeSats?: number|string } | null} quote
 * @returns {{ address: string, value: number } | null}
 */
export function nativeFeeOutputOf(quote) {
    if (!quote) return null;
    const value = Number(quote.requiredFeeSats);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (typeof quote.feeDestination !== 'string' || !quote.feeDestination) return null;
    return { address: quote.feeDestination, value };
}

/**
 * Does this encoding carry the action in a SECOND transaction (the reveal)?
 *
 * Answered from the encoding the encoder reported for the transaction it just
 * built, so it is an observation rather than a guess.
 *
 * @param {string | null | undefined} encoding
 * @returns {boolean}
 */
export function isChunkEncoding(encoding) {
    return CHUNK_LANE.includes(String(encoding || '').toUpperCase());
}

/**
 * A copy of `encoderOpts` with one custom output removed. Matches on address
 * AND value so an unrelated output to the same address is left alone.
 *
 * Used to build the EXPECTED-OUTPUT set for the phase-1 PSBT, not the encoder
 * options: the deferred fee output is passed to the build (so the commit
 * reserves its value) but is not emitted on the phase-1 transaction, so it must
 * not be in the set the §5.3.2 output check says that transaction should have.
 *
 * @param {object} encoderOpts
 * @param {{ address: string, value: number }} output
 */
export function withoutCustomOutput(encoderOpts, output) {
    const outs = Array.isArray(encoderOpts?.customOutputs) ? encoderOpts.customOutputs : [];
    // Exact satoshi match, not Number() equality (): this builds the EXPECTED-OUTPUT
    // set the §5.3.2 tamper check consumes, so a >2^53 collapse here removes the wrong output
    // and reopens the same one-koinu hole from the other side.
    const kept = outs.filter((o) => !(o
        && o.address === output.address
        && sameSats(o.value, output.value)));
    return { ...encoderOpts, customOutputs: kept };
}
