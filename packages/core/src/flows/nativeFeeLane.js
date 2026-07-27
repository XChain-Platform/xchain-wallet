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
// WHY A PREDICTION, AND WHY IT IS CHECKED
//
// The decision has to be made BEFORE the phase-1 build, because phase 1 is
// signed and broadcast before phase 2 exists, and a second createTx would
// collide with the encoder's own outpoint reservations. There is no
// side-effect-free way to ask the encoder which lane it will choose
// (`estimateFee` is `createTx` under the covers).
//
// So the lane is predicted from the action's byte length against the SDK's
// carrier caps - the same caps pre-flight's ENCODING_TOO_LARGE check already
// uses - and then CHECKED against the encoding the encoder actually chose.
// That keeps the spec's posture of verifying rather than re-deriving (§1): a
// wrong prediction throws before anything is signed, instead of quietly
// broadcasting a transaction the indexer will reject while keeping the fee.

// Deliberately NOT imported from xchain-sdk. Core reaches the SDK only by
// injection, and pulling the package index into core's graph is what re-armed
//  earlier today (a shared index turns the MV3 worker's fallback
// import() into a dynamic chunk it cannot execute). So the cap is declared
// here and pinned to the SDK's own value by
// test/unit/flows/nativeFeeLane.test.js, which runs in Node and may import it.
// One source of truth, with a drift gate, and no import.
const OP_RETURN_ACTION_BUDGET = 76;

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
 * Will this action be carried by the two-phase (chunk) lane?
 *
 * An explicit `encoding` in the caller's encoder options wins, because the
 * encoder honours it. Otherwise the encoder picks OP_RETURN when the action
 * fits its budget and a chunk lane when it does not, which is what the byte
 * comparison mirrors.
 *
 * @param {{ actionString?: string } | null} createResult
 * @param {{ encoding?: string } | null} encoderOpts
 * @returns {boolean}
 */
export function willTakeChunkLane(createResult, encoderOpts) {
    const forced = String(encoderOpts?.encoding || '').toUpperCase();
    if (forced) return CHUNK_LANE.includes(forced);
    const actionString = createResult?.actionString;
    if (typeof actionString !== 'string' || !actionString) return false;
    return Buffer.byteLength(actionString, 'utf8') > OP_RETURN_ACTION_BUDGET;
}

/**
 * A copy of `encoderOpts` with one custom output removed. Matches on address
 * AND value so an unrelated output to the same address is left alone.
 *
 * @param {object} encoderOpts
 * @param {{ address: string, value: number }} output
 */
export function withoutCustomOutput(encoderOpts, output) {
    const outs = Array.isArray(encoderOpts?.customOutputs) ? encoderOpts.customOutputs : [];
    const kept = outs.filter((o) => !(o
        && o.address === output.address
        && Number(o.value) === Number(output.value)));
    return { ...encoderOpts, customOutputs: kept };
}

export class FeeLaneMismatchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FeeLaneMismatchError';
        this.code = 'FEE_LANE_MISMATCH';
    }
}

/**
 * The check half of the prediction: does the encoder's chosen encoding agree
 * with where the fee output was placed? Throws when it does not, so the
 * caller refuses BEFORE signing.
 *
 * @param {{ encoding?: string, deferred: boolean, hasFeeOutput: boolean }} args
 */
export function assertFeeLane({ encoding, deferred, hasFeeOutput }) {
    if (!hasFeeOutput) return;
    const isChunked = CHUNK_LANE.includes(String(encoding || '').toUpperCase());
    if (isChunked && !deferred) {
        throw new FeeLaneMismatchError(
            `The protocol fee would be paid on the wrong transaction: the encoder chose ${encoding}, `
            + 'which carries the action in a second transaction, but the fee output was placed on the first. '
            + 'Nothing was signed.',
        );
    }
    if (!isChunked && deferred) {
        throw new FeeLaneMismatchError(
            `The protocol fee would be missing: the encoder chose ${encoding}, which carries the action in `
            + 'one transaction, but the fee output was deferred to a second one that will not exist. '
            + 'Nothing was signed.',
        );
    }
}
