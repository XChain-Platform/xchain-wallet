// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

afterEach(cleanup);

describe('StakeDetail with a stake still before its activation block', () => {
    it('reports the locked amount instead of nothing staked, and keeps Unstake disabled', async () => {
        const messaging = {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { action_index: 1, amount: '40', asset: 'XCHAIN', status: 'valid', activation_block: 500 },
            ]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakeDetail
                    walletId="wallet-1"
                    kind="validator"
                    chainId="bitcoin-mainnet"
                    address="bc1qstakerstakerstakerstakerstakerxxx"
                    onUnstake={vi.fn()}
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('40 XCHAIN')).toBeInTheDocument();
        expect(screen.queryByText('Nothing staked from this address')).toBeNull();
        expect(screen.getByText('locked')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unstake' })).toBeDisabled();
    });
});
