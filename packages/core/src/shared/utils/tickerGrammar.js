// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one place the wallet decides what a NEW ticker may be called.
//
// THE DEFECT THIS CLOSES. Both authoring surfaces (TokenWizard and
// IssueTokenForm) each carried their own `/^[A-Za-z0-9]+$/` and each uppercased
// every keystroke, so three shapes the chain admits could not be typed at all:
// symbol-bearing ticks were refused with a message, and lowercase ones were
// silently rewritten under the user's cursor. The narrowing was the wallet's
// alone. `xchain-indexer/src/config.js` allows
//
//   abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789
//   ~!@#$%^&*()_+-={}[]:<>.?
//
// at MIN_TICK_LENGTH 1 to MAX_TICK_LENGTH 250, `xchain-indexer/src/actions/
// issue.js` enforces exactly that as an allowlist loop, and
// `xchain-sdk/src/validator.js` (TICK_REGEX) mirrors it byte for byte. Measured
// at a regtest venue's own /feequote on 2026-08-27, `JDOG$`, `WOW!`, `A~B` and
// a lowercase tick all answer `status: valid`; a genuine refusal always names
// its reason (`invalid: TICK (length)`).
//
// WHY THE CARET IS STILL CLOSED, and it is the one deliberate difference from
// the chain's allowlist. `^` is a member of TICK_CHARACTERS and a caret tick
// quotes clean, but `db.js createTicker` never inserts a literal `^…` row, so a
// caret ISSUE can land `status: valid` with a NULL ticker id, and the dotted
// caret form is separately refused only above the BATCH_ISSUANCE_LIMITS v2
// flag (issue.js). Opening a shape whose own admission path is unsettled would
// be handing users a way to burn a fee on a token that half-exists, so the
// operator's 2026-08-29 ruling was to widen to the SYMBOL class now and settle
// caret against the admission path separately. That is the whole of the gap
// between ALLOWED_TICKER_CHARACTERS below and the chain's own list.
//
// THE DOT IS A SEPARATOR, NOT A CHARACTER, and that is why it is gated behind
// `allowDot` rather than simply added to the class. `issue.js` splits a TICK on
// `.` and reads everything but the last part as the parent, so `A.B` is not a
// name with a dot in it, it is a CHILD OF `A` - and an ISSUE naming a parent
// the signer does not own is refused as `invalid: TICK (parent unknown)` or
// `(parent issued by another address)` only AFTER the miner fee is spent.
//
// So a field that COINS a name refuses the dot and says where subtokens are
// made; a field that REFERENCES an existing one (the wizard's Parent ticker)
// takes it, along with the chain's own structural rules: no leading or trailing
// dot (`invalid: TICK (period)`) and no empty level, which would resolve to a
// parent that cannot exist. Widening this module must never turn a local
// refusal into a paid-for one.
//
// Case is NOT coerced anywhere. The chain records the tick as written.

/**
 * Every character a new ticker may carry.
 *
 * This is the indexer's TICK_CHARACTERS with `^` removed, and nothing else.
 * If the caret admission path is settled, add `^` here and both surfaces widen
 * together.
 */
export const ALLOWED_TICKER_CHARACTERS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~!@#$%&*()_+-={}[]:<>.?';

/** Mirrors xchain-indexer config MIN_TICK_LENGTH. */
export const MIN_TICKER_LENGTH = 1;

/** Mirrors xchain-indexer config MAX_TICK_LENGTH. */
export const MAX_TICKER_LENGTH = 250;

/**
 * One dot-separated level of a ticker: the allowlist above, minus the dot,
 * which this grammar treats as the separator it is.
 */
const SEGMENT_RE = /^[A-Za-z0-9~!@#$%&*()_+\-={}[\]:<>?]+$/;

/** The hint both authoring surfaces show under their ticker field. */
export const TICKER_HINT =
    'Letters, numbers or symbols, up to 250 characters. Case is kept exactly as typed.';

/**
 * The reason `value` cannot be a new ticker, or null when it can.
 *
 * Returns copy, not a code, because every caller does the same thing with it:
 * drop it into the form's error banner. `noun` names the field in that copy so
 * the wizard can say "Token name" where the direct form says "Ticker" (the e2e
 * coverage tells the two surfaces apart by exactly that word). `allowDot` says
 * whether this field addresses an existing ticker (parent references) or coins
 * a new one; see the header for why coining fields refuse it.
 *
 * @param {unknown} value raw field contents; trimmed here, once
 * @param {{ noun?: string, allowDot?: boolean }} [options]
 * @returns {string|null}
 */
export function tickerGrammarError(value, { noun = 'Ticker', allowDot = false } = {}) {
    const tick = String(value ?? '').trim();

    if (!tick) return `${noun} is required.`;

    if (tick.length > MAX_TICKER_LENGTH)
        return `${noun} cannot be longer than ${MAX_TICKER_LENGTH} characters.`;

    // Named before the general character rule, because "^ is not allowed" is a
    // rule with a reason and "that character is not allowed" is a shrug. A user
    // reaching for `^123` is reaching for the tick-ID form on purpose.
    if (tick.includes('^'))
        return `${noun} cannot contain ^. That form is reserved for token IDs.`;

    // A dot in a name being COINED is a subtoken nobody asked for, and the
    // chain charges for finding that out. See the header.
    if (!allowDot && tick.includes('.'))
        return `${noun} cannot contain a dot. A dotted name is a subtoken: `
            + "create one with the wizard's Subtoken template.";

    // Structural dot rules next: `A..B` and `.A` both pass a per-character
    // check and are refused by the chain, so catching them here saves the fee.
    if (tick.startsWith('.') || tick.endsWith('.'))
        return `${noun} cannot start or end with a dot.`;

    const segments = tick.split('.');
    if (segments.some((segment) => segment === ''))
        return `${noun} cannot have an empty level between dots.`;

    if (segments.some((segment) => !SEGMENT_RE.test(segment)))
        return `${noun} can only use letters, numbers and ~!@#$%&*()_+-={}[]:<>?`;

    return null;
}

/**
 * True when `value` is a name this wallet will let a user coin.
 *
 * @param {unknown} value
 * @param {{ noun?: string, allowDot?: boolean }} [options]
 * @returns {boolean}
 */
export function isAuthorableTicker(value, options) {
    return tickerGrammarError(value, options) === null;
}
