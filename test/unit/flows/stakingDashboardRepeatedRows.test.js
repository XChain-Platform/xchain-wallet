// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { unclaimedRewards } from '../../../packages/core/src/flows/stakingDashboard.js';

describe('unclaimedRewards with repeated explorer rows', () => {
    it('counts a reward id and a claim action once however often the explorer repeats it', () => {
        const totals = unclaimedRewards({
            rewards: [{ id: 7, amount: '10' }, { id: 7, amount: '10' }, { id: 8, amount: '5' }],
            claims: [
                { action_index: 3, amount: '4', status: 'valid' },
                { action_index: 3, amount: '4', status: 'valid' },
            ],
        });

        expect(totals.accrued).toBe('15');
        expect(totals.claimed).toBe('4');
        expect(totals.unclaimed).toBe('11');
    });
});
