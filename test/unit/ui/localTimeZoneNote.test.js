// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { localTimeZoneNote, formatUtcOffset } from '../../../packages/core/src/ui/localTimeZoneNote.js';

describe('localTimeZoneNote', () => {
    it('names the zone and offset when the field is empty', () => {
        const note = localTimeZoneNote('', 'America/Chicago');
        expect(note).toMatch(/^Time is in your local time zone, America\/Chicago \(UTC([+-]\d+(:\d\d)?)?\)\.$/);
    });

    it('adds the entered moment in UTC, read as device local time', () => {
        const value = '2026-12-01T15:30';
        const iso = new Date(Date.parse(value)).toISOString();
        const note = localTimeZoneNote(value, 'Europe/Paris');
        expect(note).toContain('Europe/Paris');
        expect(note).toContain(`That is ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC.`);
    });

    it('falls back to the offset alone without a zone name', () => {
        expect(localTimeZoneNote('', '')).toMatch(/^Time is in your local time zone, UTC([+-]\d+(:\d\d)?)?\.$/);
    });

    it('ignores an unparseable value', () => {
        expect(localTimeZoneNote('not-a-date', 'UTC')).not.toContain('That is');
    });
});

describe('formatUtcOffset', () => {
    it('formats whole, half-hour and zero offsets', () => {
        expect(formatUtcOffset(0)).toBe('UTC');
        expect(formatUtcOffset(-360)).toBe('UTC-6');
        expect(formatUtcOffset(330)).toBe('UTC+5:30');
        expect(formatUtcOffset(-570)).toBe('UTC-9:30');
    });
});
