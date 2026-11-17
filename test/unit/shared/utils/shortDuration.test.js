// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { shortDuration } from '../../../../packages/core/src/shared/utils/shortDuration.js';

const H = 3600;
const D = 24 * H;
const MONTH = 30 * D;

describe('shortDuration bands and boundaries', () => {
    it('refuses non-positive and non-finite input', () => {
        for (const v of [0, -5, NaN, Infinity, undefined, null]) expect(shortDuration(v)).toBeNull();
    });

    it('reads minutes under an hour', () => {
        expect(shortDuration(30 * 60)).toBe('30 min');
        expect(shortDuration(59 * 60)).toBe('59 min');
    });

    it('reads hours under a day', () => {
        expect(shortDuration(H)).toBe('1 hour');
        expect(shortDuration(6 * H)).toBe('6 hours');
        expect(shortDuration(23 * H)).toBe('23 hours');
    });

    it('moves a value that rounds up into the next unit', () => {
        expect(shortDuration(59.7 * 60)).toBe('1 hour');
        expect(shortDuration(23.6 * H)).toBe('1 day');
    });

    it('reads days under a week', () => {
        expect(shortDuration(D)).toBe('1 day');
        expect(shortDuration(3 * D)).toBe('3 days');
        expect(shortDuration(6 * D)).toBe('6 days');
    });

    it('reads weeks under a month', () => {
        expect(shortDuration(7 * D)).toBe('1 week');
        expect(shortDuration(14 * D)).toBe('2 weeks');
        expect(shortDuration(29 * D)).toBe('4 weeks');
    });

    it('reads months under twelve', () => {
        expect(shortDuration(MONTH)).toBe('1 month');
        expect(shortDuration(6 * MONTH)).toBe('6 months');
        expect(shortDuration(11 * MONTH)).toBe('11 months');
    });

    it('reads one year at twelve months, never 18 months', () => {
        expect(shortDuration(12 * MONTH)).toBe('1 year');
        expect(shortDuration(11.7 * MONTH)).toBe('1 year');
        expect(shortDuration(18 * MONTH)).toBe('1.5 years');
    });

    it('reads years with at most one decimal', () => {
        expect(shortDuration(24 * MONTH)).toBe('2 years');
        expect(shortDuration(30 * MONTH)).toBe('2.5 years');
        expect(shortDuration(12 * MONTH * 1.04)).toBe('1 year');
        expect(shortDuration(12 * MONTH * 1.26)).toBe('1.3 years');
    });
});
