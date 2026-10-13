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
    it('keeps a value above the safe integer boundary exact', () => {
        expect(formatFiatAmount('9007199254740993', 'USD', 'en-US'))
            .toBe('$9,007,199,254,740,993.00');
    });

    it('uses the active language and each currency minor unit', async () => {
        await setLocale('de-DE');
        expect(formatFiatAmount('1234.5', 'EUR'))
            .toBe(new Intl.NumberFormat('de-DE', {
                style: 'currency',
                currency: 'EUR',
                currencyDisplay: 'symbol',
            }).format('1234.5'));
        expect(formatFiatAmount('0.5', 'JPY')).toBe('<1 ¥');
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
