// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { amountEntryProblem } from '../../../packages/core/src/shared/utils/amountFormat.js';

describe('amountEntryProblem', () => {
    it('accepts plain positive decimals, including huge and very small ones', () => {
        expect(amountEntryProblem('10')).toBeNull();
        expect(amountEntryProblem('0.5')).toBeNull();
        expect(amountEntryProblem(' 0.00000001 ')).toBeNull();
        expect(amountEntryProblem('999999999999999999999999999.99999999')).toBeNull();
        expect(amountEntryProblem(`0.${'0'.repeat(400)}1`)).toBeNull();
    });

    it('names an empty amount', () => {
        expect(amountEntryProblem('')).toBe('empty');
        expect(amountEntryProblem('   ')).toBe('empty');
        expect(amountEntryProblem(undefined)).toBe('empty');
    });

    it('rejects shapes a float parse lets through', () => {
        for (const bad of ['.', '.5', '5.', '1e5', '0x10', '-1', '1,000', 'abc']) {
            expect(amountEntryProblem(bad), bad).toBe('shape');
        }
    });

    it('rejects zero in any spelling', () => {
        for (const zero of ['0', '0.0', '000', '0.00000000']) {
            expect(amountEntryProblem(zero), zero).toBe('zero');
        }
    });
});
