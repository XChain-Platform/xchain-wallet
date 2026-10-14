// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { addDecimalStrings } from '../../../packages/core/src/cosigner/vaultWindowStore.js';

describe('addDecimalStrings edge cases', () => {
    it('normalizes signs, leading decimals, and cancellation', () => {
        expect(addDecimalStrings('+001.2500', '.75')).toBe('2');
        expect(addDecimalStrings('-1.25', '0.25')).toBe('-1');
        expect(addDecimalStrings('-0.0001', '0.0001')).toBe('0');
        expect(addDecimalStrings('1.', '2')).toBe('3');
    });

    it.each(['.', '1e3', '--1', '1 2', 'Infinity'])('rejects invalid decimal %j', (value) => {
        expect(() => addDecimalStrings(value, '1')).toThrow(/invalid decimal/);
    });
});
