// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

afterEach(cleanup);

describe('StakeDetail amounts on a right-to-left page', () => {
    it('keeps each amount and its unit in one left-to-right run', async () => {
        const messaging = {
            getStakesForAddress: vi.fn().mockResolvedValue([{ action_index: 1, amount: '50000', asset: 'XCHAIN', status: 'active' }]),
            getDelegationsForAddress: vi.fn().mockResolvedValue([]),
            getRewardsForAddress: vi.fn().mockResolvedValue([{ id: 1, amount: '80.25' }]),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <StakeDetail walletId="w" kind="validator" chainId="bitcoin-mainnet" address="bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const staked = await screen.findByText('50,000 XCHAIN');
        expect(staked.tagName).toBe('BDI');
        expect(staked).toHaveAttribute('dir', 'ltr');
        for (const label of ['Pending rewards', 'Lifetime rewards']) {
            const run = screen.getByText(label).nextElementSibling.firstElementChild;
            expect(run.tagName).toBe('BDI');
            expect(run).toHaveAttribute('dir', 'ltr');
            expect(run).toHaveTextContent('80.25 XCHAIN');
        }
    });
});
