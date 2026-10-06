// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Classifying why decodeActionFromPsbt said no.
//
// Its `ok: false` covers two categorically different situations, and treating
// them alike is a false-block waiting to happen:
//
//   absent    - NO_OP_RETURN / NO_MAGIC_WORD. There is no XChain action in
//               this transaction. It is an ordinary payment, nothing is
//               hidden, and the output enumeration already shows everything
//               it does. Refusing here would block the single most common
//               thing a PSBT signing surface is asked to do.
//   unreadable - every other reason (P2SH_P2WSH_UNSUPPORTED, MULTI_OP_RETURN,
//               DEOBFUSCATION_FAILED, OVERSIZED, NOT_UTF8, UNKNOWN_ACTION,
//               REST_FIELD_UNSUPPORTED, MULTI_LEG_UNSUPPORTED, ...). An action
//               IS present and the wallet cannot display it. This is the case
//               §5.5's fail-closed refusal exists for.
//
// Its own module so both the panel and the refusal predicate can read it
// without importing each other.

const NO_ACTION_DECODE_REASONS = Object.freeze(['NO_OP_RETURN', 'NO_MAGIC_WORD']);

/**
 * True when the reason says an XChain action is PRESENT but unreadable, as
 * opposed to absent.
 *
 * A missing reason is not a positive signal either way, so it reads as
 * "nothing claimed" and returns false: refusing on the ABSENCE of information
 * would block ordinary payments on any host that reports no reason at all.
 *
 * @param {string|null|undefined} reason
 * @returns {boolean}
 */
export function isUnreadableActionReason(reason) {
    if (!reason) return false;
    return !NO_ACTION_DECODE_REASONS.includes(reason);
}

// Plain-language clauses for the decoder's reason codes, grouped by what the
// signer can do about them. Display only: the refusal above keeps reading the
// raw code, and a code missing here falls back to a sentence with no reason.
const UNSUPPORTED_FORM = 'the action is written in a form this wallet cannot read yet';
const UNKNOWN_TYPE = 'the action is a type or version this wallet does not recognize';
const MALFORMED = 'the action data is malformed';
const UNREADABLE_REASON_TEXT = Object.freeze({
    P2SH_P2WSH_UNSUPPORTED: UNSUPPORTED_FORM,
    MULTI_LEG_UNSUPPORTED: UNSUPPORTED_FORM,
    REST_FIELD_UNSUPPORTED: UNSUPPORTED_FORM,
    BATCH_UNSUPPORTED: UNSUPPORTED_FORM,
    MULTI_OP_RETURN: UNSUPPORTED_FORM,
    MULTI_ENVELOPE: UNSUPPORTED_FORM,
    ENVELOPE_NOT_INPUT_ZERO: UNSUPPORTED_FORM,
    ENVELOPE_MIXED_CARRIER: UNSUPPORTED_FORM,
    UNKNOWN_ACTION: UNKNOWN_TYPE,
    BAD_VERSION: UNKNOWN_TYPE,
    DEOBFUSCATION_FAILED: MALFORMED,
    NOT_UTF8: MALFORMED,
    OVERSIZED: MALFORMED,
    FIELD_COUNT_MISMATCH: MALFORMED,
    INNER_DECOMPILE_FAILED: MALFORMED,
    ENVELOPE_SCRIPT_INVALID: MALFORMED,
    UNEXPECTED_FORMAT: MALFORMED,
    MALFORMED_ACTION_STRING: MALFORMED,
    REST_FIELD_TOO_LONG: MALFORMED,
    PARAM_INVALID: MALFORMED,
});

/**
 * Why an unreadable action could not be read, as a short clause for the
 * signing alert, or null when the reason has no plain description (a host
 * fallback code, an exception message, nothing at all).
 *
 * Never echoes its input: the raw reason can be arbitrary exception text, so
 * it belongs in the technical details, not in the sentence a signer reads.
 *
 * @param {string|null|undefined} reason
 * @returns {string|null}
 */
export function describeUnreadableReason(reason) {
    if (typeof reason !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(UNREADABLE_REASON_TEXT, reason)
        ? UNREADABLE_REASON_TEXT[reason]
        : null;
}
