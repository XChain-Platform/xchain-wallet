// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    formatElapsedTime,
    formatLocalDateTime,
    formatRelativeTime,
} from '../../../../packages/core/src/shared/utils/dateTime.js';

afterEach(() => vi.restoreAllMocks());

describe('shared date and time formatting', () => {
    it('uses one compact vocabulary for relative times', () => {
        expect(formatElapsedTime(4_000)).toBe('just now');
        expect(formatElapsedTime(42_000)).toBe('42 sec ago');
        expect(formatElapsedTime(5 * 60_000)).toBe('5 min ago');
        expect(formatElapsedTime(3 * 60 * 60_000)).toBe('3 hr ago');
        expect(formatRelativeTime(1_700_000_000, 1_700_000_300_000)).toBe('5 min ago');
    });

    it('formats absolute times through the viewer local zone and never as ISO', () => {
        const locale = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 8, 2025, 7:00 AM PDT');

        const text = formatLocalDateTime(1_751_983_200);

        expect(text).toBe('Jul 8, 2025, 7:00 AM PDT');
        expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(locale).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeZoneName: 'short' }));
    });

    it('falls back to a labelled UTC value when locale formatting is unavailable', () => {
        vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
            throw new RangeError('locale unavailable');
        });

        const text = formatLocalDateTime(1_751_983_200);

        expect(text).toMatch(/GMT$/);
        expect(text).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
