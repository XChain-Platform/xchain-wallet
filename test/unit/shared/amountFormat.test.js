// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: shared/utils/amountFormat. Thousands-grouping for the amount
// input plus the caret-mapping helpers that keep the cursor stable when
// commas are inserted or removed on reformat.

import { describe, it, expect } from 'vitest';
import {
    formatWithThousands,
    normalizeLocalizedDecimal,
    countNonCommaBefore,
    decimalFromBaseUnits,
    formatDisplayAmount,
    formatHistoryAmount,
    indexAfterNonCommaCount,
    roundDecimalString,
    trimAmountTail,
    tokenAmountPrecisionError,
} from '../../../packages/core/src/shared/utils/amountFormat.js';

describe('shared/amountFormat display policy', () => {
    it.each([
        ['whole number', '1234', '1,234'],
        ['insignificant decimal zeros', '1234.50000000', '1,234.5'],
        ['zero decimal tail', '0.00000000', '0'],
        ['smallest displayed unit', '0.00000001', '0.00000001'],
        ['positive dust', '0.000000001', '< 0.00000001'],
        ['negative dust', '-0.000000001', '> -0.00000001'],
        ['precision beyond a float', '0.000000010000000001', '0.000000010000000001'],
        ['large exact decimal', '9007199254740993.0100', '9,007,199,254,740,993.01'],
    ])('formats %s consistently', (_label, value, expected) => {
        expect(formatDisplayAmount(value, 'en-US')).toBe(expected);
    });

    it.each([
        ['incoming', '1.25000000', 'in', '+1.25'],
        ['outgoing', '1.25000000', 'out', '-1.25'],
        ['unknown direction', '1.25000000', null, '1.25'],
        ['already negative', '-1.25000000', 'in', '-1.25'],
        ['zero', '0.00000000', 'out', '0'],
    ])('applies the %s History sign once', (_label, value, direction, expected) => {
        expect(formatHistoryAmount(value, direction, 'en-US')).toBe(expected);
    });
});

// (a): the indexer sums in DECIMAL(65,18), so an aggregate reaches the
// wallet with an 18-place tail whatever the token's own decimals are.
describe('shared/amountFormat trimAmountTail', () => {
    it('strips the zero tail a DECIMAL sum leaves behind', () => {
        expect(trimAmountTail('300.000000000000000000')).toBe('300');
        expect(trimAmountTail('0.175000000000000000')).toBe('0.175');
        expect(trimAmountTail('1000000.00000000')).toBe('1000000');
    });

    it('never touches a significant digit', () => {
        expect(trimAmountTail('0.00000001')).toBe('0.00000001');
        expect(trimAmountTail('12.305')).toBe('12.305');
        expect(trimAmountTail('-4.500')).toBe('-4.5');
        expect(trimAmountTail('300')).toBe('300');
    });

    it('returns anything that is not a plain decimal unchanged', () => {
        expect(trimAmountTail('1e-8')).toBe('1e-8');
        expect(trimAmountTail('n/a')).toBe('n/a');
        expect(trimAmountTail('')).toBe('');
        expect(trimAmountTail(null)).toBe('');
        expect(trimAmountTail(undefined)).toBe('');
        expect(trimAmountTail(0)).toBe('0');
    });
});

describe('shared/amountFormat formatWithThousands', () => {
    it('groups the integer part and preserves the fraction verbatim', () => {
        expect(formatWithThousands('12345.678')).toBe('12,345.678');
        expect(formatWithThousands('1000')).toBe('1,000');
        expect(formatWithThousands('999')).toBe('999');
        expect(formatWithThousands('1234567')).toBe('1,234,567');
    });

    it('keeps a trailing dot and preserves fractional precision (live typing)', () => {
        expect(formatWithThousands('1234.')).toBe('1,234.');
        expect(formatWithThousands('1000.00000000')).toBe('1,000.00000000');
    });

    it('handles a leading negative sign', () => {
        expect(formatWithThousands('-12345.6')).toBe('-12,345.6');
    });

    it('returns empty for null/undefined/empty input', () => {
        expect(formatWithThousands(null)).toBe('');
        expect(formatWithThousands(undefined)).toBe('');
        expect(formatWithThousands('')).toBe('');
    });

    it('passes non-numeric integer parts through untouched', () => {
        expect(formatWithThousands('abc')).toBe('abc');
        expect(formatWithThousands('1.2.3')).toBe('1.2.3');
    });

    it('accepts a numeric argument by stringifying it', () => {
        expect(formatWithThousands(12345)).toBe('12,345');
    });

    it.each([
        ['de-DE', '1234.56', '1.234,56'],
        ['fr-FR', '1234.56', '1\u202f234,56'],
        ['de-DE', '1234.', '1.234,'],
        ['fr-FR', '.5', ',5'],
    ])('formats canonical %s input without changing precision', (locale, input, expected) => {
        expect(formatWithThousands(input, locale)).toBe(expected);
    });
});

describe('shared/amountFormat normalizeLocalizedDecimal', () => {
    it.each([
        ['de-DE', '1.234,56', '1234.56'],
        ['de-DE', '1,234.56', '1234.56'],
        ['fr-FR', '1\u202f234,56', '1234.56'],
        ['fr-FR', '1,234.56', '1234.56'],
        ['de-DE', '1.234', '1234'],
        ['de-DE', '1,25', '1.25'],
        ['en-US', '1,234', '1234'],
        ['en-US', '1,25', '1.25'],
    ])('normalizes %s input %s to the wire decimal', (locale, input, expected) => {
        expect(normalizeLocalizedDecimal(input, locale)).toBe(expected);
    });

    it.each([
        ['de-DE', '12.34,56'],
        ['fr-FR', '1,234,56'],
        ['en-US', '1.2.3'],
        ['de-DE', '12 EUR'],
    ])('rejects malformed %s input %s instead of guessing', (locale, input) => {
        expect(normalizeLocalizedDecimal(input, locale)).toBeNull();
    });
});

describe('shared/amountFormat caret helpers', () => {
    it('countNonCommaBefore counts only non-comma chars up to the cursor', () => {
        // "12,345" - cursor at index 5 spans "12,34" -> 4 non-comma chars.
        expect(countNonCommaBefore('12,345', 5)).toBe(4);
        expect(countNonCommaBefore('12,345', 0)).toBe(0);
        // Cursor past the end clamps to length.
        expect(countNonCommaBefore('12,345', 99)).toBe(5);
    });

    it('indexAfterNonCommaCount is the inverse mapping into the formatted string', () => {
        // 4 non-comma chars into "12,345" lands just after the "4" (index 5).
        expect(indexAfterNonCommaCount('12,345', 4)).toBe(5);
        expect(indexAfterNonCommaCount('12,345', 0)).toBe(0);
        // Requesting more than exist clamps to the end.
        expect(indexAfterNonCommaCount('12,345', 99)).toBe('12,345'.length);
    });

    it('round-trips a caret through a reformat', () => {
        const before = '1234';
        const cursor = 3; // just after the "3" in "1234"
        const n = countNonCommaBefore(before, cursor);
        const after = formatWithThousands(before); // "1,234"
        const mapped = indexAfterNonCommaCount(after, n);
        // 3 non-comma chars into "1,234" is index 4 (after the "3").
        expect(after[mapped - 1]).toBe('3');
    });
});

describe('shared/amountFormat token precision validation', () => {
    it('rejects decimal notation for an indivisible token', () => {
        expect(tokenAmountPrecisionError('1.5', {
            divisibility: 0,
            tick: 'ART',
        })).toBe('Amount must be a whole number because ART is indivisible.');
        expect(tokenAmountPrecisionError('1.0', {
            divisibility: 0,
            tick: 'ART',
        })).toBe('Amount must be a whole number because ART is indivisible.');
        expect(tokenAmountPrecisionError('.5', {
            divisibility: 0,
            tick: 'ART',
        })).toBe('Amount must be a whole number because ART is indivisible.');
    });

    it('enforces a known positive decimal scale and allows an unknown scale', () => {
        expect(tokenAmountPrecisionError('1.234', {
            divisibility: 2,
            tick: 'CENTS',
            noun: 'Price',
        })).toBe('Price can have at most 2 decimal places for CENTS.');
        expect(tokenAmountPrecisionError('1.23', { divisibility: 2, tick: 'CENTS' })).toBeNull();
        expect(tokenAmountPrecisionError('1.234', { divisibility: null, tick: 'CENTS' })).toBeNull();
    });
});

describe('shared/amountFormat exact rendering', () => {
    it.each([
        ['zero scale', '123', 0, '123'],
        ['fractional scale', '123', 2, '1.23'],
        ['numeric string scale', '123', '2', '1.23'],
        ['leading fractional zeros', '1', 8, '0.00000001'],
        ['negative quantity', '-123', 2, '-1.23'],
        ['invalid quantity', '1.2', 2, null],
        ['negative scale', '123', -1, null],
        ['fractional scale value', '123', 1.5, null],
        ['non-numeric scale', '123', Number.NaN, null],
    ])('converts %s', (_label, value, decimals, expected) => {
        expect(decimalFromBaseUnits(value, decimals)).toBe(expected);
    });

    it.each([
        ['pads exact values', '1.2', 3, '1.200'],
        ['rounds below half down', '1.234', 2, '1.23'],
        ['rounds half up', '1.235', 2, '1.24'],
        ['rounds negative halves away from zero', '-1.235', 2, '-1.24'],
        ['carries into the whole part', '9.99', 0, '10'],
        ['rejects invalid values', 'not-a-number', 2, null],
        ['rejects negative precision', '1.2', -1, null],
        ['rejects fractional precision', '1.2', 1.5, null],
    ])('%s', (_label, value, precision, expected) => {
        expect(roundDecimalString(value, precision)).toBe(expected);
    });
});
