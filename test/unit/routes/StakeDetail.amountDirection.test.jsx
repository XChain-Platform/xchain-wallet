// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

afterEach(cleanup);

describe('StakeDetail amounts on a right-to-left page', () => {
    it('keeps each amount and its unit in one left-to-right run', async () => {
        const messaging = {
            getStakesForAddress: vi.fn().mockResolvedValue([{ action_index: 1, amount: '50000', asset: 'XCHAIN', status: 'active' }]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([{ id: 1, amount: '80.25', block_index: 90 }]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakeDetail walletId="w" kind="validator" chainId="bitcoin-mainnet" address="bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        // The hero amount and its unit are separate items of one ltr-isolated row.
        const hero = await screen.findByLabelText('50,000 XCHAIN staked');
        expect(within(hero).getByText('50,000')).toBeInTheDocument();
        expect(within(hero).getByText('XCHAIN staked')).toBeInTheDocument();

        const bubbles = screen.getByRole('group', { name: 'Rewards summary' });
        for (const run of within(bubbles).getAllByText('80.25')) {
            expect(run.tagName).toBe('BDI');
            expect(run).toHaveAttribute('dir', 'ltr');
        }

        fireEvent.click(screen.getByRole('tab', { name: 'Rewards' }));
        const earned = within(screen.getByRole('list', { name: 'Reward events' })).getByText('+80.25 XCHAIN');
        expect(earned.tagName).toBe('BDI');
        expect(earned).toHaveAttribute('dir', 'ltr');
    });
});
