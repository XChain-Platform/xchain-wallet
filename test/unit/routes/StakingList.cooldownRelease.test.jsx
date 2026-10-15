// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Issue #35: buildRows() was flagging a contract stake row COOLDOWN whenever
// ANY matching unstake existed, never checking the unstake's own status. The
// indexer's block-end sweep marks a released unstake `completed`, but the
// matching /contract_stakes/ row keeps its original `status: 'valid'` and
// `amount` forever (the explorer never rewrites it), so a fully released
// position stayed pinned at "cooldown" showing the whole amount as staked
// with no way to ever clear. These pin that a completed unstake is read as
// what it is: a release that already happened.

import { describe, expect, it } from 'vitest';
import { buildRows } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import {
    cooldownStatus,
    cooldownText,
    stakingLockStatus,
    stakingLockText,
    stakingRowState,
} from '../../../packages/core/src/flows/stakingDashboard.js';

const OWNER = 'DTestOwnerAddressExampleExampleExample';
const LOCKED_STAKE = {
    action_index: 1,
    amount: '25',
    status: 'valid',
    activation_block: 106,
    signing_pubkey: 'a'.repeat(64),
    _ownerAddress: OWNER,
};

describe('buildRows: contract-stake cooldown vs. completed release', () => {
    it('counts locked blocks and estimates the activation time', () => {
        const status = stakingLockStatus({
            stake: { activation_block: 1_120 },
            height: 1_000,
            coin: 'bitcoin',
        });

        expect(status).toMatchObject({
            state: 'locked',
            blocksRemaining: 120,
            endBlock: 1_120,
        });
        expect(status.maturityEstimate).toBeInstanceOf(Date);
        expect(stakingLockText(status)).toMatch(/^Locked: 120 blocks to go \(~/);
    });

    it('uses singular block copy and omits a time when the chain is unknown', () => {
        const status = stakingLockStatus({
            stake: { ACTIVATION_BLOCK: 1_001 },
            height: 1_000,
            coin: 'unknown',
        });
        expect(stakingLockText(status)).toBe('Locked: 1 block to go');
    });

    it('counts unbonding blocks and estimates the release time', () => {
        const status = cooldownStatus({
            unstake: { cooldown_end_block: 1_250 },
            height: 1_000,
            coin: 'bitcoin',
        });

        expect(status).toMatchObject({
            state: 'releasing',
            blocksRemaining: 250,
            endBlock: 1_250,
        });
        expect(status.maturityEstimate).toBeInstanceOf(Date);
        expect(cooldownText(status)).toMatch(/^Releasing: 250 blocks to go \(~/);
    });

    it('keeps a pending stake visible with its chain-stamped unlock height', () => {
        const rows = buildRows({
            chainId: 'bitcoin-mainnet',
            height: 100,
            stakes: [LOCKED_STAKE],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            status: 'locked',
            lockEndBlock: 106,
            amountLabel: '25 XCHAIN',
        });
    });

    it('renders an unexpected stake state as plain status text', () => {
        const rows = buildRows({
            chainId: 'bitcoin-mainnet',
            height: 100,
            stakes: [{
                action_index: 1,
                amount: '25',
                status: 'paused-by-governance',
                _ownerAddress: OWNER,
            }],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('paused-by-governance');
        expect(stakingRowState(rows[0], 100)).toBe('unexpected');
    });

    it('adds reward fixture amounts exactly beyond floating-point precision', () => {
        const rows = buildRows({
            chainId: 'bitcoin-mainnet',
            height: 100,
            stakes: [{ ...LOCKED_STAKE, activation_block: 90 }],
            delegations: [],
            rewards: [
                { amount: '90071992.00000001' },
                { amount: '0.00000002' },
            ],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [],
        });

        expect(rows[0].rewardLabel).toBe('+90,071,992.00000003 XCHAIN reward');
    });

    it('omits validator stake rows outside their activation window', () => {
        const rows = buildRows({
            chainId: 'bitcoin-mainnet',
            height: 100,
            stakes: [
                { action_index: 1, amount: '100', status: 'valid', activation_block: 1, deactivation_block: 90 },
                { action_index: 2, amount: '5', status: 'valid', activation_block: 95, deactivation_block: null },
            ],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].key).toContain(':2');
        expect(rows[0].amountLabel).toBe('5 XCHAIN');
    });

    it('omits deactivated contract stakes and completed or invalid cooldown history', () => {
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            height: 100,
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-old',
                amount: '9',
                status: 'valid',
                activation_block: 1,
                deactivation_block: 90,
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [
                { target_contract_index: '1790', status: 'completed', amount: '9', tick: 'SWAPTEST' },
                { target_contract_index: '1790', status: 'invalid: amount', amount: '9', tick: 'SWAPTEST' },
            ],
        });

        expect(rows).toEqual([]);
    });

    it('keeps a current residual row despite completed history for its contract', () => {
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            height: 100,
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-residual',
                amount: '3',
                status: 'valid',
                activation_block: 90,
                deactivation_block: null,
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [{
                target_contract_index: '1790',
                status: 'completed',
                amount: '7',
                tick: 'SWAPTEST',
            }],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].amountLabel).toBe('3 SWAPTEST');
    });

    it('drops the stake row once a completed unstake fully covers the staked amount', () => {
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-1',
                amount: '9',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '9',
                cooldown_end_block: '67907832',
                status: 'completed',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(0);
    });

    it('keeps the row with the stake amount when a completed unstake only partly covers it', () => {
        // The stake row's own `amount` never shrinks as partial unstakes
        // complete (the explorer keeps serving the original figure), so
        // "the remaining stake" is exactly what the row already shows -
        // buildRows only ever drops a row on FULL coverage.
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-1',
                amount: '10',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '4',
                cooldown_end_block: '67907832',
                status: 'completed',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('active');
        expect(rows[0].amountLabel).toBe('10 SWAPTEST');
    });

    it('keeps cooldown status while a matching unstake is still releasing', () => {
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-1',
                amount: '9',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '9',
                cooldown_end_block: '67907832',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('cooldown');
        expect(rows[0].cooldownEndBlock).toBe(67907832);
    });

    it('fails closed and keeps the row when the stake amount cannot be parsed', () => {
        // An amount that doesn't parse as a plain decimal must never be
        // treated as "covered" - hiding a stake that still exists is far
        // worse than showing one that has ended.
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [{
                target_contract_index: '1790',
                action_index: 'stake-1',
                amount: 'not-a-number',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '9',
                cooldown_end_block: '67907832',
                status: 'completed',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('active');
    });

    it('does not render an orphan unstake row once it has been released', () => {
        // No matching stake row (already the fully-releasing-position case
        // buildRows already supported) - but the unstake itself is done, so
        // there is nothing left to show at all.
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '9',
                cooldown_end_block: '67907832',
                status: 'completed',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(0);
    });

    it('still renders an orphan unstake row while it is releasing', () => {
        const rows = buildRows({
            chainId: 'dogecoin-mainnet',
            stakes: [],
            delegations: [],
            rewards: [],
            rewardClaims: [],
            contractStakes: [],
            contractUnstakes: [{
                target_contract_index: '1790',
                action_index: 'unstake-1',
                amount: '9',
                cooldown_end_block: '67907832',
                status: 'valid',
                tick: 'SWAPTEST',
                _ownerAddress: OWNER,
            }],
        });

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('cooldown');
    });
});
