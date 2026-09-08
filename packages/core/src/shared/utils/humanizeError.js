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
 * @typedef {'insufficient_funds' | 'inputs_on_hold' | 'network' | 'rejected' | 'backend_behind' | 'rate_limited' | 'unknown'} HumanizedErrorCause
 */

/**
 * @typedef {object} HumanizedError
 * @property {string} message  plain-language, house-voice copy for display
 * @property {HumanizedErrorCause} cause  recognized cause key (for recovery logic)
 * @property {string} raw  the original error message, preserved for logs / detail
 * @property {number|null} [retryAfterSeconds]  only on `rate_limited`: the wait the origin
 *                                              asked for, in whole seconds, or null when it
 *                                              named none. Home counts it down and re-loads
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
    if (explorerRead) {
        const out = { message: explorerRead.message, cause: explorerRead.cause, raw };
        // Only the rate-limit branch carries a number, and a caller that wants
        // to count it down (Home) must not have to re-parse the sentence it was
        // just handed. Absent on every other branch, so nothing else grows a
        // field it would have to ignore.
        if (explorerRead.retryAfterSeconds !== undefined) {
            out.retryAfterSeconds = explorerRead.retryAfterSeconds;
        }
        return out;
    }

    // D-160: the keyword chain below reads the message as EVIDENCE, which is
    // right for a wire error and wrong for one the wallet wrote for this exact
    // user. `GatedSendKeysMissingError` explains that a send without the unlock
    // key "would be rejected by the network" - so it matched `network` and came
    // out as "The network is unreachable. Check your connection and try again.",
    // a connectivity verdict inviting a retry that cannot work, on the one
    // screen (Send) that calls this helper directly with no `submitFailureMessage`
    // in front of it. Its sibling `GatedRecipientPubkeyMissingError` survives
    // whole only because its wording happens to dodge the keywords, which is not
    // a property any author can rely on.
    //
    // So an error can now say "my message is already user-ready" and be passed
    // through verbatim. Opt-IN by the thrower, deliberately: silently exempting
    // every typed error would swallow the wire errors this helper exists to
    // translate. `cause` stays 'unknown' unless the error names one, which is
    // what an unrecognized-but-explained failure already resolves to (the only
    // affordance keyed off a cause is the insufficient-funds one).
    // The house-voice opener stays: this is a CLASSIFICATION bypass, not a
    // formatting one, so a marked error renders exactly as an unrecognized one
    // already does ("Couldn't send. <the explanation>") and nothing that reads
    // fine today changes shape.
    if (err && typeof err === 'object' && /** @type {any} */ (err).userFacing === true && raw) {
        const named = /** @type {any} */ (err).cause;
        return {
            message: `Couldn't ${verb}. ${raw}`,
            cause: typeof named === 'string' ? /** @type {any} */ (named) : 'unknown',
            raw,
        };
    }

    /** @type {HumanizedErrorCause} */
    let cause = 'unknown';
    let message = `Couldn't ${verb}.`;

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
    } else if (/insufficient|not enough|balance too low|inadequate funds|too low/.test(hay)) {
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
    } else if (/reject|refused|mempool|min relay|minrelay|non-final|nonfinal|bad-txns|txn-|would exceed|already known|conflict/.test(hay)) {
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
