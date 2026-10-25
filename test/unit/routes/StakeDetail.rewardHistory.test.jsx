// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

afterEach(cleanup);

function mount(rewards) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue([{ action_index: 1, amount: '25', status: 'active' }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue(rewards),
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
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
}

describe('StakeDetail reward history', () => {
    it('labels each event by its reward type, which is the field the explorer sends', async () => {
        mount([{ id: 9, amount: '3', reward_type: 'price', block_index: 90 }]);

        const list = await screen.findByRole('list', { name: 'Reward events' });
        expect(within(list).getByText('price')).toBeInTheDocument();
        expect(within(list).queryByText('-', { selector: 'span' })).toBeNull();
    });

    it('says when it shows only the latest 25 of a 5,000-row history', async () => {
        const rewards = Array.from({ length: 5000 }, (_, i) => ({ id: 5000 - i, amount: '1', reward_type: 'price', block_index: 5000 - i }));
        const started = performance.now();
        mount(rewards);

        const list = await screen.findByRole('list', { name: 'Reward events' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(25);
        expect(screen.getByText('Showing the latest 25 of 5,000 reward events.')).toBeInTheDocument();
        expect(screen.getByText('Lifetime rewards').nextElementSibling).toHaveTextContent('5,000 XCHAIN');
        expect(performance.now() - started).toBeLessThan(3000);
    });

    it('shows no truncation note for a short history', async () => {
        mount([{ id: 1, amount: '1', reward_type: 'price' }]);

        await screen.findByRole('list', { name: 'Reward events' });
        expect(screen.queryByText(/Showing the latest/)).toBeNull();
    });
});
