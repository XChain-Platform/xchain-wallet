// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

afterEach(cleanup);

async function mount(rewards, claims = []) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue([{ action_index: 1, amount: '25', status: 'active' }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue(rewards),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue(claims),
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Rewards' }));
    return screen.getByRole('list', { name: 'Reward events' });
}

describe('StakeDetail reward history', () => {
    it('lists earned and claimed rows together, newest first, with no title or summary', async () => {
        const list = await mount(
            [
                { id: 1, amount: '3', reward_type: 'price', block_index: 80 },
                { id: 2, amount: '4', reward_type: 'price', block_index: 95 },
            ],
            [
                { action_index: 7, amount: '3', status: 'valid', block_index: 90 },
                // A claim the chain refused moved nothing, so it is not listed.
                { action_index: 8, amount: '9', status: 'invalid: pool short', block_index: 99 },
            ],
        );

        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((row) => row.textContent.match(/^(Earned|Claimed)/)?.[0])).toEqual(['Earned', 'Claimed', 'Earned']);
        expect(within(rows[0]).getByText('+4 XCHAIN')).toBeInTheDocument();
        expect(within(rows[1]).getByText('3 XCHAIN')).toBeInTheDocument();
        // Line 2 is the block's date, marked as projected from the chain's block rate.
        expect(rows[0].textContent).toMatch(/~\w{3} \d{1,2}, \d{4}/);
        expect(within(list).queryByText(/9 XCHAIN/)).toBeNull();
        expect(screen.queryByRole('heading', { name: /reward/i })).toBeNull();
    });

    it('says when it shows only the latest 25 of a 5,000-row history', async () => {
        const rewards = Array.from({ length: 5000 }, (_, i) => ({ id: 5000 - i, amount: '1', reward_type: 'price', block_index: 5000 - i }));
        const started = performance.now();
        const list = await mount(rewards);

        expect(within(list).getAllByRole('listitem')).toHaveLength(25);
        expect(screen.getByText('Showing the latest 25 of 5,000 reward events.')).toBeInTheDocument();
        const bubbles = screen.getByRole('group', { name: 'Rewards summary' });
        expect(within(bubbles).getByText('Earned').nextElementSibling).toHaveTextContent('5,000');
        expect(performance.now() - started).toBeLessThan(3000);
    });

    it('shows no truncation note for a short history', async () => {
        await mount([{ id: 1, amount: '1', reward_type: 'price' }]);

        expect(screen.queryByText(/Showing the latest/)).toBeNull();
    });
});
