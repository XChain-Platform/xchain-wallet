// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// submitFailureMessage: the one place an authoring form turns a
// failed submit into a sentence.
//
// Two error shapes were reaching users as wire wording, on dozens of forms:
//
//   NativeFeeForfeitError - the native-coin protocol-fee pre-flight refused
//     before anything was signed. Its own message is built for logs
//     ("native-coin fee pre-flight failed (dust): 0.00002000 is below the
//     dust threshold"); nativeFeeErrorMessage is the sentence that says what
//     to do about it, and knows the advice differs off Bitcoin, where there
// is no XCHAIN lane to fall back to.
//
//   SDKEncoderError - the xchain-sdk encoder client refused or could not
//     complete the build, BEFORE anything was signed. Its message is written
//     for a developer ("no spendable UTXOs found for the funding address"), and
// until every one of its ten codes reached users as-is;
//     encoderErrorMessage is the sentence for each of them.
//
//   BroadcastFailedTransientError - the transaction IS signed and sitting in
//     the §49.5 rebroadcast queue. "Mint failed." is not what happened; the
//     user must know a signed copy exists so they do not submit a second one
//     (the §5.3.4 double-broadcast trap). The confirm pipeline turns this
//     into a resolved `{ queued: true }` result before a form's catch ever
//     sees it, so this branch is for the LEGACY submit path, which still
//     throws.
//
// Everything else falls through to the caller's own copy: `fallback` is the
// message the form would have shown, evaluated by the caller (humanizeError,
// a house-voice string, whatever it already had).
//
// The per-PATH point, which is the whole reason this exists: a form that
// imports the right helper and calls it on ONE of its submit paths is still
// broken on the other. found six forms that mapped the native-fee
// error in handleSign and not in the confirm path the wallet actually
// takes. Routing every path through one helper is what makes "did this form
// get swept?" a question with one answer.

import { nativeFeeErrorMessage } from '../../sdk/nativeFeePreflight.js';
import { encoderErrorMessage } from '../../sdk/encoderErrors.js';
import { explorerErrorMessage } from '../../sdk/explorerErrors.js';
import { validationErrorMessage } from '../../sdk/validationErrors.js';
import { broadcastFailureKindFromError } from '../../flows/broadcastPermanence.js';

/**
 * A native-coin fee refusal, recognised however it reached us.
 *
 * The name survives the messaging boundary (that envelope carries only
 * `{ name, message }`), and the message pattern is the belt-and-braces case
 * for an error that was re-wrapped on the way.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNativeFeeForfeit(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    if (e.name === 'NativeFeeForfeitError') return true;
    return /native-coin fee pre-flight failed \(/.test(String(e.message || ''));
}

/**
 * A watcher-lane refusal for an action the encoder chunked.
 *
 * Keyed on `name` and then on the message, for the same boundary-survival
 * reason `isNativeFeeForfeit` is: the popup receives only `{ name, message }`
 * (MessageHost.serializeError), so `instanceof` is gone by the time a form
 * classifies this and a class check would silently never match in the shell
 * where it matters most.
 *
 * It needs its own branch rather than falling through to the tail, because the
 * tail prefers each form's `fallback` over the raw message - so the sentence
 * this error exists to deliver ("a watch-only wallet cannot complete that
 * sequence, and broadcasting the half spends coin for nothing") would be
 * replaced by "Dispenser creation failed." That is the D-121 shape: a message
 * written carefully and then discarded one layer up.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isWatcherChunkLane(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    if (e.name === 'WatcherChunkLaneError') return true;
    return /too large for one transaction: the network carries it as a/.test(String(e.message || ''));
}

/**
 * The sentence for a transaction that was signed and then failed to reach a
 * node. Shared with QueuedResultPanel's hint so the two surfaces agree.
 */
export const SIGNED_NOT_BROADCAST_MESSAGE =
    'Your transaction is signed but could not reach the network. It is queued and will be '
    + 'broadcast automatically; you can track it from the queued-transactions banner. '
    + 'Do not submit this again.';

/**
 * Turn a caught submit error into the sentence to show.
 *
 * @param {unknown} err
 * @param {object} [opts]
 * @param {string} [opts.coinTicker]   native coin of the chain being submitted on (BTC/LTC/DOGE)
 * @param {boolean} [opts.mandatory]   chain has no XCHAIN fee lane (useNativeFee's `mandatory`)
 * @param {string|number} [opts.requiredNative]  native-coin protocol fee, when the caller holds
 * the quote; otherwise read off the error
 * @param {string} [opts.fallback]     the form's own copy for everything else
 * @returns {string}
 */
export function submitFailureMessage(
    err, { coinTicker, mandatory = false, requiredNative, fallback = '' } = {},
) {
    if (isNativeFeeForfeit(err)) return nativeFeeErrorMessage(err, { coinTicker, mandatory });
    // Before every other classifier and before the fallback: the error already
    // carries the whole remedy, and nothing else here would recognise it.
    if (isWatcherChunkLane(err)) return String(/** @type {any} */ (err).message || '');
    const broadcastKind = broadcastFailureKindFromError(err);
    if (broadcastKind === 'transient') return SIGNED_NOT_BROADCAST_MESSAGE;
    // Encoder codes are checked only once the error is known NOT to be a
    // broadcast failure: a BroadcastFailedError quotes the node/encoder reason
    // in its own message, and classifying that by text would relabel a signed
    // transaction's fate as a build failure.
    if (broadcastKind === null) {
        const encoderCopy = encoderErrorMessage(err, { coinTicker, requiredNative });
        if (encoderCopy) return encoderCopy;
        // A params-builder refusal happens BEFORE the encoder is called at all,
        // so it can only be reached here - and it is checked after the encoder
        // for the same reason the encoder is checked after broadcast: the more
        // specific classifier goes first. See validationErrors.js (D-118).
        const validationCopy = validationErrorMessage(err);
        if (validationCopy) return validationCopy;
        // The explorer: the third service a submit talks to, and the last one
        // whose failures were reaching users as wire wording (URL included).
        // Checked last of the three because it is the broadest - every
        // fee-bearing action reads a quote from it - and a message that matched
        // an encoder or params refusal is the more specific answer.
        const explorerCopy = explorerErrorMessage(err);
        if (explorerCopy) return explorerCopy;
    }
    const raw = (err && typeof err === 'object') ? String(/** @type {any} */ (err).message || '') : '';
    return fallback || raw || 'Something went wrong.';
}
