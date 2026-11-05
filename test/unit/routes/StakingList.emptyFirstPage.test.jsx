// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// An explorer that answers a stakes read with a total of 5 and no rows on its
// first page: the staking page says the stakes cannot be read instead of
// showing an address with nothing staked.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import { stakesForAddress } from '../../../packages/core/src/flows/stakingQueries.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qemptyfirstpageemptyfirstpageempty00';

afterEach(cleanup);

describe('StakingList empty first page', () => {
    it('shows the read error when the stakes read answers 5 rows with none on the page', async () => {
        const sdk = { getStakes: vi.fn(async () => ({ total: 5, data: [] })) };
        const sdkRegistry = { get: () => sdk };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ADDRESS }] }),
            getStakesForAddress: vi.fn((req) => stakesForAddress({ ...req, sdkRegistry })),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getContractStakesForAddress: vi.fn().mockResolvedValue([]),
            getContractUnstakesForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakingList walletId="wallet-1" onOpenStake={vi.fn()} onBack={vi.fn()} onNewStake={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByText(/Couldn't load some staking data/)).toBeInTheDocument();
        expect(screen.getByText(/0 of 5 rows/)).toBeInTheDocument();
        expect(sdk.getStakes).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Nothing staked yet')).toBeNull();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
});
