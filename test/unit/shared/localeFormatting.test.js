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
} from '../../../packages/core/src/shared/utils/amountFormat.js';
import { formatFiatAmount } from '../../../packages/core/src/shared/utils/fiatAmountFormat.js';
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
});
