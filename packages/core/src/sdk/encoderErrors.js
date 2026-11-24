// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// encoderErrors: the wallet's translation of xchain-sdk encoder
// failures into sentences a person can act on.
//
// The SDK throws SDKEncoderError with a machine-readable `code` and a message
// written for a developer reading a stack trace ("no spendable UTXOs found for
// the funding address", "utxo-tracker view is not synced; refusing to select
// utxos from it"). Until this module existed the wallet read none of it: every
// one of those strings reached the user verbatim, so an address with no coin in
// it was told about UTXOs, and a stale tracker - a service-side fault the user
// cannot do anything about - was worded so it read as their mistake.
//
// Two design points, both forced by how these errors actually travel:
//
//   1. `details` does NOT survive the messaging boundary. A form running in the
//      popup receives the error through MessageHost.serializeError, whose
//      envelope carries `name`, `message` and `code` but nothing from `details`,
//      so an ENCODER_RPC_ERROR loses its `data.reason` and the reason is
//      recovered from the message text - the same message-parsing trick
//      nativeFeePreflight uses to get its refusal reason back.
//
//   2. The amount rides in the message too. The one thing that makes the
//      NO_UTXOS sentence genuinely useful is the amount the address is short:
//      the native-fee pre-flight already quoted it (/feequote) moments before
//      the encoder call that failed, so the build paths stamp it onto the error
//      with `annotateEncoderFeeRequirement` and it is parsed back out here. A
//      caller that has the quote to hand can pass `requiredNative` instead.

// The rate-limit sentence is shared with the explorer mapper rather than
// written twice: Home re-renders it once a second off a shrinking count, so a
// second copy of the wording here would drift from the one on screen. Only the
// subject differs ("The transaction service").
import { rateLimitRetryAfterSeconds, rateLimitedMessage } from './explorerErrors.js';
import { encoderFieldError } from './encoderFieldErrors.js';
import { ENCODER_CATCH_ALL_REASON } from './encoderCatchAll.js';
import { WALLET_BUG_CODES, encoderErrorCode, hasWalletEncoderCopy } from './encoderErrorCode.js';

export { encoderErrorCode, hasWalletEncoderCopy };

// Suffix `annotateEncoderFeeRequirement` appends; `requiredFeeFromError` parses
// it back. Only the AMOUNT rides along: the quote has no ticker field, and the
// form that renders the sentence already knows which chain it is on.
const FEE_REQUIREMENT_RE = /; protocol fee requires ([0-9]+(?:\.[0-9]+)?) in native coin$/;


const NOTHING_SPENT = 'Nothing was signed or sent, so nothing was spent.';
const UNKNOWN_ENCODER_FAILURE = `This transaction could not be built. ${NOTHING_SPENT}`;
const TEMPORARY_ENCODER_FAILURE = 'The transaction service could not complete this request. Nothing was signed or sent, '
    + 'so nothing was spent. Try again in a moment.';
const UNINFORMATIVE_RPC_REASON = /^(?:internal encoder error|(?:(?:future )?internal|unknown|unexplained) (?:error|failure|refusal))\.?$/i;
const INTERNAL_RPC_FAILURE = /^internal (?:server )?error\b/i;


/**
 * True when this error came from the SDK encoder client.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isEncoderError(err) {
    if (!err || typeof err !== 'object') return false;
    if (/** @type {any} */ (err).name === 'SDKEncoderError') return true;
    return encoderErrorCode(err) !== null;
}

/**
 * Stamp the native-coin amount this action needed onto a failed encoder call.
 *
 * Called by the build paths, which hold the pre-flight quote at the moment
 * createTx throws. Written into the MESSAGE rather than a field because a field
 * would be dropped crossing into the popup (see the header). No-op for anything
 * that is not an encoder error, and for a build with no native-fee quote.
 *
 * @param {unknown} err
 * @param {{ requiredFeeNative?: string|number } | null} [quote]  the native-fee pre-flight quote
 * @returns {unknown}   the same error, for `throw annotateEncoderFeeRequirement(err, quote)`
 */
export function annotateEncoderFeeRequirement(err, quote) {
    if (!quote || typeof quote !== 'object' || !isEncoderError(err)) return err;
    const amount = trimAmount(quote.requiredFeeNative);
    if (!amount || amount === '0') return err;
    const e = /** @type {any} */ (err);
    const message = String(e.message || '');
    if (FEE_REQUIREMENT_RE.test(message)) return err;
    try {
        e.message = `${message}; protocol fee requires ${amount} in native coin`;
    } catch {
        // A frozen error object keeps its original message; the mapper simply
        // omits the amount rather than losing the whole translation.
    }
    return err;
}

function encoderServiceMessage(code, err) {
    if (code === 'ENCODER_TIMEOUT') {
        return 'The transaction service did not answer in time, but nothing was signed or sent, and nothing was spent. '
            + 'Try again in a moment.';
    }

    if (code === 'ENCODER_NETWORK') {
        return 'The wallet could not reach the transaction service, but nothing was signed or sent, and nothing was spent. '
            + 'Check your connection and try again.';
    }

    if (code === 'ENCODER_HTTP_429') {
        // A rate limit, not an outage: the service is up and said how long to
        // wait (rate-limits spec, M4). No countdown on this path, unlike Home's
        // banner - a submit is not re-run for the user, so the sentence says
        // the number once and the pre-signature reassurance closes it.
        return `${rateLimitedMessage(rateLimitRetryAfterSeconds(err), { subject: 'The transaction service' })} `
            + 'Nothing was signed or sent, so nothing was spent.';
    }

    if (code.startsWith('ENCODER_HTTP_')) {
        const status = code.slice('ENCODER_HTTP_'.length);
        // A 5xx is the service having a bad minute; a 4xx is a request it
        // refused, which retrying will not fix. 429 left this branch above.
        const retryable = status.startsWith('5');
        return retryable
            ? `The transaction service is temporarily unavailable (error ${status}), but nothing was signed `
              + 'or sent, and nothing was spent. Try again in a moment.'
            : `The transaction service refused this request (error ${status}), but nothing was signed or sent, `
              + 'and nothing was spent. If it keeps happening, please report it.';
    }

    if (code === 'ENCODER_RPC_ERROR') {
        const reason = rpcReasonFromError(err);
        if (isInternalRpcFailure(err, reason)) return TEMPORARY_ENCODER_FAILURE;
        if (reason && !UNINFORMATIVE_RPC_REASON.test(reason)) {
            return `This transaction could not be built. Nothing was signed or sent, so nothing was spent. `
                + `The service reported: ${reason}`;
        }
        return UNKNOWN_ENCODER_FAILURE;
    }

    // An ENCODER_* code minted after this mapper was written. Say the safe,
    // true thing rather than fall through to the wire wording.
    return TEMPORARY_ENCODER_FAILURE;
}

/** A JSON-RPC service failure, not a protocol verdict the person can act on. */
function isInternalRpcFailure(err, reason) {
    // The encoder's catch-all is excluded before the -32603 rule below so the
    // same sentence shows whether or not the RPC details survived messaging.
    if (ENCODER_CATCH_ALL_REASON.test(String(reason || ''))) return false;
    if (INTERNAL_RPC_FAILURE.test(String(reason || ''))) return true;
    const e = /** @type {any} */ (err || {});
    const rpcError = e.details?.rpcError || e.rpcError;
    const rpcCode = Number(rpcError?.code);
    if (rpcCode === -32603) return true;
    if (!Number.isInteger(rpcCode) || rpcCode < -32099 || rpcCode > -32000) return false;
    const protocolReason = rpcError?.data?.reason || e.details?.context?.reason || e.data?.reason;
    return !String(protocolReason || '').trim();
}

/**
 * The sentence to show a user when an SDK encoder call failed.
 *
 * @param {unknown} err
 * @param {object} [opts]
 * @param {string} [opts.coinTicker]      native coin of the chain being built on (BTC/LTC/DOGE)
 * @param {string|number} [opts.requiredNative]  native-coin protocol fee for this action, when known
 * @returns {string|null}   null when this is not an encoder error (caller keeps its own copy)
 */
export function encoderErrorMessage(err, { coinTicker, requiredNative } = {}) {
    const code = encoderErrorCode(err);
    if (!code) {
        return isEncoderError(err)
            ? 'The transaction service could not complete this request. Nothing was signed or sent, so nothing was spent.'
            : null;
    }
    // A fee under the relay minimum or an amount the inputs cannot cover is the
    // person's to fix, in a field they can see; say that in the coin's units,
    // closed by the same pre-signature reassurance every other refusal here gives.
    if (code === 'ENCODER_RPC_ERROR') {
        const fieldError = encoderFieldError(err, { coinTicker });
        if (fieldError) return `${fieldError.message} ${NOTHING_SPENT}`;
    }
    const coin = coinTicker || 'native coin';
    const needed = trimAmount(requiredNative) || requiredFeeFromError(err);

    if (code === 'NO_UTXOS') {
        const need = needed
            ? `about ${needed} ${coin} for the protocol fee, plus a little more for the network fee`
            : `${coin} for the protocol fee and the network fee`;
        return `This address needs ${need}; add ${coin} to this address and try again.`;
    }

    if (code === 'UTXO_TRACKER_STALE') {
        return 'The service that tracks your spendable balance is still catching up; this delay is on our '
            + 'side, not a problem with your wallet or your address; nothing was signed or sent, and nothing was spent. '
            + 'Wait a moment and try again.';
    }

    if (WALLET_BUG_CODES.has(code)) {
        return 'This transaction request was incomplete, which is a fault in the wallet rather than anything '
            + `you did. Nothing was signed or sent. Please report it, quoting "${code}".`;
    }

    return encoderServiceMessage(code, err);
}

/** The original encoder wording for a collapsed technical-details control. */
export function encoderErrorDetails(err) {
    return isEncoderError(err)
        ? String((err && /** @type {any} */ (err).message) || '').trim()
        : '';
}

/** The amount `annotateEncoderFeeRequirement` wrote into the message, if any. */
function requiredFeeFromError(err) {
    if (!err || typeof err !== 'object') return null;
    const m = FEE_REQUIREMENT_RE.exec(String(/** @type {any} */ (err).message || ''));
    return m ? m[1] : null;
}

/** The service's own reason, with the SDK's developer prefix taken off. */
function rpcReasonFromError(err) {
    const message = String((err && /** @type {any} */ (err).message) || '')
        .replace(FEE_REQUIREMENT_RE, '');
    const m = /Encoder RPC error:\s*(.+)$/is.exec(message);
    const reason = m ? m[1].trim() : '';
    if (!reason) return null;
    // The service's string is a fragment, not a sentence; close it so the copy
    // it is appended to still reads as one.
    return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

/** "20.00000000" -> "20"; leaves a genuinely fractional amount alone. */
function trimAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) return null;
    return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
