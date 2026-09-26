// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { buildRows } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { splitRewards } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';

const rewards = [{ action_index: 'reward-1', amount: '10' }];
const rewardClaims = [
    { action_index: 'claim-1', amount: '4', status: 'valid' },
    { action_index: 'claim-2', amount: '2', status: 'invalid: insufficient reward pool' },
];

describe('validator reward displays', () => {
    it('shows accrued minus valid claims on the staking-list badge', () => {
        const rows = buildRows({
            chainId: 'bitcoin-regtest',
            stakes: [{
                stake_id: 'stake-1',
                amount: '100',
                status: 'active',
                _ownerAddress: 'mvCounterexample',
            }],
            delegations: [],
            rewards,
            rewardClaims,
            contractStakes: [],
            contractUnstakes: [],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].rewardLabel).toBe('+6 XCHAIN reward');
    });

    it('splits the operator totals from accruals and valid claims', () => {
        expect(splitRewards(rewards, rewardClaims)).toEqual({
            pending: '6',
            lifetime: '10',
        });
    });
});
