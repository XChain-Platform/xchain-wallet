// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-47: claimable rewards and cooldown maturity.
//
// Two properties carry the weight. First, only VALID claims subtract from the
// accrued total - a COLLECT the chain refused (an under-funded reward pool
// being the case that matters) leaves a row behind but moved nothing, and
// counting it would tell a validator their rewards were paid when they were
// not. Second, a cooldown_end_block of 0 is the indexer's marker for "no
// maturity recorded" on an invalid unstake, not a block that passed long ago.

import { describe, it, expect } from 'vitest';
import {
    unclaimedRewards,
    cooldownStatus,
    cooldownText,
    toBaseUnits,
    fromBaseUnits,
} from '../../../packages/core/src/flows/stakingDashboard.js';

describe('base-unit conversion', () => {
    it('round-trips exact decimals at 8dp', () => {
        for (const v of ['0', '1', '0.00000001', '123.45678901', '999999999.99999999']) {
            expect(fromBaseUnits(toBaseUnits(v))).toBe(v);
        }
    });

    it('rejects anything that is not a plain decimal rather than counting it as zero', () => {
        for (const v of [null, undefined, '', 'abc', '1e-8', '1,000', {}]) {
            expect(toBaseUnits(v)).toBeNull();
        }
    });

    it('stays exact past the float-safe range', () => {
        // 90 million XCHAIN in base units exceeds 2^53.
        const big = '90000000.00000001';
        expect(fromBaseUnits(toBaseUnits(big))).toBe(big);
    });
});

describe('unclaimedRewards', () => {
    it('subtracts only claims the chain marked valid', () => {
        const totals = unclaimedRewards({
            rewards: [{ amount: '10' }, { amount: '5.5' }],
            claims: [
                { amount: '4', status: 'valid' },
                { amount: '11.5', status: 'invalid: insufficient reward pool' },
            ],
        });
        expect(totals.accrued).toBe('15.5');
        expect(totals.claimed).toBe('4');
        // The refused claim must NOT reduce what is still claimable.
        expect(totals.unclaimed).toBe('11.5');
        expect(totals.hasRejectedClaim).toBe(true);
    });

    it('reports nothing rejected when every claim succeeded', () => {
        const totals = unclaimedRewards({
            rewards: [{ amount: '10' }],
            claims: [{ amount: '10', status: 'valid' }],
        });
        expect(totals.unclaimed).toBe('0');
        expect(totals.hasRejectedClaim).toBe(false);
    });

    it('handles no rewards and no claims', () => {
        expect(unclaimedRewards()).toEqual({
            accrued: '0', claimed: '0', unclaimed: '0', hasRejectedClaim: false,
        });
        expect(unclaimedRewards({ rewards: [], claims: [] }).unclaimed).toBe('0');
    });

    it('sums many small rewards exactly, where floats would drift', () => {
        const rewards = Array.from({ length: 10 }, () => ({ amount: '0.1' }));
        expect(unclaimedRewards({ rewards }).accrued).toBe('1');
    });

    it('floors at zero rather than showing a negative claimable', () => {
        // Only reachable from inconsistent reads mid-reorg.
        const totals = unclaimedRewards({
            rewards: [{ amount: '1' }],
            claims: [{ amount: '5', status: 'valid' }],
        });
        expect(totals.unclaimed).toBe('0');
    });

    it('skips malformed reward rows instead of poisoning the total', () => {
        const totals = unclaimedRewards({
            rewards: [{ amount: '10' }, { amount: 'n/a' }, {}],
            claims: [],
        });
        expect(totals.accrued).toBe('10');
    });
});

describe('cooldownStatus', () => {
    it('counts down from the end block the CHAIN stamped', () => {
        const s = cooldownStatus({
            unstake: { cooldown_end_block: 1100 }, height: 1000, coin: 'bitcoin',
        });
        expect(s.state).toBe('releasing');
        expect(s.blocksRemaining).toBe(100);
        expect(s.endBlock).toBe(1100);
        expect(s.maturityEstimate).toBeInstanceOf(Date);
    });

    it('reports matured once the tip reaches the end block', () => {
        expect(cooldownStatus({ unstake: { cooldown_end_block: 1000 }, height: 1000 }).state).toBe('matured');
        expect(cooldownStatus({ unstake: { cooldown_end_block: 900 }, height: 1000 }).state).toBe('matured');
    });

    it('treats a zero end block as unknown, not as long matured', () => {
        // The indexer leaves 0 on INVALID unstake rows rather than persisting a
        // phantom maturity; 0 < any height would otherwise read as "ready".
        const s = cooldownStatus({ unstake: { cooldown_end_block: 0 }, height: 1000 });
        expect(s.state).toBe('unknown');
        expect(s.blocksRemaining).toBeNull();
    });

    it('is unknown when the chain height is unavailable', () => {
        for (const height of [null, undefined, '', NaN]) {
            expect(cooldownStatus({ unstake: { cooldown_end_block: 1100 }, height }).state).toBe('unknown');
        }
    });

    it('is unknown for a missing or malformed end block', () => {
        expect(cooldownStatus({ unstake: {}, height: 1000 }).state).toBe('unknown');
        expect(cooldownStatus({ unstake: { cooldown_end_block: 'soon' }, height: 1000 }).state).toBe('unknown');
        expect(cooldownStatus({ height: 1000 }).state).toBe('unknown');
    });
});

describe('cooldownText', () => {
    it('says ready once matured', () => {
        expect(cooldownText({ state: 'matured' })).toBe('Ready to withdraw');
    });

    it('counts blocks, with an approximate date when one can be estimated', () => {
        const withDate = cooldownText(cooldownStatus({
            unstake: { cooldown_end_block: 1010 }, height: 1000, coin: 'bitcoin',
        }));
        expect(withDate).toMatch(/^Releasing: 10 blocks to go \(~/);
        const noDate = cooldownText(cooldownStatus({
            unstake: { cooldown_end_block: 1010 }, height: 1000, coin: 'ethereum',
        }));
        expect(noDate).toBe('Releasing: 10 blocks to go');
    });

    it('says nothing for an unknown cooldown, so the caller keeps its own text', () => {
        expect(cooldownText({ state: 'unknown' })).toBeNull();
        expect(cooldownText(null)).toBeNull();
    });

    it('uses the singular for one block', () => {
        expect(cooldownText(cooldownStatus({
            unstake: { cooldown_end_block: 1001 }, height: 1000, coin: 'ethereum',
        }))).toBe('Releasing: 1 block to go');
    });
});
