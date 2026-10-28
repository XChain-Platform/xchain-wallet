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

import { nativeFeeErrorMessage, oracleFeeRefusalMessage } from '../../sdk/nativeFeePreflight.js';
import { encoderErrorMessage } from '../../sdk/encoderErrors.js';
import { explorerErrorMessage } from '../../sdk/explorerErrors.js';
import { knownSdkErrorMessage, unknownSdkErrorCode } from '../../sdk/sdkErrorMessages.js';
import { validationErrorMessage } from '../../sdk/validationErrors.js';
import { broadcastFailureKindFromError, isSpendConflictRejection } from '../../flows/broadcastPermanence.js';
import { OFFER_LIFECYCLE_REFUSAL } from '../../flows/marketExpiry.js';
import { INPUTS_ALREADY_SPENT_NAME, NAME_SALE_IN_FLIGHT_NAME } from '../../flows/inputLiveness.js';
import { APPROVE_REFUSAL_NAME } from './approveRefusal.js';
import { humanizeError } from './humanizeError.js';
import { actionDisplayLabel } from './actionDisplayLabel.js';
import { CHUNK_LANE_OPENER_RE } from './chunkLaneCopy.js';
import { isShowableRefusal, protocolRefusalReason, userFacingMessage } from './userFacingMessage.js';
import { panicRefusalMessage } from '../safety/panicNotice.js';
import { SIGNATURE_MISMATCH_MESSAGE } from '../../signers/verifyInputSignatures.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/flows.js';

const NEXT_STEP_RE = /\b(?:add|check|choose|enter|give|reconnect|report|retry(?:ing)?|review|try|update|wait)\b/i;
const SIGNER_CANCELLED_RE = /\b(?:user (?:cancelled|canceled)|(?:cancelled|canceled) (?:by the user|on (?:the )?device)|user rejected on (?:the )?device)\b/i;

function isSignerCancellation(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    if (/^(?:Signer|User)Cancel(?:led|ed)Error$/.test(String(e.name || ''))) return true;
    return SIGNER_CANCELLED_RE.test(String(e.message || ''));
}

function compactActionableMessage(message) {
    const plain = message
        .replace(/,\s*quoting "[A-Z][A-Z0-9_]+"/g, '')
        .replace(/; retrying\./g, '; wait before trying again.');
    const sentences = plain.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 2) return plain;

    const context = sentences.slice(0, -1).map((sentence, index) => {
        const clause = sentence.replace(/[.!?]+$/, '');
        return index === 0 ? clause : clause.charAt(0).toLowerCase() + clause.slice(1);
    }).join('; ');
    return `${context}. ${sentences.at(-1)}`;
}

function safeBuildMessage(message, generic) {
    const safe = userFacingMessage(message, generic);
    const actionable = NEXT_STEP_RE.test(safe) ? safe : `${safe} Review the form and try again.`;
    return compactActionableMessage(actionable);
}

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
function isNativeFeeForfeit(err) {
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
 * A confirm-lane tamper refusal (flows/confirmChecks.js#TamperDetectedError),
 * keyed on name because only `{ name, message }` crosses the messaging boundary
 * (MessageHost.serializeError); the code covers an in-process caller.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isTamperDetected(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    return e.name === 'TamperDetectedError' || e.code === 'TAMPER_DETECTED';
}

/**
 * The heading for a transaction that was signed and then failed to reach a
 * node. Shared by every queued done screen so they say one thing.
 */
export const SIGNED_NOT_BROADCAST_TITLE = 'Signed. Not broadcast yet.';

/**
 * The sentence for a signed transaction that no node has taken. Shared with
 * ResultScreen's hint so the two surfaces agree.
 *
 * Nothing in the wallet re-broadcasts on its own. The only caller of the
 * broadcast route is the user pressing "Broadcast now" in
 * QueuedBroadcastBanner; what the wallet does on its own is show a toast when
 * reachability flips back to normal. So the copy promises exactly that, a
 * reminder, and says who does the sending. Change it only alongside a real
 * auto-drain; test/smoke/ui/queued-broadcast-copy.smoke.js fails if the two
 * disagree.
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
        && /\b(?:min(?:imum)?[-\s]+relay[-\s]+fee|fee[-\s]+too[-\s]+low|insufficient[-\s]+fee)\b/i.test(message);
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
            + 'Send it from an address on another network, or remove that action.';
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

function isSecondPhaseBroadcast(err) {
    const message = err && typeof err === 'object' ? String(/** @type {any} */ (err).message || '') : '';
    return /^broadcast failed \(phase2\)/i.test(message.trim());
}

function isNodeSpendConflict(err) {
    return broadcastFailureKindFromError(err) === 'permanent' && isSpendConflictRejection(err)
        && !isSecondPhaseBroadcast(err);
}

/**
 * A send refused because a coin it spends is taken: another send from this
 * wallet holds it (refused before signing), or the node holds a transaction
 * that spends it. Either way the balance the form showed is out of date.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isSpentCoinsRefusal(err) {
    return /** @type {any} */ (err)?.name === INPUTS_ALREADY_SPENT_NAME || isNodeSpendConflict(err);
}

const INTERRUPTED_CODES = new Set(['RUNTIME_DISCONNECTED', 'RUNTIME_NO_RESPONSE']);

export const MAINNET_PRELAUNCH_MESSAGE =
    'This action is not available on mainnet before launch. Nothing was signed. Switch to a test network to try it.';

/**
 * The refusal the signing path raises for an XChain action on a mainnet chain
 * before launch. Matched by name and code so the message survives the hop
 * through the extension background, which rebuilds errors from those two fields.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isMainnetPrelaunch(err) {
    const e = /** @type {any} */ (err);
    return Boolean(e && typeof e === 'object'
        && (e.code === 'MAINNET_PRELAUNCH' || e.name === 'MainnetPrelaunchError'));
}

/**
 * A request the extension's service worker dropped by restarting, as the
 * messaging wrapper reports it. Matched by name and code so core does not
 * import the extension package.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isActiveNetworkChanged(err) {
    const e = /** @type {any} */ (err);
    return Boolean(e && typeof e === 'object'
        && e.name === 'ActiveNetworkChangedError'
        && /^The active network changed to [a-z]+\. /.test(String(e.message || '')));
}

function isBackgroundInterrupted(err) {
    const e = /** @type {any} */ (err);
    return Boolean(e && typeof e === 'object'
        && e.name === 'RuntimeConnectionError'
        && INTERRUPTED_CODES.has(e.code)
        && String(e.message || '').trim());
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
    const generic = `Couldn't ${verb}. Something went wrong. Try again.`;
    const protocolRefusal = protocolRefusalReason(err);
    if (protocolRefusal) return protocolRefusal;
    // A freeze refusal says so only when the user armed it; a duress-armed one
    // keeps the generic line, which is the cover that flow promises.
    const panicCopy = panicRefusalMessage(err);
    if (panicCopy) return panicCopy;
    if (/** @type {any} */ (err)?.name === 'PanicModeActiveError') return generic;
    // The extension's service worker restarted while the request was in
    // flight. The error already carries the wallet's own sentence, which says
    // to review and try again; the generic line would hide that.
    if (isBackgroundInterrupted(err)) return String(/** @type {any} */ (err).message).trim();
    // The host refused a send whose network is no longer the active one, at
    // Approve or after an Undo hold. Its sentence names the remedy.
    if (isActiveNetworkChanged(err)) return String(/** @type {any} */ (err).message).trim();
    // A mainnet action refused before launch names the chain id and the word
    // "prelaunch" in its own text, which the filters below reduce to the
    // generic line. Nothing was signed, and the remedy is a test network.
    if (isMainnetPrelaunch(err)) return MAINNET_PRELAUNCH_MESSAGE;
    if (unknownSdkErrorCode(err)) return generic;
    if (isSignerCancellation(err)) {
        return 'Signing was cancelled. Nothing was signed. Review the details and try again when you are ready.';
    }
    // A device reply whose signatures do not verify: the sentence is the
    // wallet's own and says nothing was broadcast, which the form's fallback
    // or the generic line would hide. Keyed on the name that crosses messaging.
    if (/** @type {any} */ (err)?.name === 'SignatureMismatchError') return SIGNATURE_MISMATCH_MESSAGE;
    if (isNativeFeeForfeit(err)) {
        // The sentence can quote the indexer's verdict, which names the field
        // it refused ("mint exceeds MINT_ADDRESS_MAX"). The general filter
        // reads that field name as an error code and would hide the one thing
        // the user can act on, so the verdict gets the protocol-refusal check.
        const copy = nativeFeeErrorMessage(err, { coinTicker, mandatory, chainId, networkKind });
        return isShowableRefusal(copy) ? copy : userFacingMessage(copy, generic);
    }
    // The oracle pre-flight's refusal names its remedy only through the
    // indexer verdict it carries, and "wait a day" and "try again" are both
    // possible answers, so the verdict is read before the name-only SDK copy.
    const oracleRefusal = oracleFeeRefusalMessage(err, { coinTicker });
    if (oracleRefusal) return userFacingMessage(oracleRefusal, generic);
    // Before every other classifier and before the fallback: the error already
    // carries the whole remedy, and nothing else here would recognise it.
    if (isWatcherChunkLane(err)) {
        return userFacingMessage(String(/** @type {any} */ (err).message || ''), generic);
    }
    // A refused build check: its message is the wallet's own sentence about
    // the bytes it refused to sign. Forms pass that message as their fallback,
    // which the tail treats as raw wire text, so it would surface as the generic
    // line and hide that nothing was signed because the transaction differed.
    if (isTamperDetected(err)) {
        return userFacingMessage(
            `${String(/** @type {any} */ (err).message || '').trim()} Nothing was signed.`, generic,
        );
    }
    // The referenced order, swap or dispenser is expired, or its expiry cannot
    // be checked against a current chain height. The sentence is the wallet's
    // own and names the next step; forms pass it as their fallback too, which
    // the tail treats as raw wire text and would replace with the generic line.
    if (/** @type {any} */ (err)?.name === OFFER_LIFECYCLE_REFUSAL) {
        return userFacingMessage(String(/** @type {any} */ (err).message || '').trim(), generic);
    }
    // The form's own Approve-time check stopped the signature. The sentence is
    // the wallet's and names the next step; the tail would read it as wire text.
    if (/** @type {any} */ (err)?.name === APPROVE_REFUSAL_NAME) {
        return `${String(/** @type {any} */ (err).message || '').trim()} ${t('flows.submit.nothingSigned')}`;
    }
    // Another send from this wallet is spending these inputs, so the background
    // refused this one before signing. The sentence is the wallet's own and
    // names the way forward; the tail would read it as wire text.
    if (/** @type {any} */ (err)?.name === INPUTS_ALREADY_SPENT_NAME
        || /** @type {any} */ (err)?.name === NAME_SALE_IN_FLIGHT_NAME) {
        const nothingSigned = t('flows.submit.nothingSigned');
        return userFacingMessage(`${String(/** @type {any} */ (err).message || '').trim()} ${nothingSigned}`, generic);
    }
    const broadcastKind = broadcastFailureKindFromError(err);
    // The node refused the signed transaction because a coin it spends is spent
    // or held by another transaction. Nothing left the wallet, and the bytes can
    // never go out, so the sentence says that rather than quoting the node. A
    // refused second phase follows a commit that did go out, so it keeps its own copy.
    if (isNodeSpendConflict(err)) return t('flows.submit.spendConflict');
    if (isCommitFeeTooLowBroadcast(err)) return NETWORK_FEE_TOO_LOW_MESSAGE;
    if (broadcastKind === 'transient') return SIGNED_NOT_BROADCAST_MESSAGE;
    // Encoder codes are checked only once the error is known NOT to be a
    // broadcast failure: a BroadcastFailedError quotes the node/encoder reason
    // in its own message, and classifying that by text would relabel a signed
    // transaction's fate as a build failure.
    if (broadcastKind === null) {
        const encoderCopy = encoderErrorMessage(err, { coinTicker, requiredNative });
        if (encoderCopy) return safeBuildMessage(encoderCopy, generic);
        // Name a per-chain gate refusal ahead of the params-builder check below.
        const chainGateCopy = chainGateErrorMessage(err);
        if (chainGateCopy) return userFacingMessage(chainGateCopy, generic);
        // A params-builder refusal happens BEFORE the encoder is called at all,
        // so it can only be reached here - and it is checked after the encoder
        // for the same reason the encoder is checked after broadcast: the more
        // specific classifier goes first. See validationErrors.js (D-118).
        const validationCopy = validationErrorMessage(err);
        if (validationCopy) return safeBuildMessage(validationCopy, generic);
        // The explorer: the third service a submit talks to, and the last one
        // whose failures were reaching users as wire wording (URL included).
        // Checked last of the three because it is the broadest - every
        // fee-bearing action reads a quote from it - and a message that matched
        // an encoder or params refusal is the more specific answer.
        const explorerCopy = explorerErrorMessage(err);
        if (explorerCopy) return safeBuildMessage(explorerCopy, generic);
        const sdkCopy = knownSdkErrorMessage(err);
        if (sdkCopy) return sdkCopy;
    }
    const raw = (err && typeof err === 'object')
        ? String(/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    const fallbackText = String(fallback || '').trim();
    if (fallbackText && (!raw || !fallbackText.includes(raw))) {
        return userFacingMessage(fallbackText, generic);
    }
    const humanized = humanizeError(err, verb);
    if (humanized.cause !== 'unknown') return humanized.message;
    return generic;
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
    const unknownCode = unknownSdkErrorCode(err);
    if (unknownCode) return unknownCode;
    if (knownSdkErrorMessage(err)) return '';
    const details = String(humanizeError(err).details || '').trim();
    if (!details) return '';
    const fold = (text) => String(text || '').toLowerCase().replace(/[\s.!?]+$/, '');
    return fold(message).includes(fold(details)) ? '' : details;
}
