// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-language wrapper for backend / SDK / node-RPC error strings.
//
// Flows throw function-prefixed precondition errors ("sendToken:
// params.TICK is required"), the SDK returns compose/validate codes,
// and node RPC broadcast rejections arrive as free text. Rendering any
// of those verbatim in a money-moving UI is jargon in front of a
// non-technical user. `humanizeError` classifies the error into a small
// set of recognized causes and returns house-voice copy, while keeping
// the raw message available so it can be logged or shown as a secondary,
// collapsible detail (never lost).
//
// Returns a structured result so callers can key recovery affordances
// off `cause` instead of re-parsing display prose.

import { explorerReadFailure } from '../../sdk/explorerErrors.js';

const NETWORK_ERRNO = /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|ECONNABORTED)\b/i;
const CONNECTION_FAILURE = /network request failed|request timed out|timeout of \d+ms exceeded|you are offline|fetch failed|failed to fetch|would be rejected by the network/i;
const BACKEND_SERVICE = /\b(?:utxo(?:-|\s+)tracker|decoder|indexer)\b/i;
const BACKEND_DELAY = /\b(?:lagging|is behind|refusing to fetch|halted|resync|catching up|not synced|out of sync)\b/i;

/**
 * @typedef {'insufficient_funds' | 'inputs_on_hold' | 'network' | 'rejected' | 'backend_behind' | 'rate_limited' | 'unknown'} HumanizedErrorCause
 */

/**
 * @typedef {object} HumanizedError
 * @property {string} message  plain-language, house-voice copy for display
 * @property {HumanizedErrorCause} cause  recognized cause key (for recovery logic)
 * @property {string} raw  the original error message, preserved for logs / detail
 * @property {string} details  technical text for an explicit, collapsed disclosure
 * @property {number|null} [retryAfterSeconds]  only on `rate_limited`: the wait the origin
 *                                              asked for, in whole seconds, or null when it
 *                                              named none. Home counts it down and re-loads
 */

function errorIdentity(err) {
    const raw = (err && typeof err === 'object')
        ? (/** @type {any} */ (err).message || String(err))
        : (err ? String(err) : '');
    const name = (err && typeof err === 'object') ? (/** @type {any} */ (err).name || '') : '';
    return { raw, hay: `${name} ${raw}`.toLowerCase() };
}

// Classify SDK explorer failures before applying general message keywords.
// HTTP failures can contain request paths that do not belong in display copy,
// and service timeouts describe the explorer rather than the user's connection.

// The request path and stack frames are stripped from explorer details; the
// remaining technical text is kept as is.
function sanitizeExplorerDetail(raw) {
    return String(raw)
        .replace(/\n\s+at [^\n]*/g, '')
        .replace(/\s*\/[A-Za-z0-9_-]+\/api\/[^\s]*/g, '')
        .trim();
}

// Preserve the typed mapper's recovery cause before the general network
// classifier can claim the message and give the user the wrong next step.
// Keep the original text available only for a collapsed details control.
function explorerResult(err, verb, raw) {
    const explorerRead = explorerReadFailure(err, verb);
    if (!explorerRead) return null;
    const out = { message: explorerRead.message, cause: explorerRead.cause, raw, details: sanitizeExplorerDetail(raw) };
    // Only the rate-limit branch carries a number, and a caller that wants
    // to count it down (Home) must not have to re-parse the sentence it was
    // just handed. Absent on every other branch, so nothing else grows a
    // field it would have to ignore.
    if (explorerRead.retryAfterSeconds !== undefined) {
        out.retryAfterSeconds = explorerRead.retryAfterSeconds;
    }
    return out;
}

// Trust only explicitly marked wallet copy, including any string recovery key.
// This keeps authored network guidance out of wire-error classification and
// avoids duplicating already user-ready text in technical details.
function userFacingResult(err, verb, raw) {
    if (!err || typeof err !== 'object' || /** @type {any} */ (err).userFacing !== true || !raw) return null;
    const named = /** @type {any} */ (err).cause;
    return {
        message: `Couldn't ${verb}. ${raw}`,
        cause: typeof named === 'string' ? /** @type {any} */ (named) : 'unknown',
        raw,
        details: '',
    };
}

function classifiedResult(raw, hay, verb) {
    /** @type {HumanizedErrorCause} */
    let cause = 'unknown';
    let message = '';
    let details = '';

    if (/reserved by a transaction built/.test(hay)) {
        // The encoder holds every input a successful build selected for five
        // minutes, and the wallet builds when the confirm modal opens, so a
        // cancelled or otherwise un-broadcast confirm parks that coin. An address
        // with few spendable outputs then runs out of candidates and the encoder
        // reports the shortfall with the reserved inputs named. Read BEFORE the
        // generic insufficient-funds branch: this message also says "insufficient
        // funds", and "you don't have enough" plus a Use Max affordance sent a
        // user holding 2,000 TDOGE in circles. Waiting fixes it; funding
        // the address does not.
        cause = 'inputs_on_hold';
        message = `Couldn't ${verb}. Coins at this address are still on hold for a transaction `
            + 'prepared in the last 5 minutes. Broadcast that transaction, or wait 5 minutes and try again.';
    } else if (/\binsufficient funds\b|\binsufficient balance\b|\b(?:not|no) (?:have )?enough (?:funds|balance|coins?|xcp)\b|\bbalance (?:is )?too low\b|\binadequate funds\b/.test(hay)) {
        cause = 'insufficient_funds';
        message = `Couldn't ${verb}. You don't have enough funds for this transaction.`;
        if (/\d/.test(raw)) details = raw;
    } else if (NETWORK_ERRNO.test(hay) || CONNECTION_FAILURE.test(hay)) {
        cause = 'network';
        message = `Couldn't ${verb}. The network is unreachable. Check your connection and try again.`;
    } else if (BACKEND_SERVICE.test(hay) && BACKEND_DELAY.test(hay)) {
        // A backend index (utxo-tracker / decoder / indexer) that is behind or
        // halted cannot answer, but nothing is wrong with the user's funds or
        // their input, and retrying later genuinely works. Tested before
        // 'rejected' because these messages often also say "refusing".
        cause = 'backend_behind';
        message = `Couldn't ${verb}. The service is still catching up with the chain. Try again in a few minutes.`;
    } else if (/\bdust\b/.test(hay)) {
        // A dust rejection is the one member of the `rejected` family the user can
        // fix, and "the network rejected this transaction" told them nothing, so the same
        // amount was the obvious thing to retry. The cause key stays `rejected` because
        // that is still what happened; only the sentence changes. The wallet now refuses a
        // below-dust send before composing, so reaching this means some OTHER output came
        // out under the floor (a scaled protocol fee, a change remainder), which is why
        // this names the shape of the problem rather than a specific field.
        cause = 'rejected';
        message = `Couldn't ${verb}. One of the amounts in this transaction is below the `
            + 'smallest payment the network will carry, so it was refused before it went out. '
            + 'Nothing was spent. Raise the amount and try again.';
    } else if (/\b(?:bad-txns[\w-]*|txn-[\w-]*|non-final|nonfinal|minrelay|already known)\b|\(code\s*-?\d+\)/.test(hay)) {
        cause = 'rejected';
        message = `Couldn't ${verb}. The network rejected this transaction.`;
    }

    return { cause, message, details };
}

function isRawTechnicalText(raw) {
    const text = raw.trim();
    return /^(?:(?:future )?internal|unknown|unexplained) (?:error|failure|refusal)$/i.test(text)
        || /\bERR_[A-Z_]+\b/.test(text)
        || NETWORK_ERRNO.test(text)
        || /request failed with status code\s+\d{3}/i.test(text)
        || /^(?:rpc|http)\s+(?:error|code)\s*:?\s*-?\d+\s*$/i.test(text)
        || /\n\s*at\s+\S+/.test(text)
        || /^(?:type|range|reference|syntax)?error:\s*$/i.test(text)
        || (/^[{[]/.test(text) && /[}\]]$/.test(text));
}

/**
 * Map a thrown error into plain-language copy plus a recognized cause.
 *
 * @param {unknown} err  the caught error (Error, string, or anything)
 * @param {string} [verb='complete this']  short action verb, e.g. 'send'
 * @returns {HumanizedError}
 */
export function humanizeError(err, verb = 'complete this') {
    const { raw, hay } = errorIdentity(err);
    const explorer = explorerResult(err, verb, raw);
    if (explorer) return explorer;
    const userFacing = userFacingResult(err, verb, raw);
    if (userFacing) return userFacing;
    const { cause, message, details } = classifiedResult(raw, hay, verb);
    if (cause !== 'unknown') return { message, cause, raw, details };
    if (isRawTechnicalText(raw)) {
        return {
            message: `Couldn't ${verb}. Something went wrong. Try again.`,
            cause,
            raw,
            details: raw,
        };
    }
    return {
        message: raw ? `Couldn't ${verb}. ${raw}` : `Couldn't ${verb}.`,
        cause,
        raw,
        details: '',
    };
}
