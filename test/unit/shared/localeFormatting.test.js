// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';
import {
    formatAtomicAmount,
    formatDecimalAmount,
    formatDisplayAmount,
    formatTokenQuantity,
    formatWithThousands,
    normalizeLocalizedDecimal,
    trimAmountTail,
} from '../../../packages/core/src/shared/utils/amountFormat.js';
import {
    formatFiatAmount,
    formatFiatAmountForSpeech,
} from '../../../packages/core/src/shared/utils/fiatAmountFormat.js';
import {
    formatLocalDateTime as formatZonedDateTime,
    formatRelativeTime,
} from '../../../packages/core/src/shared/utils/dateTime.js';
import {
    formatLocalDateTime,
    formatRelativeDateTime,
} from '../../../packages/core/src/shared/utils/dateTimeFormat.js';

beforeAll(() => {
    registerLocale('de-DE', {});
});

afterEach(async () => {
    await setLocale('en');
});

describe('locale-aware exact amount formatting', () => {
    it('groups atomic and decimal strings without losing digits', () => {
        expect(formatAtomicAmount('1234567890123456789012', 2, 'en-US'))
            .toBe('12,345,678,901,234,567,890.12');
        expect(formatDecimalAmount('9007199254740993.00000001', 'en-US'))
            .toBe('9,007,199,254,740,993.00000001');
    });

    it('uses the Language and Region locale for separators', async () => {
        await setLocale('de-DE');
        expect(formatAtomicAmount('123450', 2)).toBe('1.234,50');
        expect(formatDecimalAmount('1234567.89')).toBe('1.234.567,89');
    });

    it('normalizes locale grouping patterns beyond groups of three', () => {
        expect(normalizeLocalizedDecimal('12,34,567.89', 'en-IN')).toBe('1234567.89');
        expect(normalizeLocalizedDecimal('1,234,567.89', 'en-IN')).toBe('1234567.89');
        expect(normalizeLocalizedDecimal('123,45,678.90', 'en-IN')).toBeNull();
    });

    it('does not expose a negative sign for exact zero', () => {
        expect(formatDecimalAmount('-0.000', 'en-US')).toBe('0.000');
        expect(formatAtomicAmount('-0', 2, 'en-US')).toBe('0.00');
        expect(trimAmountTail('-0.000')).toBe('0');
    });

    it('leaves missing and non-finite amounts blank', () => {
        expect(formatAtomicAmount(undefined, 8, 'en-US')).toBe('');
        expect(formatDecimalAmount(Number.NaN, 'en-US')).toBe('');
        expect(formatDisplayAmount(Number.NaN, 'en-US')).toBe('');
        expect(formatTokenQuantity(Number.POSITIVE_INFINITY, 8, 'en-US')).toBe('');
        expect(formatWithThousands(Number.NaN, 'en-US')).toBe('');
    });
});

describe('locale-aware exact fiat formatting', () => {
    it.each([
        {
            label: 'pads a normal USD value',
            value: '12.5',
            currency: 'USD',
            locale: 'en-US',
            expected: '$12.50',
        },
        {
            label: 'floors tiny positive USD values',
            value: '0.004',
            currency: 'USD',
            locale: 'en-US',
            expected: '< $0.01',
        },
        {
            label: 'floors tiny values supplied in scientific notation',
            value: '5e-7',
            currency: 'USD',
            locale: 'en-US',
            expected: '< $0.01',
        },
        {
            label: 'keeps a large exact value grouped',
            value: '9007199254740993',
            currency: 'USD',
            locale: 'en-US',
            expected: '$9,007,199,254,740,993.00',
        },
        {
            label: 'places a selected currency after a German value',
            value: '1234567.8',
            currency: 'EUR',
            locale: 'de-DE',
            expected: '1.234.567,80 €',
        },
        {
            label: 'uses two display decimals for a zero-minor-unit currency',
            value: '1234.5',
            currency: 'JPY',
            locale: 'ja-JP',
            expected: '￥1,234.50',
        },
        {
            label: 'floors tiny values with locale-specific symbol placement',
            value: '0.005',
            currency: 'JPY',
            locale: 'de-DE',
            expected: '< 0,01 ¥',
        },
    ])('$label', ({ value, currency, locale, expected }) => {
        expect(formatFiatAmount(value, currency, locale)).toBe(expected);
    });

    it('handles negative zero, negative dust, and non-finite inputs', () => {
        expect(formatFiatAmount('-0.00', 'USD', 'en-US')).toBe('$0.00');
        expect(formatFiatAmount('-0.004', 'USD', 'en-US')).toBe('> -$0.01');
        expect(formatFiatAmount(Number.NaN, 'USD', 'en-US')).toBe('');
        expect(formatFiatAmount('', 'USD', 'en-US')).toBe('');
    });

    it('uses the same rounding policy for visual and spoken currency values', () => {
        expect(formatFiatAmount('1234.5', 'JPY', 'en-US')).toBe('¥1,234.50');
        expect(formatFiatAmountForSpeech('1234.5', 'JPY', 'en-US'))
            .toBe('1,234.50 Japanese yen');
        expect(formatFiatAmountForSpeech('-0.004', 'USD', 'en-US'))
            .toBe('more than -0.01 US dollars');
    });
});

describe('local History date formatting', () => {
    const timestampSeconds = Date.parse('2024-01-15T20:30:00Z') / 1000;

    it('renders seconds and milliseconds in the device time zone', () => {
        const expected = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(timestampSeconds * 1000));
        expect(formatLocalDateTime(timestampSeconds, 'en-US')).toBe(expected);
        expect(formatLocalDateTime(timestampSeconds * 1000, 'en-US')).toBe(expected);
    });

    it('uses the active language for relative dates', async () => {
        await setLocale('de-DE');
        const now = timestampSeconds * 1000 + 2 * 60 * 1000;
        expect(formatRelativeDateTime(timestampSeconds, now)).toBe('vor 2 Minuten');
    });

    it('recognizes millisecond timestamps before September 2001', () => {
        const timestampMs = Date.parse('2000-01-15T20:30:00Z');
        const date = new Date(timestampMs);
        const expected = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
        const expectedZoned = date.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        });

        expect(formatLocalDateTime(timestampMs, 'en-US')).toBe(expected);
        expect(formatZonedDateTime(timestampMs)).toBe(expectedZoned);
    });

    it('rejects timestamps outside the Date range', () => {
        expect(formatLocalDateTime(1e100, 'en-US')).toBe('-');
        expect(formatZonedDateTime(1e100)).toBeNull();
        expect(formatRelativeTime(1e100)).toBe('');
    });
});
