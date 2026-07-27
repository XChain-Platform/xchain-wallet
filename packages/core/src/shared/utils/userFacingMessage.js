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
const DEV_PREFIX = /^[a-z][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*:\s/;

// Library / runtime internals that carry no meaning for the person reading
// them, whether or not they arrive with a function prefix.
const INTERNALS = /non-base58|cannot read propert|is not a function|is not defined|is not iterable|typeerror|referenceerror|\[object|assertion failed|unexpected token/i;

/**
 * @param {unknown} err       the caught error (Error, string, or anything)
 * @param {string} fallback   house-voice copy to show when the message is
 *                            developer output (or missing entirely)
 * @returns {string}
 */
export function userFacingMessage(err, fallback) {
    const raw = (err && typeof err === 'object')
        ? (/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    const text = String(raw).trim();
    if (!text) return fallback;
    if (DEV_PREFIX.test(text)) return fallback;
    if (INTERNALS.test(text)) return fallback;
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
    const raw = (err && typeof err === 'object')
        ? (/** @type {any} */ (err).message || '')
        : (typeof err === 'string' ? err : '');
    const text = String(raw).trim();
    if (!text) return true;
    return DEV_PREFIX.test(text) || INTERNALS.test(text);
}
