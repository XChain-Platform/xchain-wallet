// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qstakerstakerstakerstakerstakerxxx';

afterEach(cleanup);

describe('StakeDetail rendering', () => {
    it('enables validator actions from the loaded position and rewards', async () => {
        const onClaimRewards = vi.fn();
        const onUnstake = vi.fn();
        const onDelegate = vi.fn();
        const messaging = {
            getStakesForAddress: vi.fn().mockResolvedValue([
                { action_index: 1, amount: '25', asset: 'XCHAIN', status: 'active' },
            ]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([
                { action_index: 2, amount: '3', status: 'valid' },
            ]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakeDetail
                    walletId="wallet-1"
                    kind="validator"
                    chainId={CHAIN}
                    address={ADDRESS}
                    onClaimRewards={onClaimRewards}
                    onUnstake={onUnstake}
                    onDelegate={onDelegate}
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'Validator stake' })).toBeInTheDocument();
        expect(screen.getByText('25 XCHAIN')).toBeInTheDocument();
        expect(screen.getAllByText('3 XCHAIN')).toHaveLength(3);

        for (const [name, handler] of [
            ['Claim', onClaimRewards],
            ['Unstake', onUnstake],
            ['Delegate', onDelegate],
        ]) {
            const button = screen.getByRole('button', { name });
            expect(button).toBeEnabled();
            fireEvent.click(button);
            expect(handler).toHaveBeenCalledOnce();
        }
    });
});
