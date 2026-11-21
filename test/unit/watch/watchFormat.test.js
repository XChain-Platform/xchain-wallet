// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    ageText,
    amountText,
    balanceText,
    fiatText,
} from '../../../packages/core/src/watch/watchFormat.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 10, 20, 12);
const row = {
    quantity: '123450000000',
    divisibility: 8,
    tick: 'TICK',
    fiatRate: 2,
};

describe('watch formatting', () => {
    it.each([
        ['full', '1,234.50000000 TICK'],
        ['trim', '1,234.5 TICK'],
        ['plain', '1234.50000000 TICK'],
    ])('uses the %s number format for unit amounts', (numberFormat, expected) => {
        expect(amountText(row, { numberFormat })).toBe(expected);
    });

    it('uses the effective display currency for fiat values', () => {
        expect(fiatText(row, { fiatCurrency: 'EUR' })).toBe('€2,469.00');
        expect(fiatText(row, { fiatCurrency: 'not-supported' })).toBe('$2,469.00');
    });

    it('uses the two-line no-price form only in fiat mode', () => {
        const unpriced = { ...row, fiatRate: null };
        expect(balanceText(unpriced, 'fiat')).toEqual({
            primary: 'No price yet',
            secondary: '1,234.50000000 TICK',
        });
        expect(balanceText(unpriced, 'units')).toEqual({
            primary: '1,234.50000000 TICK',
            secondary: '',
        });
    });

    it('uses a single primary line when the selected mode has a value', () => {
        const settings = { fiatCurrency: 'EUR', numberFormat: 'trim' };
        expect(balanceText(row, 'fiat', settings)).toEqual({
            primary: '€2,469.00',
            secondary: '',
        });
        expect(balanceText(row, 'units', settings)).toEqual({
            primary: '1,234.5 TICK',
            secondary: '',
        });
    });

    it.each([
        [NOW - 59_999, 'Updated just now'],
        [NOW - MINUTE, 'Updated 1 min ago'],
        [NOW - 59 * MINUTE, 'Updated 59 min ago'],
        [NOW - HOUR, 'Updated 1 h ago'],
        [NOW - 23 * HOUR - 59 * MINUTE, 'Updated 23 h ago'],
        [NOW - 24 * HOUR, 'Open XChain Wallet on your phone to refresh'],
    ])('formats balance age %s', (balancesAt, expected) => {
        expect(ageText(balancesAt, NOW)).toBe(expected);
    });
});
