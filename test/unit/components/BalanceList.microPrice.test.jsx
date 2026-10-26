// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token priced under one millionth of a unit reaches the fiat math as a
// float whose String() is exponent text ("1e-7"). The exact multiply reads
// that as not a number, so the row must not fall out of the priced total.

import { describe, expect, it } from 'vitest';
import { fiatValue, sumFiatValue } from '../../../packages/core/src/shared/components/BalanceList.jsx';

describe('BalanceList fiat value for exponent-form rates', () => {
    it.each([
        ['1e-7', 1e-7, '1000000000', 0, '100'],
        ['1.5e-9', 1.5e-9, '2000000000', 0, '3'],
        ['0.000001', 0.000001, '5000000', 0, '5'],
    ])('prices a row at a %s rate', (_label, rate, quantity, divisibility, expected) => {
        expect(fiatValue(quantity, divisibility, rate)).toBe(expected);
    });

    it('counts a micro-priced row as priced in the total', () => {
        const rows = [{ quantity: '1000000000', divisibility: 0, fiatRate: 1e-7 }];
        expect(sumFiatValue(rows)).toEqual({ total: '100', priced: 1, unpriced: 0 });
    });
});
