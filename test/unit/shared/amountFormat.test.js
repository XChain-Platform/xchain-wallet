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
    countNonCommaBefore,
    indexAfterNonCommaCount,
    trimAmountTail,
} from '../../../packages/core/src/shared/utils/amountFormat.js';

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
