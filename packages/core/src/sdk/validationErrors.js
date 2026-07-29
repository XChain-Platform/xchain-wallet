// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// validationErrors (D-118): the wallet's translation of xchain-sdk PARAMS
// BUILDER refusals into sentences a person can act on.
//
// The SDK's builders validate before anything is composed or signed, which is
// exactly right - and they throw `SDKValidationError` with a message addressed
// to whoever is reading a stack trace, prefixed with the builder's own
// identity:
//
//     betting.placeBetParams: amount must be a positive stake
//     betting.createBetFeedParams: label is required
//
// Found live on regtest: a zero stake on a real market put
// **"betting.placeBetParams: amount must be a positive stake"** on screen, in
// the alert a user reads to find out what they did wrong. The refusal itself is
// correct and nothing was broadcast; the wording is the defect. This is the
// same family as  (the native-fee refusal reaching users as wire wording)
// and  (the encoder's ten codes doing the same), and it is deliberately
// solved the same way: one mapper, wired into `submitFailureMessage`, so a form
// that routes its catch through that helper gets every one of these.
//
// TWO DESIGN POINTS, both forced by how these errors travel and by how many
// there are.
//
//   1. `code` and `details.field` do NOT survive the messaging boundary
//      (MessageHost.serializeError carries only `{ name, message }`), so the
//      recognition works on `name` - which does survive - plus the message
//      text, exactly as encoderErrors and nativeFeePreflight already do.
//
//   2. There are HUNDREDS of these messages across the SDK, so enumerating
//      them would be a rolling debt and a false promise. The mapper therefore
//      has two tiers: named sentences for the refusals a user can actually
//      act on, and - for everything else - a generic repair that strips the
//      `namespace.builderName:` prefix and sentence-cases what is left. The
//      generic tier is the important one: it means a builder message added
//      tomorrow reads as "Amount must be a positive stake" rather than as a
//      function name, without anyone having to remember this file exists.

/** A builder-prefixed message: `namespace.builderName: the actual problem`. */
const BUILDER_PREFIX_RE = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*:\s*/;

/**
 * The refusals worth their own sentence, matched on the SDK's wording.
 *
 * Ordered most specific first. Kept small on purpose: a mapping earns its place
 * by saying something the stripped message does not (naming the field the user
 * has to change, or the rule they cannot see).
 */
const NAMED = [
    [/amount must be a positive stake/i,
        'Enter a stake greater than zero.'],
    [/amount is required/i,
        'Enter the amount you want to stake.'],
    [/label is required/i,
        'Give the market a question - this is what people see when they browse.'],
    [/tick is required/i,
        'Choose the token bets are placed in.'],
    [/deadline is required/i,
        'Choose when betting closes.'],
    [/deadline must be a positive integer Unix timestamp/i,
        'Choose a valid date and time for betting to close.'],
    [/duplicate outcome "([^"]*)"/i,
        'Two outcomes have the same name ("$1"). Each outcome must be different.'],
    [/outcome labels may not be empty/i,
        'Every outcome needs a name.'],
    [/outcome is out of range/i,
        'Choose one of the outcomes listed for this market.'],
];

/**
 * True when this is an SDK params-builder refusal, however it reached us.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isSdkValidationError(err) {
    if (!err || typeof err !== 'object') return false;
    const e = /** @type {any} */ (err);
    if (e.name === 'SDKValidationError') return true;
    // Belt and braces for an error re-wrapped on the way across: only a
    // builder-prefixed message counts, so an ordinary Error is never claimed.
    return BUILDER_PREFIX_RE.test(String(e.message || ''));
}

/**
 * The sentence for an SDK params-builder refusal, or null when this is not one.
 *
 * @param {unknown} err
 * @returns {string|null}
 */
export function validationErrorMessage(err) {
    if (!isSdkValidationError(err)) return null;
    const raw = String(/** @type {any} */ (err).message || '').trim();
    if (!raw) return null;

    const body = raw.replace(BUILDER_PREFIX_RE, '').trim();
    if (!body) return null;

    for (const [pattern, sentence] of NAMED) {
        const match = body.match(pattern);
        if (match) return sentence.replace('$1', match[1] ?? '');
    }

    // Generic tier: the developer's sentence with the developer's prefix
    // removed. Capitalised and given a full stop so it reads as UI copy rather
    // than as log output; a message that already ends in punctuation keeps it.
    const first = body.charAt(0).toUpperCase() + body.slice(1);
    return /[.!?]$/.test(first) ? first : `${first}.`;
}
