// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (wallet E2E D-86): the arithmetic behind the Pay dividend form's
// Max button. A DIVIDEND's AMOUNT is a per-unit RATE, so the ceiling is
// balance / eligible units, floored to the dividend token's divisibility.
// The property that matters throughout: rate x units must never exceed
// the balance, which is exactly what float division cannot promise.

import { describe, it, expect } from 'vitest';
import {
    perUnitMax,
    sumHolderUnits,
    multiplyDecimal,
    compareDecimal,
    exceedsBalance,
} from '../../../packages/core/src/shared/utils/dividendPerUnit.js';

describe('sumHolderUnits', () => {
    it('sums integer holdings exactly', () => {
        expect(sumHolderUnits([{ amount: '500' }, { amount: '250' }])).toBe('750');
    });

    it('sums mixed precision without float drift', () => {
        expect(sumHolderUnits([{ amount: '0.1' }, { amount: '0.2' }])).toBe('0.3');
    });

    it('reads an empty holder set as zero units', () => {
        expect(sumHolderUnits([])).toBe('0');
    });

    it('reads an unparseable row as unknown rather than skipping it', () => {
        // Skipping would understate the divisor, which hands Max a rate
        // that overpays: the very defect this module exists to stop.
        expect(sumHolderUnits([{ amount: '500' }, { amount: '1e3' }])).toBe(null);
        expect(sumHolderUnits([{ amount: '500' }, {}])).toBe(null);
        expect(sumHolderUnits(null)).toBe(null);
    });
});

describe('multiplyDecimal', () => {
    it('multiplies exactly where floats drift', () => {
        expect(multiplyDecimal('0.1', '3')).toBe('0.3');
        expect(multiplyDecimal('9.998', '500')).toBe('4999');
    });

    it('is null when either side is unreadable', () => {
        expect(multiplyDecimal('9.998', undefined)).toBe(null);
    });
});

describe('perUnitMax', () => {
    it('divides the balance across the eligible units (the D-86 case)', () => {
        // Session 19: 4,999 XCHAIN held, one eligible holder of 500 units.
        // Max used to fill 4,999, proposing 2,499,500 XCHAIN.
        expect(perUnitMax({ balance: '4999', eligibleUnits: '500', divisibility: 8 }))
            .toBe('9.998');
    });

    it('never proposes more than the balance can pay', () => {
        const rate = perUnitMax({ balance: '10', eligibleUnits: '3', divisibility: 8 });
        expect(rate).toBe('3.33333333');
        expect(compareDecimal(multiplyDecimal(rate, '3'), '10')).toBe(-1);
    });

    it('floors to the dividend token divisibility, so an indivisible token gets an integer', () => {
        expect(perUnitMax({ balance: '10', eligibleUnits: '3', divisibility: 0 })).toBe('3');
        expect(perUnitMax({ balance: '4999', eligibleUnits: '500', divisibility: 2 })).toBe('9.99');
    });

    it('assumes the protocol maximum of 8 places when divisibility is unknown', () => {
        expect(perUnitMax({ balance: '10', eligibleUnits: '3' })).toBe('3.33333333');
        expect(perUnitMax({ balance: '10', eligibleUnits: '3', divisibility: null }))
            .toBe('3.33333333');
    });

    it('handles a fractional balance and fractional holdings', () => {
        expect(perUnitMax({ balance: '0.5', eligibleUnits: '2.5', divisibility: 8 })).toBe('0.2');
    });

    it('is 0 when the balance cannot cover even the smallest rate', () => {
        expect(perUnitMax({ balance: '0.00000001', eligibleUnits: '500', divisibility: 8 }))
            .toBe('0');
    });

    it('is unknown when the balance, the holder set, or either, is missing', () => {
        expect(perUnitMax({ balance: null, eligibleUnits: '500' })).toBe(null);
        expect(perUnitMax({ balance: '4999', eligibleUnits: null })).toBe(null);
        // Nobody eligible: there is no rate to offer, not a rate of zero.
        expect(perUnitMax({ balance: '4999', eligibleUnits: '0' })).toBe(null);
        expect(perUnitMax({ balance: '0', eligibleUnits: '500' })).toBe(null);
    });
});

describe('exceedsBalance', () => {
    it('catches a total larger than the balance backing it', () => {
        expect(exceedsBalance('2499500', '4999')).toBe(true);
    });

    it('lets an exactly-payable total through', () => {
        expect(exceedsBalance('4999', '4999')).toBe(false);
    });

    it('stays false when either value is unknown, leaving the form ungated', () => {
        expect(exceedsBalance('2499500', null)).toBe(false);
        expect(exceedsBalance(undefined, '4999')).toBe(false);
    });
});
