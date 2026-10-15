// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    formatFiatAmount,
    formatFiatAmountForSpeech,
    isValidFiatAmount,
} from '../../../../packages/core/src/shared/utils/fiatAmountFormat.js';

describe('fiat amount branch coverage', () => {
    it.each([
        ['0', true],
        ['12.3', true],
        ['12.34', true],
        ['12.', false],
        ['12.345', false],
        [null, false],
    ])('validates %j as %s', (value, expected) => {
        expect(isValidFiatAmount(value)).toBe(expected);
    });

    it('handles nullish, non-finite, and non-decimal numeric inputs', () => {
        expect(formatFiatAmount(null)).toBe('');
        expect(formatFiatAmountForSpeech(undefined)).toBe('');
        expect(formatFiatAmount('')).toBe('');
        expect(formatFiatAmount(Number.POSITIVE_INFINITY)).toBe('');
        expect(formatFiatAmountForSpeech(Number.NEGATIVE_INFINITY)).toBe('');
        expect(formatFiatAmount('0x10', 'USD', 'en-US')).toBe('$16.00');
        expect(formatFiatAmount('0x0', 'USD', 'en-US')).toBe('$0.00');
        expect(formatFiatAmount('.01', 'USD', 'en-US')).toBe('$0.01');
        expect(formatFiatAmount('.001', 'USD', 'en-US')).toBe('< $0.01');
        expect(formatFiatAmount('-.001', 'USD', 'en-US')).toBe('> -$0.01');
    });

    it('removes a currency code only when the formatter emits the code', () => {
        expect(formatFiatAmount('12', 'XTS', 'en-US', { omitCodeSymbol: true })).toBe('12.00');
        expect(formatFiatAmount('12', 'USD', 'en-US', { omitCodeSymbol: true })).toBe('$12.00');
    });

    it('falls back to decimal formatting for invalid currency codes', () => {
        expect(formatFiatAmount('12.5', 'INVALID', 'en-US')).toBe('12.50 INVALID');
        expect(formatFiatAmount('0.001', 'INVALID', 'en-US')).toBe('< 0.01 INVALID');
        expect(formatFiatAmount('-0.001', 'INVALID', 'en-US', { omitCodeSymbol: true }))
            .toBe('> -0.01');
        expect(formatFiatAmount('2', '', 'en-US')).toBe('$2.00');
    });

    it('speaks threshold fallbacks for invalid currency codes', () => {
        expect(formatFiatAmountForSpeech('12.5', 'INVALID', 'en-US'))
            .toBe('12.50 INVALID');
        expect(formatFiatAmountForSpeech('0.001', 'INVALID', 'en-US'))
            .toBe('less than 0.01 INVALID');
        expect(formatFiatAmountForSpeech('-0.001', 'INVALID', 'en-US'))
            .toBe('more than -0.01 INVALID');
        expect(formatFiatAmountForSpeech('2', '', 'en-US')).toBe('2.00 US dollars');
    });

    it('speaks thresholds with a supported currency', () => {
        expect(formatFiatAmountForSpeech('2', 'USD', 'en-US')).toBe('2.00 US dollars');
        expect(formatFiatAmountForSpeech('0.001', 'USD', 'en-US'))
            .toBe('less than 0.01 US dollars');
        expect(formatFiatAmountForSpeech('-0.001', 'USD', 'en-US'))
            .toBe('more than -0.01 US dollars');
    });
});
