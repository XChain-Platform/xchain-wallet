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
import { humanizeError } from './humanizeError.js';
import { actionDisplayLabel } from './actionDisplayLabel.js';
import { CHUNK_LANE_OPENER_RE } from './chunkLaneCopy.js';

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
    // Same shape and the same remedy sentence: the chunk lane refused
    // pre-dispatch because the injected hardware/remote signer cannot sign
    // the reveal (submitWithSigner.js#HardwareChunkLaneError).
    if (e.name === 'HardwareChunkLaneError') return true;
    // Same shape: a single-encode compose refused a TAPROOT envelope it cannot
    // carry (submitWithSigner.js#EnvelopeConfirmLaneError).
    if (e.name === 'EnvelopeConfirmLaneError') return true;
    return CHUNK_LANE_OPENER_RE.test(String(e.message || ''));
}

/**
 * The heading for a transaction that was signed and then failed to reach a
 * node. Shared by every queued done screen so they say one thing.
 */
export const SIGNED_NOT_BROADCAST_TITLE = 'Signed. Not broadcast yet.';

/**
 * The sentence for a transaction that was signed and then failed to reach a
 * node. Shared with QueuedResultPanel's hint so the two surfaces agree.
 *
 * this used to promise an automatic re-broadcast, and nothing in the
 * wallet re-broadcasts anything on its own. The only
 * caller of the broadcast route is the user pressing "Broadcast now" in
 * QueuedBroadcastBanner; what the wallet does on its own is show a toast when
 * reachability flips back to normal. So the copy promises exactly that - a
 * reminder - and says who does the sending. Change it back only alongside a
 * real auto-drain; test/smoke/ui/queued-broadcast-copy.smoke.js fails if the
 * two ever disagree again.
 */
export const SIGNED_NOT_BROADCAST_MESSAGE =
    'Your transaction is signed but could not reach the network. It is waiting in the '
    + 'queued-transactions banner and only goes out when you broadcast it from there; the '
    + 'wallet reminds you when the network is back. Do not submit this again.';

/**
 * The warning for a signed transaction that could not be saved to the queue
 * and exists only in the current window until the user preserves it.
 */
export const SIGNED_NOT_BROADCAST_UNSAVED_WARNING =
    'Your signed transaction could not be saved to the queue. It is held only in this window '
    + 'and will be lost if the window closes. Broadcast it now from the queued-transactions '
    + 'banner, or copy the signed bytes first.';

let queuedResultHandoff = null;

export function setQueuedResultHandoff(result) {
    queuedResultHandoff = result;
}

export function readQueuedResultHandoff() {
    return queuedResultHandoff;
}

export function clearQueuedResultHandoff() {
    queuedResultHandoff = null;
}

const NETWORK_FEE_TOO_LOW_MESSAGE =
    'The network rejected this transaction because its fee is too low.';

function isCommitFeeTooLowBroadcast(err) {
    const message = err && typeof err === 'object'
        ? String(/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    return /^broadcast failed \(commit\):/i.test(message.trim())
        && /\b(?:min(?:imum)?[-\s]+relay[-\s]+fee|fee[-\s]+too[-\s]+low)\b/i.test(message);
}

// Read the per-chain action gates' refusals (registry/actions.js and the nested
// BATCH check) off the message alone, since only `{ name, message }` crosses the
// messaging boundary; the thrown text keeps the composer name and chain id for logs.
const CHAIN_GATE_PREFIX = '^[A-Za-z][A-Za-z0-9]*: ';
const BITCOIN_ONLY_RE = new RegExp(`${CHAIN_GATE_PREFIX}([A-Z_]+) version (\\d+) is accepted on Bitcoin only, not on \\S+$`);
const NOT_ON_BITCOIN_RE = new RegExp(`${CHAIN_GATE_PREFIX}([A-Z_]+) version (\\d+) is not accepted on Bitcoin$`);
const VALIDATOR_LANE_RE = new RegExp(`${CHAIN_GATE_PREFIX}validator staking actions are accepted on Bitcoin only, not on \\S+$`);
const NESTED_VERSION_RE = new RegExp(`${CHAIN_GATE_PREFIX}([A-Z_]+) version is unreadable in a nested sub-action$`);

/**
 * The sentence for a per-chain action-gate refusal, or null for any other error.
 *
 * @param {unknown} err
 * @returns {string | null}
 */
export function chainGateErrorMessage(err) {
    const message = (err && typeof err === 'object')
        ? String(/** @type {any} */ (err).message || '').trim()
        : (typeof err === 'string' ? err.trim() : '');
    if (!message) return null;
    let m = BITCOIN_ONLY_RE.exec(message);
    if (m) {
        return `${actionDisplayLabel(m[1])} version ${m[2]} works only on Bitcoin. `
            + 'Send it from a Bitcoin address, or remove that action.';
    }
    m = NOT_ON_BITCOIN_RE.exec(message);
    if (m) {
        return `${actionDisplayLabel(m[1])} version ${m[2]} cannot be sent from a Bitcoin address. `
            + 'Send it from an address on another chain, or remove that action.';
    }
    if (VALIDATOR_LANE_RE.test(message)) {
        return 'Validator staking works only on Bitcoin. Send it from a Bitcoin address.';
    }
    m = NESTED_VERSION_RE.exec(message);
    if (m) {
        return `A ${actionDisplayLabel(m[1])} step in this batch has no readable version. `
            + 'Check the VERSION value in that step\'s parameters.';
    }
    return null;
}

/**
 * Turn a caught submit error into the sentence to show.
 *
 * @param {unknown} err
 * @param {object} [opts]
 * @param {string} [opts.coinTicker]   native coin of the chain being submitted on (BTC/LTC/DOGE)
 * @param {boolean} [opts.mandatory]   chain has no XCHAIN fee lane (useNativeFee's `mandatory`)
 * @param {string} [opts.chainId]      the chain being submitted on ('bitcoin-testnet'). Only the
 *   network half is read, and only to say whether XCHAIN can be minted here; omitting it costs
 *   that one sentence and nothing else.
 * @param {string} [opts.networkKind]  'mainnet' | 'testnet' | 'regtest', for a caller holding the
 *   descriptor rather than the id
 * @param {string|number} [opts.requiredNative]  native-coin protocol fee, when the caller holds
 * the quote; otherwise read off the error
 * @param {string} [opts.fallback]     the form's own copy for everything else
 * @param {string} [opts.verb]         action named in the generic opener ("Couldn't <verb>.")
 * @returns {string}
 */
export function submitFailureMessage(
    err, { coinTicker, mandatory = false, chainId, networkKind, requiredNative, fallback = '', verb = 'complete this' } = {},
) {
    if (isNativeFeeForfeit(err)) {
        return nativeFeeErrorMessage(err, { coinTicker, mandatory, chainId, networkKind });
    }
    // Before every other classifier and before the fallback: the error already
    // carries the whole remedy, and nothing else here would recognise it.
    if (isWatcherChunkLane(err)) return String(/** @type {any} */ (err).message || '');
    if (isCommitFeeTooLowBroadcast(err)) return NETWORK_FEE_TOO_LOW_MESSAGE;
    const broadcastKind = broadcastFailureKindFromError(err);
    if (broadcastKind === 'transient') return SIGNED_NOT_BROADCAST_MESSAGE;
    // Encoder codes are checked only once the error is known NOT to be a
    // broadcast failure: a BroadcastFailedError quotes the node/encoder reason
    // in its own message, and classifying that by text would relabel a signed
    // transaction's fate as a build failure.
    if (broadcastKind === null) {
        const encoderCopy = encoderErrorMessage(err, { coinTicker, requiredNative });
        if (encoderCopy) return encoderCopy;
        // Name a per-chain gate refusal ahead of the params-builder check below.
        const chainGateCopy = chainGateErrorMessage(err);
        if (chainGateCopy) return chainGateCopy;
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
    const raw = (err && typeof err === 'object')
        ? String(/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    const fallbackText = String(fallback || '');
    if (fallbackText && fallbackText !== raw) return fallbackText;
    const humanized = humanizeError(err, verb);
    if ((fallbackText && fallbackText === raw)
        || humanized.cause !== 'unknown'
        || humanized.details) return humanized.message;
    return raw || 'The request stopped because the wallet service returned no explanation.';
}

/**
 * The collapsed technical text to pair with a message from submitFailureMessage.
 * Empty when the message already carries that text, so the same failure is
 * never drawn twice.
 *
 * @param {unknown} err
 * @param {string} message  what submitFailureMessage returned for `err`
 * @returns {string}
 */
export function submitFailureDetails(err, message) {
    const details = String(humanizeError(err).details || '').trim();
    if (!details) return '';
    const fold = (text) => String(text || '').toLowerCase().replace(/[\s.!?]+$/, '');
    return fold(message).includes(fold(details)) ? '' : details;
}
