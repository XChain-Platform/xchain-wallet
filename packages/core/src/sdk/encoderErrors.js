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
//   1. `code` does NOT survive the messaging boundary. A form running in the
//      popup receives the error through MessageHost.serializeError, whose
//      envelope carries only `{ name, message }`. `name` survives ('SDKEncoderError'),
//      the code does not, so the code is recovered from the message text as
//      well - the same message-parsing trick nativeFeePreflight uses to get its
//      refusal reason back.
//
//   2. The amount rides in the message too. The one thing that makes the
//      NO_UTXOS sentence genuinely useful is the amount the address is short:
//      the native-fee pre-flight already quoted it (/feequote) moments before
//      the encoder call that failed, so the build paths stamp it onto the error
//      with `annotateEncoderFeeRequirement` and it is parsed back out here. A
//      caller that has the quote to hand can pass `requiredNative` instead.

// Suffix `annotateEncoderFeeRequirement` appends; `requiredFeeFromError` parses
// it back. Only the AMOUNT rides along: the quote has no ticker field, and the
// form that renders the sentence already knows which chain it is on.
const FEE_REQUIREMENT_RE = /; protocol fee requires ([0-9]+(?:\.[0-9]+)?) in native coin$/;

// A code recovered from the developer-facing message, for the boundary-crossed
// case where `err.code` is gone. Ordered most-specific first; ENCODER_HTTP_*
// carries its status through the capture group.
const MESSAGE_TO_CODE = [
    [/no spendable UTXOs found for the funding address/i, 'NO_UTXOS'],
    [/utxo-tracker view is not synced/i, 'UTXO_TRACKER_STALE'],
    [/requires pubkey/i, 'MISSING_PUBKEY'],
    [/requires p2shHash/i, 'MISSING_P2SH_HASH'],
    [/requires p2shHex/i, 'MISSING_P2SH_HEX'],
    [/requires txHex/i, 'MISSING_TX_HEX'],
    [/getUTXOs requires address/i, 'MISSING_ADDRESS'],
    [/createTx requires data \(ACTION string\)/i, 'MISSING_DATA'],
    [/Encoder request timed out/i, 'ENCODER_TIMEOUT'],
    [/Encoder request failed:/i, 'ENCODER_NETWORK'],
    [/Encoder returned HTTP (\d{3})/i, 'ENCODER_HTTP_$1'],
    [/Encoder RPC error:/i, 'ENCODER_RPC_ERROR'],
];

// Codes that mean "this request was malformed before it ever left the wallet".
// A user cannot act on any of them; the honest sentence says so and asks for a
// report rather than implying they typed something wrong.
const WALLET_BUG_CODES = new Set([
    'MISSING_PUBKEY', 'MISSING_ADDRESS', 'MISSING_DATA',
    'MISSING_TX_HEX', 'MISSING_P2SH_HASH', 'MISSING_P2SH_HEX',
]);

/**
 * The SDK encoder error code, however the error reached us.
 *
 * @param {unknown} err
 * @returns {string|null}   null when this is not a recognisable encoder error
 */
export function encoderErrorCode(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    const code = typeof e.code === 'string' ? e.code : '';
    // A raw axios/network error also has a `code` (ECONNABORTED, ENOTFOUND);
    // only codes the SDK actually mints count, so those fall through to the
    // message match and, failing that, to null.
    if (code && (WALLET_BUG_CODES.has(code) || code === 'NO_UTXOS' || code === 'UTXO_TRACKER_STALE'
        || code.startsWith('ENCODER_'))) {
        return code;
    }
    const message = String(e.message || '');
    for (const [pattern, mapped] of MESSAGE_TO_CODE) {
        const m = pattern.exec(message);
        if (m) return mapped.replace('$1', m[1] || '');
    }
    return null;
}

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
    if (!code) return null;
    const coin = coinTicker || 'native coin';
    const needed = trimAmount(requiredNative) || requiredFeeFromError(err);

    if (code === 'NO_UTXOS') {
        const need = needed
            ? `It needs about ${needed} ${coin} to cover the protocol fee, plus a little more for the network fee.`
            : `It needs ${coin} to cover the protocol fee and the network fee.`;
        return `This address has no ${coin} to spend. ${need} Add ${coin} to this address and try again.`;
    }

    if (code === 'UTXO_TRACKER_STALE') {
        return 'The service that tracks your spendable balance is still catching up with the chain, so the '
            + 'wallet will not build a transaction from what it can currently see. This is a delay on our '
            + 'side, not a problem with your wallet or your address. Nothing was signed or sent. Wait a '
            + 'moment and try again.';
    }

    if (WALLET_BUG_CODES.has(code)) {
        return 'This transaction request was incomplete, which is a fault in the wallet rather than anything '
            + `you did. Nothing was signed or sent. Please report it, quoting "${code}".`;
    }

    if (code === 'ENCODER_TIMEOUT') {
        return 'The transaction service did not answer in time. Nothing was signed or sent, so nothing was '
            + 'spent. Try again in a moment.';
    }

    if (code === 'ENCODER_NETWORK') {
        return 'The wallet could not reach the transaction service. Nothing was signed or sent, so nothing '
            + 'was spent. Check your connection and try again.';
    }

    if (code.startsWith('ENCODER_HTTP_')) {
        const status = code.slice('ENCODER_HTTP_'.length);
        // 5xx and 429 are the service having a bad minute; a 4xx is a request it
        // refused, which retrying will not fix.
        const retryable = status === '429' || status.startsWith('5');
        return retryable
            ? `The transaction service is temporarily unavailable (error ${status}). Nothing was signed or `
              + 'sent, so nothing was spent. Try again in a moment.'
            : `The transaction service refused this request (error ${status}). Nothing was signed or sent, `
              + 'so nothing was spent. If it keeps happening, please report it.';
    }

    if (code === 'ENCODER_RPC_ERROR') {
        const reason = rpcReasonFromError(err);
        return 'This transaction could not be built. Nothing was signed or sent, so nothing was spent.'
            + (reason ? ` The service reported: ${reason}` : '');
    }

    // An ENCODER_* code minted after this mapper was written. Say the safe,
    // true thing rather than fall through to the wire wording.
    return 'The transaction service could not complete this request. Nothing was signed or sent, so nothing '
        + 'was spent. Try again in a moment.';
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
