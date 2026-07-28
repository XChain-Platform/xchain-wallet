// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Adding token amounts is the one place a float is never good enough: the
// amounts arrive as strings because they can carry 18 places, and the wallet
// only sums them itself where no indexer aggregate exists (the settled-market
// split). 0.1 + 0.2 is the whole argument for this helper.

import { describe, it, expect } from 'vitest';
import { sumDecimalStrings } from '../../../packages/core/src/shared/utils/amountFormat.js';

describe('sumDecimalStrings', () => {
    it('adds whole numbers as whole numbers', () => {
        expect(sumDecimalStrings(['300', '100'])).toBe('400');
    });

    it('does not round the way a float would', () => {
        expect(sumDecimalStrings(['0.1', '0.2'])).toBe('0.3');
        expect(Number('0.1') + Number('0.2')).not.toBe(0.3);
    });

    it('keeps the longest precision it was given', () => {
        expect(sumDecimalStrings(['1.5', '2.25'])).toBe('3.75');
        expect(sumDecimalStrings(['0.000000000000000001', '1'])).toBe('1.000000000000000001');
    });

    it('survives amounts too large for a double', () => {
        expect(sumDecimalStrings(['9007199254740993', '1'])).toBe('9007199254740994');
    });

    it('handles negatives and mixed signs', () => {
        expect(sumDecimalStrings(['5', '-2.5'])).toBe('2.5');
        expect(sumDecimalStrings(['-1.25', '-2.75'])).toBe('-4.00');
    });

    it('returns 0 for nothing addable rather than NaN', () => {
        expect(sumDecimalStrings([])).toBe('0');
        expect(sumDecimalStrings(null)).toBe('0');
        expect(sumDecimalStrings([null, undefined, ''])).toBe('0');
    });

    it('skips values it cannot parse instead of guessing at them', () => {
        expect(sumDecimalStrings(['100', 'abc', '1e3', '50'])).toBe('150');
    });
});
