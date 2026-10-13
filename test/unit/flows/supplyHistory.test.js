// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    foldSupplyHistory,
    reconcileSupply,
    supplyHistoryFor,
} from '../../../packages/core/src/flows/supplyHistory.js';

const issue = { action_index: 1, block_index: 10, mint_supply: '100' };
const mint = (a, block, idx) => ({ amount: a, block_index: block, action_index: idx });

function registry(sdk) {
    return { get: () => sdk };
}

describe('foldSupplyHistory', () => {
    it('orders events by block then action and accumulates', () => {
        const r = foldSupplyHistory({
            issues: [issue],
            mints: [mint('50', 12, 5), mint('25.5', 11, 3)],
            destroys: [{ amount: '10.25', block_index: 12, action_index: 6 }],
        });
        expect(r.points.map((p) => [p.kind, p.supply])).toEqual([
            ['issue', '100'],
            ['mint', '125.5'],
            ['mint', '175.5'],
            ['destroy', '165.25'],
        ]);
        expect(r.supply).toBe('165.25');
        expect(r.points[3].delta).toBe('-10.25');
    });

    it('counts only the earliest issue and is exact at 18 places', () => {
        const r = foldSupplyHistory({
            issues: [{ action_index: 9, block_index: 20, mint_supply: '999' }, issue],
            mints: [mint('0.000000000000000001', 11, 2), mint('0.000000000000000002', 11, 3)],
        });
        expect(r.supply).toBe('100.000000000000000003');
    });

    it('skips unparseable amounts and reports them', () => {
        const r = foldSupplyHistory({ mints: [mint('abc', 1, 1), mint('5', 2, 2)] });
        expect(r.supply).toBe('5');
        expect(r.skipped).toBe(1);
    });

    it('returns an empty series for no rows', () => {
        expect(foldSupplyHistory()).toEqual({ points: [], supply: '0', skipped: 0 });
    });
});

describe('reconcileSupply', () => {
    it('reports equal, differing and unknown current supply', () => {
        expect(reconcileSupply('10', '10.0')).toEqual({ current: '10', delta: '0', reconciled: true });
        expect(reconcileSupply('10', '12.5')).toEqual({ current: '12.5', delta: '2.5', reconciled: false });
        expect(reconcileSupply('10', null)).toEqual({ current: null, delta: null, reconciled: null });
    });
});

describe('supplyHistoryFor', () => {
    it('folds sdk rows and reconciles against token supply', async () => {
        const sdk = {
            getIssues: async () => ({ data: [issue] }),
            getMints: async () => [mint('50', 11, 2)],
            getDestroys: async () => [{ amount: '30', block_index: 12, action_index: 3 }],
            getToken: async () => ({ supply: { current: '120' } }),
        };
        const r = await supplyHistoryFor({ sdkRegistry: registry(sdk), chainId: 'c', tick: 'T' });
        expect(r.supply).toBe('120');
        expect(r.reconciled).toBe(true);
        expect(r.points).toHaveLength(3);
    });

    it('flags a mismatch and tolerates missing sdk methods', async () => {
        const sdk = { getMints: async () => [mint('5', 1, 1)], getToken: async () => [{ supply: { current: '7' } }] };
        const r = await supplyHistoryFor({ sdkRegistry: registry(sdk), chainId: 'c', tick: 'T' });
        expect(r.reconciled).toBe(false);
        expect(r.delta).toBe('2');
    });

    it('validates its inputs', async () => {
        await expect(supplyHistoryFor({ chainId: 'c', tick: 'T' })).rejects.toThrow(/sdkRegistry/);
        await expect(supplyHistoryFor({ sdkRegistry: registry({}), tick: 'T' })).rejects.toThrow(/chainId/);
        await expect(supplyHistoryFor({ sdkRegistry: registry({}), chainId: 'c' })).rejects.toThrow(/tick/);
    });
});
