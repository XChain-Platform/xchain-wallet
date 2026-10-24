// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    formatElapsedTime,
    formatLocalDateTime,
    formatRelativeTime,
    formatUnixSecondsLocal,
} from '../../../../packages/core/src/shared/utils/dateTime.js';

afterEach(() => vi.restoreAllMocks());

describe('shared date and time formatting', () => {
    it('uses one compact vocabulary for relative times', () => {
        expect(formatElapsedTime(4_000)).toBe('just now');
        expect(formatElapsedTime(42_000)).toBe('42 seconds ago');
        expect(formatElapsedTime(5 * 60_000)).toBe('5 minutes ago');
        expect(formatElapsedTime(3 * 60 * 60_000)).toBe('3 hours ago');
        expect(formatRelativeTime(1_700_000_000, 1_700_000_300_000)).toBe('5 minutes ago');
    });

    it.each([
        ['en-US', '3 minutes ago', 'just now'],
        ['de-DE', 'vor 3 Minuten', 'jetzt'],
        ['fr-FR', 'il y a 3 minutes', 'maintenant'],
        ['ar-EG', 'قبل ٣ دقائق', 'الآن'],
    ])('uses %s wording and digits', (locale, elapsed, current) => {
        expect(formatElapsedTime(3 * 60_000, locale)).toBe(elapsed);
        expect(formatElapsedTime(4_000, locale)).toBe(current);
    });

    it('formats absolute times through the viewer local zone and never as ISO', () => {
        const locale = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 8, 2025, 7:00 AM PDT');

        const text = formatLocalDateTime(1_751_983_200);

        expect(text).toBe('Jul 8, 2025, 7:00 AM PDT');
        expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(locale).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeZoneName: 'short' }));
    });

    it('falls back to a labelled UTC value when locale formatting is unavailable', () => {
        vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        const text = formatLocalDateTime(1_751_983_200);

        expect(text).toMatch(/GMT$/);
        expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reads an EXPIRATION field as seconds even when the date lies past year 5138', () => {
        const locale = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function () { return this.toISOString(); });

        expect(formatUnixSecondsLocal('4102444800')).toBe('2100-01-01T00:00:00.000Z');
        expect(formatUnixSecondsLocal('253402300799')).toBe('9999-12-31T23:59:59.000Z');
        expect(locale).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeZoneName: 'short' }));
    });

    it.each(['', 'abc', '12.5', '-5', '1e9', '1234567890123'])('returns null for %j, which is not a count of seconds', (value) => {
        expect(formatUnixSecondsLocal(value)).toBeNull();
    });
});
