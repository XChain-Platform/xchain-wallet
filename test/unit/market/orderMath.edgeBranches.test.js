// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    compareAmounts,
    multiplyAmounts,
    subtractAmounts,
} from '../../../packages/core/src/market/orderMath.js';

describe('market/orderMath edge branches', () => {
    it('normalizes padded decimal operands without losing scale', () => {
        expect(multiplyAmounts('0002.500', '04.00')).toBe('10');
        expect(multiplyAmounts('  .25 ', ' 4. ')).toBe('1');
    });

    it('rejects an invalid second operand independently', () => {
        expect(multiplyAmounts('2', '1e2')).toBeNull();
        expect(compareAmounts('2', '0x10')).toBeNull();
        expect(subtractAmounts('2', '-1')).toBeNull();
    });

    it('compares BigInts and equivalent leading-dot decimals', () => {
        expect(compareAmounts(10n, 9n)).toBe(1);
        expect(compareAmounts('000.10', '.1')).toBe(0);
        expect(compareAmounts('.099', '.1')).toBe(-1);
    });

    it('pads a tiny positive subtraction result', () => {
        expect(subtractAmounts('.00000002', '.00000001')).toBe('0.00000001');
    });

    it('returns an integer directly when subtraction has no fractional scale', () => {
        expect(subtractAmounts('1000', '1')).toBe('999');
    });

    it('rejects numbers whose string representation is scientific notation', () => {
        expect(multiplyAmounts(1e21, 2)).toBeNull();
        expect(compareAmounts(1e21, 2)).toBeNull();
        expect(subtractAmounts(1e21, 2)).toBeNull();
    });
});
