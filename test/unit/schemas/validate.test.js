// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/validate: primitive validators and check/result helpers.

import { describe, it, expect } from 'vitest';
import {
    isString,
    isNonEmptyString,
    isBoolean,
    isNumber,
    isInteger,
    isNonNegativeInteger,
    isArray,
    isPlainObject,
    isNull,
    isOneOf,
    isIsoTimestamp,
    check,
    checkEach,
    result,
} from '../../../packages/core/src/schemas/validate.js';

describe('schemas/validate', () => {
    describe('isString', () => {
        it('returns true for empty string', () => expect(isString('')).toBe(true));
        it('returns true for non-empty string', () => expect(isString('hello')).toBe(true));
        it('returns false for number', () => expect(isString(42)).toBe(false));
        it('returns false for null', () => expect(isString(null)).toBe(false));
        it('returns false for undefined', () => expect(isString(undefined)).toBe(false));
        it('returns false for object', () => expect(isString({})).toBe(false));
        it('returns false for array', () => expect(isString([])).toBe(false));
    });

    describe('isNonEmptyString', () => {
        it('returns true for non-empty string', () => expect(isNonEmptyString('a')).toBe(true));
        it('returns false for empty string', () => expect(isNonEmptyString('')).toBe(false));
        it('returns false for number', () => expect(isNonEmptyString(1)).toBe(false));
        it('returns false for null', () => expect(isNonEmptyString(null)).toBe(false));
        it('returns false for undefined', () => expect(isNonEmptyString(undefined)).toBe(false));
    });

    describe('isBoolean', () => {
        it('returns true for true', () => expect(isBoolean(true)).toBe(true));
        it('returns true for false', () => expect(isBoolean(false)).toBe(true));
        it('returns false for 1', () => expect(isBoolean(1)).toBe(false));
        it('returns false for "true"', () => expect(isBoolean('true')).toBe(false));
        it('returns false for null', () => expect(isBoolean(null)).toBe(false));
    });

    describe('isNumber', () => {
        it('returns true for 0', () => expect(isNumber(0)).toBe(true));
        it('returns true for negative float', () => expect(isNumber(-1.5)).toBe(true));
        it('returns false for Infinity', () => expect(isNumber(Infinity)).toBe(false));
        it('returns false for NaN', () => expect(isNumber(NaN)).toBe(false));
        it('returns false for string', () => expect(isNumber('1')).toBe(false));
        it('returns false for null', () => expect(isNumber(null)).toBe(false));
    });

    describe('isInteger', () => {
        it('returns true for 0', () => expect(isInteger(0)).toBe(true));
        it('returns true for -5', () => expect(isInteger(-5)).toBe(true));
        it('returns false for 1.5', () => expect(isInteger(1.5)).toBe(false));
        it('returns false for string', () => expect(isInteger('1')).toBe(false));
        it('returns false for NaN', () => expect(isInteger(NaN)).toBe(false));
    });

    describe('isNonNegativeInteger', () => {
        it('returns true for 0', () => expect(isNonNegativeInteger(0)).toBe(true));
        it('returns true for 100', () => expect(isNonNegativeInteger(100)).toBe(true));
        it('returns false for -1', () => expect(isNonNegativeInteger(-1)).toBe(false));
        it('returns false for 1.5', () => expect(isNonNegativeInteger(1.5)).toBe(false));
        it('returns false for string', () => expect(isNonNegativeInteger('0')).toBe(false));
    });

    describe('isArray', () => {
        it('returns true for []', () => expect(isArray([])).toBe(true));
        it('returns true for [1,2]', () => expect(isArray([1, 2])).toBe(true));
        it('returns false for object', () => expect(isArray({})).toBe(false));
        it('returns false for null', () => expect(isArray(null)).toBe(false));
        it('returns false for string', () => expect(isArray('abc')).toBe(false));
    });

    describe('isPlainObject', () => {
        it('returns true for {}', () => expect(isPlainObject({})).toBe(true));
        it('returns true for { a: 1 }', () => expect(isPlainObject({ a: 1 })).toBe(true));
        it('returns false for null', () => expect(isPlainObject(null)).toBe(false));
        it('returns false for array', () => expect(isPlainObject([])).toBe(false));
        it('returns false for string', () => expect(isPlainObject('x')).toBe(false));
        it('returns false for number', () => expect(isPlainObject(42)).toBe(false));
    });

    describe('isNull', () => {
        it('returns true for null', () => expect(isNull(null)).toBe(true));
        it('returns false for undefined', () => expect(isNull(undefined)).toBe(false));
        it('returns false for 0', () => expect(isNull(0)).toBe(false));
        it('returns false for empty string', () => expect(isNull('')).toBe(false));
    });

    describe('isOneOf', () => {
        it('returns true when value is in array', () => expect(isOneOf('a', ['a', 'b'])).toBe(true));
        it('returns false when value is not in array', () => expect(isOneOf('c', ['a', 'b'])).toBe(false));
        it('returns false for empty array', () => expect(isOneOf('a', [])).toBe(false));
        it('is case-sensitive', () => expect(isOneOf('A', ['a'])).toBe(false));
    });

    describe('isIsoTimestamp', () => {
        it('returns true for a valid ISO string', () => {
            expect(isIsoTimestamp(new Date().toISOString())).toBe(true);
        });
        it('returns true for "2025-01-01T00:00:00.000Z"', () => {
            expect(isIsoTimestamp('2025-01-01T00:00:00.000Z')).toBe(true);
        });
        it('returns false for empty string', () => expect(isIsoTimestamp('')).toBe(false));
        it('returns false for a non-date string', () => expect(isIsoTimestamp('not-a-date')).toBe(false));
        it('returns false for null', () => expect(isIsoTimestamp(null)).toBe(false));
        it('returns false for undefined', () => expect(isIsoTimestamp(undefined)).toBe(false));
        it('returns false for a number', () => expect(isIsoTimestamp(12345)).toBe(false));
    });

    describe('check', () => {
        it('does not push error when predicate is true', () => {
            const errors = [];
            const r = check(errors, 'field', true, 'bad');
            expect(r).toBe(true);
            expect(errors).toHaveLength(0);
        });

        it('pushes error when predicate is false', () => {
            const errors = [];
            const r = check(errors, 'field', false, 'bad message');
            expect(r).toBe(false);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('field: bad message');
        });

        it('returns the predicate value as-is', () => {
            const errors = [];
            expect(check(errors, 'f', 1, 'x')).toBe(1);
            expect(check(errors, 'f', '', 'x')).toBe('');
        });
    });

    describe('checkEach', () => {
        const isPos = (v) => typeof v === 'number' && v > 0;

        it('returns true for a valid array where all pass', () => {
            const errors = [];
            const r = checkEach(errors, 'items', [1, 2, 3], isPos, 'must be positive');
            expect(r).toBe(true);
            expect(errors).toHaveLength(0);
        });

        it('returns true for an empty array', () => {
            const errors = [];
            const r = checkEach(errors, 'items', [], isPos, 'must be positive');
            expect(r).toBe(true);
            expect(errors).toHaveLength(0);
        });

        it('returns false and pushes indexed error on failure', () => {
            const errors = [];
            const r = checkEach(errors, 'items', [1, -1, 2], isPos, 'must be positive');
            expect(r).toBe(false);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('items[1]: must be positive');
        });

        it('collects multiple errors for multiple bad items', () => {
            const errors = [];
            checkEach(errors, 'xs', [0, -1, 2], isPos, 'positive please');
            expect(errors).toHaveLength(2);
            expect(errors[0]).toContain('xs[0]');
            expect(errors[1]).toContain('xs[1]');
        });

        it('pushes an error and returns false when not an array', () => {
            const errors = [];
            const r = checkEach(errors, 'items', 'not-array', isPos, 'msg');
            expect(r).toBe(false);
            expect(errors[0]).toContain('must be an array');
        });

        it('pushes an error and returns false when null', () => {
            const errors = [];
            const r = checkEach(errors, 'items', null, isPos, 'msg');
            expect(r).toBe(false);
            expect(errors[0]).toContain('must be an array');
        });
    });

    describe('result', () => {
        it('returns ok:true with empty errors when no errors', () => {
            const r = result([]);
            expect(r.ok).toBe(true);
            expect(r.errors).toHaveLength(0);
        });

        it('returns ok:false with errors when errors present', () => {
            const r = result(['something wrong']);
            expect(r.ok).toBe(false);
            expect(r.errors).toEqual(['something wrong']);
        });

        it('ok:true always returns a fresh empty array', () => {
            const r = result([]);
            expect(r.errors).toEqual([]);
        });
    });
});
