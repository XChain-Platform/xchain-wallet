// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit (D-14 / issue #4): the explorer `/balances/` row encodes a token's
// scale as `decimals` and its `amount` at HUMAN scale (the indexer stores
// AMOUNT literally). The wallet contract is atomic units, so
// tokensFromBalances must scale `amount` UP by 10^decimals; passing it
// through unscaled made every decimals>0 token display 10^decimals too
// small (issue #4: mints of 1000 + 2000.00000000 XCHAIN showed 0.00003000).
// The pre-D-14 default of divisibility 8 had the same effect on decimals:0
// tokens (99 XCHAIN shown as 0.00000099).

import { describe, it, expect } from 'vitest';
import { tokensFromBalances } from '../../../packages/core/src/flows/balances.js';
import { formatAmount } from '../../../packages/core/src/shared/components/BalanceList.jsx';

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

    it('scales a human-scale amount up to atomic units at decimals scale', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'D', amount: '5', decimals: 8 }] });
        expect(row.divisibility).toBe(8);
        expect(row.quantity).toBe('500000000');
    });

    it('issue #4 repro: mints of 1000 + 2000.00000000 render as 3,000, not 0.00003000', () => {
        const out = tokensFromBalances({
            data: [
                { tick: 'XCHAIN', amount: '1000', decimals: 8 },
                { tick: 'XCHAIN', amount: '2000.00000000', decimals: 8 },
            ],
        });
        const total = out.reduce((acc, r) => acc + BigInt(r.quantity), 0n);
        expect(total.toString()).toBe('300000000000');
        expect(formatAmount(total.toString(), 8)).toBe('3,000.00000000');
    });

    it('keeps a fractional balance exact instead of zeroing it', () => {
        const [row] = tokensFromBalances({ data: [{ tick: 'F', amount: '0.5', decimals: 8 }] });
        expect(row.quantity).toBe('50000000');
    });

    it('passes an already-atomic quantity/divisibility row through untouched', () => {
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
