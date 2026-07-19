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

/**
 * @typedef {'insufficient_funds' | 'network' | 'rejected' | 'unknown'} HumanizedErrorCause
 */

/**
 * @typedef {object} HumanizedError
 * @property {string} message  plain-language, house-voice copy for display
 * @property {HumanizedErrorCause} cause  recognized cause key (for recovery logic)
 * @property {string} raw  the original error message, preserved for logs / detail
 */

/**
 * Map a thrown error into plain-language copy plus a recognized cause.
 *
 * @param {unknown} err  the caught error (Error, string, or anything)
 * @param {string} [verb='complete this']  short action verb, e.g. 'send'
 * @returns {HumanizedError}
 */
export function humanizeError(err, verb = 'complete this') {
    const raw = (err && typeof err === 'object')
        ? (/** @type {any} */ (err).message || String(err))
        : (err ? String(err) : '');
    const name = (err && typeof err === 'object') ? (/** @type {any} */ (err).name || '') : '';
    const hay = `${name} ${raw}`.toLowerCase();

    /** @type {HumanizedErrorCause} */
    let cause = 'unknown';
    let message = `Couldn't ${verb}.`;

    if (/insufficient|not enough|balance too low|inadequate funds|too low/.test(hay)) {
        cause = 'insufficient_funds';
        message = `Couldn't ${verb}. You don't have enough funds for this transaction.`;
    } else if (/network|timeout|timed out|econnrefused|econnreset|enotfound|etimedout|fetch failed|unreachable|offline|dns|no response/.test(hay)) {
        cause = 'network';
        message = `Couldn't ${verb}. The network is unreachable. Check your connection and try again.`;
    } else if (/reject|refused|mempool|min relay|minrelay|dust|non-final|nonfinal|bad-txns|txn-|would exceed|already known|conflict/.test(hay)) {
        cause = 'rejected';
        message = `Couldn't ${verb}. The network rejected this transaction.`;
    }

    return { message, cause, raw };
}
