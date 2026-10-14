// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    baseUnitsToCoinText,
    classifyObligation,
    countdownText,
    obligationBaseUnits,
} from '../../../packages/core/src/market/obligationStatus.js';

const NOW = 1_800_000_000;

describe('market/obligationStatus edge branches', () => {
    it('floors fractional deadline differences before classification', () => {
        expect(classifyObligation(NOW + 1800.9, NOW)).toEqual({
            state: 'at-risk',
            secondsLeft: 1800,
        });
        expect(classifyObligation(NOW + 1801.9, NOW)).toEqual({
            state: 'open',
            secondsLeft: 1801,
        });
    });

    it('rejects non-finite countdowns and floors positive fractions', () => {
        expect(countdownText(Number.NaN)).toBeNull();
        expect(countdownText(Infinity)).toBeNull();
        expect(countdownText(59.9)).toBe('59s');
        expect(countdownText(60.9)).toBe('1m 00s');
        expect(countdownText(3600)).toBe('1h 00m');
    });

    it('accepts surrounding whitespace and all supported fractional widths', () => {
        expect(obligationBaseUnits(' 2 ')).toBe(200_000_000n);
        expect(obligationBaseUnits('2.1')).toBe(210_000_000n);
        expect(obligationBaseUnits('2.00000001')).toBe(200_000_001n);
    });

    it('rejects signed and malformed obligation amount shapes', () => {
        for (const value of ['+1', '01e2', '1..0', 'NaN', Infinity, -0.1]) {
            expect(obligationBaseUnits(value)).toBeNull();
        }
    });

    it('renders padded fractions and trims only trailing fractional zeros', () => {
        expect(baseUnitsToCoinText('10')).toBe('0.0000001');
        expect(baseUnitsToCoinText('100000010')).toBe('1.0000001');
        expect(baseUnitsToCoinText('200100000')).toBe('2.001');
    });

    it('rejects non-finite and whitespace-only base-unit shapes', () => {
        for (const value of [Number.NaN, Infinity, ' ', '+1', '1e8']) {
            expect(baseUnitsToCoinText(value)).toBeNull();
        }
    });
});
