// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: isWithinQuietHours - DND window, shared by the two
// notification delivery choke points.

import { describe, it, expect } from 'vitest';
import { isWithinQuietHours } from '../../../packages/core/src/notifications/quietHours.js';

function at(hh, mm) {
    const d = new Date(2026, 0, 1, hh, mm, 0, 0);
    return d;
}

describe('isWithinQuietHours', () => {
    it('is false when quietHours is absent', () => {
        expect(isWithinQuietHours(undefined, at(23, 0))).toBe(false);
        expect(isWithinQuietHours({}, at(23, 0))).toBe(false);
    });

    it('is false when disabled', () => {
        const settings = { quietHours: { enabled: false, start: '22:00', end: '08:00' } };
        expect(isWithinQuietHours(settings, at(23, 0))).toBe(false);
    });

    it('suppresses inside a wrap-past-midnight window (22:00-08:00)', () => {
        const settings = { quietHours: { enabled: true, start: '22:00', end: '08:00' } };
        expect(isWithinQuietHours(settings, at(23, 30))).toBe(true);
        expect(isWithinQuietHours(settings, at(1, 0))).toBe(true);
        expect(isWithinQuietHours(settings, at(7, 59))).toBe(true);
    });

    it('does not suppress outside a wrap-past-midnight window', () => {
        const settings = { quietHours: { enabled: true, start: '22:00', end: '08:00' } };
        expect(isWithinQuietHours(settings, at(8, 0))).toBe(false);
        expect(isWithinQuietHours(settings, at(12, 0))).toBe(false);
        expect(isWithinQuietHours(settings, at(21, 59))).toBe(false);
    });

    it('handles a same-day window (09:00-17:00)', () => {
        const settings = { quietHours: { enabled: true, start: '09:00', end: '17:00' } };
        expect(isWithinQuietHours(settings, at(9, 0))).toBe(true);
        expect(isWithinQuietHours(settings, at(16, 59))).toBe(true);
        expect(isWithinQuietHours(settings, at(17, 0))).toBe(false);
        expect(isWithinQuietHours(settings, at(8, 59))).toBe(false);
    });

    it('is false for a zero-width window (start === end)', () => {
        const settings = { quietHours: { enabled: true, start: '10:00', end: '10:00' } };
        expect(isWithinQuietHours(settings, at(10, 0))).toBe(false);
        expect(isWithinQuietHours(settings, at(12, 0))).toBe(false);
    });

    it('is false for a malformed window rather than throwing', () => {
        const settings = { quietHours: { enabled: true, start: 'bad', end: '08:00' } };
        expect(isWithinQuietHours(settings, at(23, 0))).toBe(false);
    });
});
