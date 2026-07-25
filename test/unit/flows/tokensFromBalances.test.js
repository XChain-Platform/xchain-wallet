// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit (D-14): the explorer `/balances/` row encodes a token's scale as
// `decimals` and its `amount` is already at that scale (whole units when
// decimals=0). tokensFromBalances must read `decimals` and NOT re-scale by a
// hardcoded divisibility of 8; the pre-fix default turned 99 XCHAIN into
// 0.00000099 downstream (scaleDown by 1e8).

import { describe, it, expect } from 'vitest';
import { tokensFromBalances } from '../../../packages/core/src/flows/balances.js';

describe('tokensFromBalances (D-14 decimals mapping)', () => {
    it('maps a decimals:0 row to divisibility 0 (no down-scaling)', () => {
        const out = tokensFromBalances({
            data: [
                { tick: 'XCHAIN', amount: '99', decimals: 0, supply: '859969' },
                { tick: 'MEMEVALID', amount: '1000000', decimals: 0, supply: '1000000' },
            ],
        });
        expect(out).toEqual([
            { tick: 'XCHAIN', quantity: '99', divisibility: 0, displayName: 'XCHAIN', imageUrl: null },
            { tick: 'MEMEVALID', quantity: '1000000', divisibility: 0, displayName: 'MEMEVALID', imageUrl: null },
        ]);
    });

    it('reads amount into quantity when quantity is absent', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'T', amount: '42', decimals: 0 }] });
        expect(row.quantity).toBe('42');
    });

    it('honors an explicit decimals value for a divisible token', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'D', amount: '500000000', decimals: 8 }] });
        expect(row.divisibility).toBe(8);
    });

    it('still accepts the legacy divisibility field when present', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'L', quantity: '5', divisibility: 3 }] });
        expect(row.divisibility).toBe(3);
        expect(row.quantity).toBe('5');
    });

    it('defaults divisibility to 0 (not 8) when neither field is present', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'N', amount: '7' }] });
        expect(row.divisibility).toBe(0);
    });

    it('tolerates a missing/empty data array', () => {
        expect(tokensFromBalances({})).toEqual([]);
        expect(tokensFromBalances(null)).toEqual([]);
        expect(tokensFromBalances({ data: [{ amount: '1' }] })).toEqual([]); // no tick → dropped
    });
});
