// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    multiplyAmounts,
    subtractAmounts,
} from '../../../packages/core/src/market/orderMath.js';

describe('market/orderMath remaining subtraction branches', () => {
    it('rejects equal and increasing balances as non-debits', () => {
        expect(subtractAmounts('1.25', '1.25')).toBeNull();
        expect(subtractAmounts('1.25', '2.5')).toBeNull();
    });

    it('removes a fractional scale when the exact difference is whole', () => {
        expect(subtractAmounts('2.5', '0.5')).toBe('2');
    });

    it('rejects zero values after leading-zero normalization', () => {
        expect(multiplyAmounts('000.000', '0002.0')).toBeNull();
    });
});
