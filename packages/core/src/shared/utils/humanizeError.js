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

/**
 * @typedef {'insufficient_funds' | 'network' | 'rejected' | 'backend_behind' | 'unknown'} HumanizedErrorCause
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

    // D-125: an SDK explorer failure is classified by its own code before the
    // keyword chain below ever sees it. Two of its four shapes fall through
    // that chain to `unknown`, which appends the raw message - that is how
    // "Explorer returned HTTP 502 for /RBTC/api/feequote?action=..." reached a
    // user - and a third ("Explorer request timed out") matched `network` and
    // blamed the user's own connection for a service-side timeout.
    const explorerRead = explorerReadFailure(err, verb);
    if (explorerRead) return { message: explorerRead.message, cause: explorerRead.cause, raw };

    /** @type {HumanizedErrorCause} */
    let cause = 'unknown';
    let message = `Couldn't ${verb}.`;

    if (/insufficient|not enough|balance too low|inadequate funds|too low/.test(hay)) {
        cause = 'insufficient_funds';
        message = `Couldn't ${verb}. You don't have enough funds for this transaction.`;
    } else if (/network|timeout|timed out|econnrefused|econnreset|enotfound|etimedout|fetch failed|unreachable|offline|dns|no response/.test(hay)) {
        cause = 'network';
        message = `Couldn't ${verb}. The network is unreachable. Check your connection and try again.`;
    } else if (/lagging|is behind|refusing to fetch|halted|resync|catching up|not synced|out of sync/.test(hay)) {
        // A backend index (utxo-tracker / decoder / indexer) that is behind or
        // halted cannot answer, but nothing is wrong with the user's funds or
        // their input, and retrying later genuinely works. Tested before
        // 'rejected' because these messages often also say "refusing".
        cause = 'backend_behind';
        message = `Couldn't ${verb}. The service is still catching up with the chain. Try again in a few minutes.`;
    } else if (/reject|refused|mempool|min relay|minrelay|dust|non-final|nonfinal|bad-txns|txn-|would exceed|already known|conflict/.test(hay)) {
        cause = 'rejected';
        message = `Couldn't ${verb}. The network rejected this transaction.`;
    }

    // An unrecognized error must still say SOMETHING about what happened. Every
    // caller renders `message` alone, so dropping `raw` here left dead-end
    // copy - "Couldn't mint." on screen while the console held "utxo-tracker is
    // lagging by 97 blocks" (D-42). Appending it keeps the house-voice opener
    // and hands the user (or whoever they paste it to) the actual cause.
    if (cause === 'unknown' && raw) message = `${message} ${raw}`;

    return { message, cause, raw };
}
