// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the DEX order-amount multiply (§41.3.4). Guards the
// value-moving path: price × size must be exact and plain-notation so
// the review screen and GIVE_AMOUNT / GET_AMOUNT can never disagree and
// the SDK precision cap stays enforceable.

import { describe, it, expect } from 'vitest';
import { multiplyAmounts } from '../../../packages/core/src/market/orderMath.js';

describe('market/orderMath multiplyAmounts', () => {
    it('multiplies whole numbers exactly', () => {
        expect(multiplyAmounts('2', '3')).toBe('6');
        expect(multiplyAmounts('1000000', '1000000')).toBe('1000000000000');
    });

    it('never emits a float artifact (0.1 × 0.2 = 0.02, not 0.020000000000000004)', () => {
        // The float bug this fixes: Number('0.1') * Number('0.2') is
        // 0.020000000000000004, whose String() the SDK precision cap rejects.
        expect(0.1 * 0.2).not.toBe(0.02); // documents the hazard being fixed
        expect(multiplyAmounts('0.1', '0.2')).toBe('0.02');
        expect(multiplyAmounts('0.1', '0.3')).toBe('0.03');
    });

    it('never emits scientific notation for tiny products', () => {
        // String(1e-8 * 1e-8) === '1e-16', which slips past the SDK cap.
        const out = multiplyAmounts('0.00000001', '0.00000001');
        expect(out).toBe('0.0000000000000001');
        expect(out).not.toMatch(/e/i);
    });

    it('never emits scientific notation for huge products', () => {
        const out = multiplyAmounts('100000000000', '100000000000'); // 1e11 × 1e11
        expect(out).toBe((BigInt('100000000000') * BigInt('100000000000')).toString());
        expect(out).not.toMatch(/e/i);
    });

    it('trims trailing fractional zeros', () => {
        expect(multiplyAmounts('0.5', '0.2')).toBe('0.1'); // 0.10 -> 0.1
        expect(multiplyAmounts('2.5', '4')).toBe('10');    // 10.0 -> 10
    });

    it('preserves full fractional precision (no rounding)', () => {
        expect(multiplyAmounts('1.23456789', '9.87654321')).toBe('12.1932631112635269');
    });

    it('accepts leading-dot and trailing-dot forms', () => {
        expect(multiplyAmounts('.5', '2')).toBe('1');
        expect(multiplyAmounts('3.', '2')).toBe('6');
    });

    it('returns null for zero-valued operands (no order without both sides)', () => {
        expect(multiplyAmounts('0', '5')).toBeNull();
        expect(multiplyAmounts('5', '0')).toBeNull();
        expect(multiplyAmounts('0.0', '5')).toBeNull();
    });

    it('rejects scientific-notation and non-decimal input (e.g. a hostile prefilled price)', () => {
        expect(multiplyAmounts('1e-7', '5')).toBeNull();
        expect(multiplyAmounts('0x10', '5')).toBeNull();
        expect(multiplyAmounts('5abc', '2')).toBeNull();
        expect(multiplyAmounts('-5', '2')).toBeNull();
        expect(multiplyAmounts('', '2')).toBeNull();
        expect(multiplyAmounts('.', '2')).toBeNull();
        expect(multiplyAmounts('1,000', '2')).toBeNull();
    });

    it('accepts BigInt operands', () => {
        expect(multiplyAmounts(2n, 3n)).toBe('6');
    });
});
