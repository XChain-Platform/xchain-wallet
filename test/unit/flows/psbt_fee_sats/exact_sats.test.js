// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    exactSats,
    formatExactSats,
    renderSats,
    sumExactSats,
} from '../../../../packages/core/src/flows/psbtNetworkFee.js';

describe('exactSats', () => {
    it.each([
        [5n, 5n],
        ['42', 42n],
        [' 42 ', 42n],
        [12, 12n],
    ])('parses %s as an exact nonnegative bigint', (value, expected) => {
        expect(exactSats(value)).toBe(expected);
    });

    it.each([-1n, 4.5, -3, null, '', 1.5])('rejects invalid value %s', (value) => {
        expect(exactSats(value)).toBeNull();
    });
});

describe('renderSats', () => {
    it('renders safe bigint values as numbers', () => {
        expect(renderSats(10n)).toBe(10);
        expect(renderSats(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('renders a bigint above the safe integer limit as a decimal string', () => {
        const value = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

        expect(renderSats(value)).toBe('9007199254740992');
    });
});

describe('sumExactSats', () => {
    it('sums mixed exact satoshi representations', () => {
        expect(sumExactSats(['1', 2, 3n])).toBe(6n);
        expect(sumExactSats([])).toBe(0n);
    });

    it.each(['x', -1n])('rejects a list containing invalid member %s', (value) => {
        expect(sumExactSats(['1', value, 3n])).toBeNull();
    });
});

describe('formatExactSats', () => {
    it.each([
        ['1234567', '1,234,567'],
        [0, '0'],
        [1000n, '1,000'],
    ])('formats %s with digit grouping', (value, expected) => {
        expect(formatExactSats(value)).toBe(expected);
    });

    it('returns null for an invalid value', () => {
        expect(formatExactSats('x')).toBeNull();
    });
});
