// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qstakerstakerstakerstakerstakerxxx';

afterEach(cleanup);

function mount(overrides = {}) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue([
            { action_index: 1, amount: '25', asset: 'XCHAIN', status: 'active' },
        ]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([{ id: 2, amount: '30', reward_type: 'price' }]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([
            { action_index: 5, amount: '30', status: 'valid' },
        ]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeDetail
                walletId="wallet-1"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS}
                onClaimRewards={vi.fn()}
                onUnstake={vi.fn()}
                onDelegate={vi.fn()}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
    return messaging;
}

// The amount line of one bubble (label, amount, fiat).
function bubbleAmount(label) {
    const bubbles = screen.getByRole('group', { name: 'Rewards summary' });
    return within(bubbles).getByText(label).nextElementSibling;
}

describe('StakeDetail when the claim ledger cannot be read', () => {
    it('shows the claimable figure as unknown and locks Claim with its reason', async () => {
        mount({ getRewardClaimsForAddress: vi.fn().mockRejectedValue(new Error('explorer down')) });

        expect(await screen.findByRole('alert')).toHaveTextContent(/claimed rewards/i);
        expect(screen.getByRole('button', { name: /^Claim\b/ })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /^Claim\b/ })).toHaveAccessibleDescription('Claimed rewards could not be loaded.');
        expect(bubbleAmount('Claimable')).toHaveTextContent('-');
        expect(bubbleAmount('Earned')).toHaveTextContent('30');
    });

    it('treats a client without the claims read as unknown too', async () => {
        mount({ getRewardClaimsForAddress: undefined });

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Claim\b/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows no notice and the real figure when the ledger loads', async () => {
        mount({ getRewardClaimsForAddress: vi.fn().mockResolvedValue([]) });

        expect(await screen.findByRole('heading', { name: 'Validator Stake' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: /^Claim\b/ })).not.toHaveAttribute('aria-disabled');
        expect(bubbleAmount('Claimable')).toHaveTextContent('30');
    });
});
