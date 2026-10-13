// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Last line of defence for an error message rendered straight into a form.
//
// Flows and background hosts throw precondition errors prefixed with their
// own function name ("importWif: walletId is required", "addresses.newest:
// unknown chain"), and library failures arrive as internals ("Non-base58
// character", "Cannot read properties of undefined"). All of them cross the
// shell messaging boundary as a bare string, so a form doing
// `setError(err.message)` shows the user a stack-trace fragment. That is
// D-52 / D-64, and it was fixed one screen at a time; this makes the check
// reusable so the next screen does not have to remember.
//
// Deliberately a FILTER, not a translator: copy that was written for a user
// passes through untouched, so a flow that already says the right thing
// keeps saying it. Only text that still looks like developer output is
// swapped for the caller's fallback. `humanizeError` is the sibling for the
// opposite job (classifying node / SDK failures into recovery causes); use
// this one when the flow layer already owns the wording.

// A leading `identifier:` or `some.namespaced.identifier:` segment. Anchored
// on a lowercase first letter and no internal whitespace, so real copy
// ("Note: keep a backup") is not mistaken for a function prefix.
export const DEV_PREFIX = /^[a-z][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*:\s/;

// Library / runtime internals that carry no meaning for the person reading
// them, whether or not they arrive with a function prefix.
const INTERNALS = /non-base58|cannot read propert|is not a function|is not defined|is not iterable|typeerror|referenceerror|\[object|assertion failed|unexpected token/i;
const WIRE_TEXT = /https?:\/\/|(?:\/[A-Za-z0-9_-]+)?\/api(?:\/|\b)|\n\s*at\s+\S+|request failed with status code\s+\d{3}|^(?:rpc|http)\s+(?:error|code)\b/i;
const SERIALIZED_DATA = /(?:^|:\s*)[{[]\s*["'][^\n]*[}\]]/;
const ENCODER_REFUSAL_PREFIX = /^Encoder RPC error:\s*/i;
const MAX_REFUSAL_REASON_LENGTH = 500;

function errorText(err) {
    const raw = (err && typeof err === 'object')
        ? (/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    return String(raw).trim();
}

/**
 * The node's explanation for an encoder RPC refusal, when it is safe to show.
 * The SDK identifies this in-process with name, code and message. Messaging
 * shells may preserve only name and message, so the prefix remains the final
 * discriminator when code is absent.
 *
 * @param {unknown} err
 * @returns {string|null}
 */
export function protocolRefusalReason(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    if (e.name !== 'SDKEncoderError'
        || (e.code !== undefined && e.code !== 'ENCODER_RPC_ERROR')) return null;
    const message = errorText(err);
    if (!ENCODER_REFUSAL_PREFIX.test(message)) return null;
    const reason = message.replace(ENCODER_REFUSAL_PREFIX, '').trim();
    if (!reason || INTERNALS.test(reason) || WIRE_TEXT.test(reason) || SERIALIZED_DATA.test(reason)) {
        return null;
    }
    return reason.slice(0, MAX_REFUSAL_REASON_LENGTH).trimEnd();
}

/**
 * @param {unknown} err       the caught error (Error, string, or anything)
 * @param {string} fallback   house-voice copy to show when the message is
 *                            developer output (or missing entirely)
 * @returns {string}
 */
export function userFacingMessage(err, fallback = 'Something went wrong. Try again.') {
    const refusal = protocolRefusalReason(err);
    if (refusal) return refusal;
    const text = errorText(err);
    if (isDeveloperMessage(err)) return fallback;
    return text;
}

/**
 * True when `err` would be filtered out. Exposed for tests and for callers
 * that want to log the raw text only in the cases we refuse to show.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDeveloperMessage(err) {
    if (protocolRefusalReason(err)) return false;
    const text = errorText(err);
    if (!text) return true;
    if (err && typeof err === 'object') {
        const e = /** @type {any} */ (err);
        if (/^SDK[A-Za-z]*Error$/.test(String(e.name || ''))) return true;
        if (typeof e.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.code)) return true;
    }
    return DEV_PREFIX.test(text) || INTERNALS.test(text)
        || WIRE_TEXT.test(text) || SERIALIZED_DATA.test(text);
}
