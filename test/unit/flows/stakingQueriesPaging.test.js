// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    validatorsForChain,
    rewardClaimsForAddress,
    rewardsForAddress,
    stakesForAddress,
} from '../../../packages/core/src/flows/stakingQueries.js';
import { unclaimedRewards } from '../../../packages/core/src/flows/stakingDashboard.js';

// An explorer that serves `rows` newest first, 100 to a page, with `total`.
function explorerOf(rows) {
    return vi.fn(async (_address, _type, opts = {}) => {
        const page = opts.page ?? 1;
        return { total: rows.length, data: rows.slice((page - 1) * 100, page * 100) };
    });
}

const registryFor = (sdk) => ({ get: () => sdk });

describe('address-scoped staking reads', () => {
    it('reads every page of a 5,000-row reward ledger so the claimable sum covers it all', async () => {
        const rewards = Array.from({ length: 5000 }, (_, i) => ({ id: 5000 - i, amount: '1' }));
        const claims = [{ action_index: 9, amount: '4990', status: 'valid' }];
        const sdk = { getValidatorRewards: explorerOf(rewards), getCollects: explorerOf(claims) };
        const sdkRegistry = registryFor(sdk);

        const r = await rewardsForAddress({ sdkRegistry, chainId: 'c', address: 'a' });
        const c = await rewardClaimsForAddress({ sdkRegistry, chainId: 'c', address: 'a' });

        expect(r.data).toHaveLength(5000);
        expect(sdk.getValidatorRewards).toHaveBeenCalledTimes(50);
        const totals = unclaimedRewards({ rewards: r.data, claims: c.data });
        expect(totals.accrued).toBe('5000');
        expect(totals.unclaimed).toBe('10');
    });

    it('reads all five pages of a 500-validator roster so the operator row is found', async () => {
        const roster = Array.from({ length: 500 }, (_, i) => ({ signing_pubkey: String(i).padStart(64, '0') }));
        const sdk = { getValidators: vi.fn(async (opts = {}) => {
            const page = opts.page ?? 1;
            return { total: roster.length, data: roster.slice((page - 1) * 100, page * 100) };
        }) };

        const out = await validatorsForChain({ sdkRegistry: registryFor(sdk), chainId: 'c' });

        expect(out.data).toHaveLength(500);
        expect(out.data.at(-1)).toEqual(roster[499]);
    });

    it('keeps the first response when one page holds everything', async () => {
        const sdk = { getStakes: explorerOf([{ action_index: 1 }]) };

        const out = await stakesForAddress({ sdkRegistry: registryFor(sdk), chainId: 'c', address: 'a' });

        expect(out.data).toEqual([{ action_index: 1 }]);
        expect(sdk.getStakes).toHaveBeenCalledTimes(1);
    });

    it('refuses a ledger too large to total instead of summing a partial one', async () => {
        const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
        const sdk = { getValidatorRewards: vi.fn(async () => ({ total: 100 * 201, data: rows })) };

        await expect(rewardsForAddress({ sdkRegistry: registryFor(sdk), chainId: 'c', address: 'a' }))
            .rejects.toThrow(/more than the wallet can read/);
    });

    it('rejects when a later page is unreadable', async () => {
        const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
        const sdk = {
            getValidatorRewards: vi.fn(async (_a, _t, opts = {}) => (
                opts.page ? { total: 250 } : { total: 250, data: rows }
            )),
        };

        await expect(rewardsForAddress({ sdkRegistry: registryFor(sdk), chainId: 'c', address: 'a' }))
            .rejects.toThrow(/unreadable page/);
    });

    it('rejects a reward history that comes back shorter than its total', async () => {
        const rows = Array.from({ length: 230 }, (_, i) => ({ id: 250 - i, amount: '1' }));
        const pages = { 1: rows.slice(0, 100), 2: rows.slice(100, 200), 3: rows.slice(200, 230) };
        const sdk = {
            getValidatorRewards: vi.fn(async (_a, _t, opts = {}) => ({ total: 250, data: pages[opts.page ?? 1] })),
        };

        await expect(rewardsForAddress({ sdkRegistry: registryFor(sdk), chainId: 'c', address: 'a' }))
            .rejects.toThrow(/230 of 250 rows/);
        expect(sdk.getValidatorRewards).toHaveBeenCalledTimes(3);
    });

    it('rejects a short later page even when it repeats a row from an earlier page', async () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ id: 250 - i, amount: '1' }));
        const pages = {
            1: rows.slice(0, 100),
            2: [rows[99], ...rows.slice(100, 150)],
            3: rows.slice(150, 200),
        };
        const sdk = {
            getValidatorRewards: vi.fn(async (_a, _t, opts = {}) => ({ total: 250, data: pages[opts.page ?? 1] })),
        };

        await expect(rewardsForAddress({ sdkRegistry: registryFor(sdk), chainId: 'c', address: 'a' }))
            .rejects.toThrow(/201 of 250 rows/);
    });
});
