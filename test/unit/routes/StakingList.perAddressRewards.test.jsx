// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList, buildRows } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const CHAIN = 'bitcoin-mainnet';
const IDLE = 'bc1qidleidleidleidleidleidleidleidleidle';
const PAID = 'bc1qpaidpaidpaidpaidpaidpaidpaidpaidpaid';

afterEach(cleanup);

describe('buildRows reward chip', () => {
    const stakes = [
        { stake_id: 's1', amount: '10', status: 'active', block_index: 9, _ownerAddress: IDLE },
        { stake_id: 's2', amount: '20', status: 'active', block_index: 8, _ownerAddress: PAID },
        { stake_id: 's3', amount: '30', status: 'active', block_index: 7, _ownerAddress: PAID },
    ];
    const rewards = [{ id: 1, amount: '5', _ownerAddress: PAID }];

    it('puts an address\'s pending rewards on one of its own rows only', () => {
        const rows = buildRows({
            chainId: CHAIN, stakes, delegations: [], rewards, rewardClaims: [],
            contractStakes: [], contractUnstakes: [],
        });

        expect(rows.map((row) => row.rewardLabel)).toEqual([null, '+5 XCHAIN reward', null]);
    });
});

describe('StakingList Claim button', () => {
    it('opens the address that owns the rewards, not the newest stake row', async () => {
        const onOpenStake = vi.fn();
        const read = (map) => vi.fn(async ({ address }) => map[address] || []);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'a1', address: IDLE }, { id: 'a2', address: PAID }],
            }),
            getStakesForAddress: read({
                [IDLE]: [{ stake_id: 's1', amount: '10', status: 'active', block_index: 9 }],
                [PAID]: [{ stake_id: 's2', amount: '20', status: 'active', block_index: 8 }],
            }),
            getDelegationsForAddress: read({}),
            getRewardsForAddress: read({ [PAID]: [{ id: 1, amount: '5' }] }),
            getRewardClaimsForAddress: read({}),
            getContractStakesForAddress: read({}),
            getContractUnstakesForAddress: read({}),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingList walletId="wallet-1" onOpenStake={onOpenStake} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const claim = await screen.findByRole('button', { name: 'Claim' });
        await waitFor(() => expect(screen.getAllByText('+5 XCHAIN reward')).toHaveLength(1));
        fireEvent.click(claim);

        expect(onOpenStake).toHaveBeenCalledWith({ kind: 'validator', chainId: CHAIN, address: PAID });
    });

    it('still offers Claim to an address that unstaked everything but is owed rewards', async () => {
        const onOpenStake = vi.fn();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a2', address: PAID }] }),
            getStakesForAddress: vi.fn().mockResolvedValue([]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([{ id: 1, amount: '5' }]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getContractStakesForAddress: vi.fn().mockResolvedValue([]),
            getContractUnstakesForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingList walletId="wallet-1" onOpenStake={onOpenStake} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));

        expect(onOpenStake).toHaveBeenCalledWith({ kind: 'validator', chainId: CHAIN, address: PAID });
    });
});
