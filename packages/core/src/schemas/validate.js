// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lightweight hand-written validators. Each schema file composes these
// into a `validate(record) -> { ok, errors }` function. Deliberately not
// using a schema library; the runtime shape is stable, the check
// surface is small, and keeping this dep-free makes `core` portable to
// any shell target.

export const isString = (v) => typeof v === 'string';
export const isNonEmptyString = (v) => isString(v) && v.length > 0;
export const isBoolean = (v) => typeof v === 'boolean';
export const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
export const isInteger = (v) => Number.isInteger(v);
export const isNonNegativeInteger = (v) => Number.isInteger(v) && v >= 0;
export const isArray = (v) => Array.isArray(v);
export const isPlainObject = (v) =>
    v != null && typeof v === 'object' && !Array.isArray(v);
export const isNull = (v) => v === null;
export const isOneOf = (v, allowed) => allowed.includes(v);

export const isIsoTimestamp = (v) => {
    if (!isNonEmptyString(v)) return false;
    return Number.isFinite(Date.parse(v));
};

// Push an error for `field` if `predicate` is false. Returns predicate result
// so callers can short-circuit dependent checks.
export const check = (errors, field, predicate, msg) => {
    if (!predicate) errors.push(`${field}: ${msg}`);
    return predicate;
};

export const checkEach = (errors, field, arr, predicate, msg) => {
    if (!isArray(arr)) {
        errors.push(`${field}: must be an array`);
        return false;
    }
    let ok = true;
    arr.forEach((item, i) => {
        if (!predicate(item)) {
            errors.push(`${field}[${i}]: ${msg}`);
            ok = false;
        }
    });
    return ok;
};

// Build a { ok, errors } result, normalizing the ok-true case.
export const result = (errors) =>
    errors.length ? { ok: false, errors } : { ok: true, errors: [] };
