// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

// The wallet's price source for XCHAIN; each test sets what it knows.
const price = vi.hoisted(() => ({ rate: null }));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useTickFiatRate: () => (price.rate == null ? null : {
            rate: price.rate, chainCoin: 'bitcoin', tick: 'XCHAIN', fiatCurrency: 'USD', source: 'oracle', fetchedAt: '', stale: false,
        }),
    };
});

const { StakeDetail } = await import('../../../packages/core/src/shared/routes/StakeDetail.jsx');

afterEach(() => {
    cleanup();
    price.rate = null;
});

function mount({ stakes, delegations = [], rewards = [{ id: 1, amount: '12.4', block_index: 95 }], props = {} } = {}) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue(stakes ?? [
            { action_index: 1, amount: '1250', asset: 'XCHAIN', status: 'active', block_index: 50 },
        ]),
        getDelegationsForAddress: vi.fn().mockResolvedValue(delegations),
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
                onStakeMore={vi.fn()}
                onUnstake={vi.fn()}
                onClaimRewards={vi.fn()}
                onDelegate={vi.fn()}
                onRevokeDelegation={vi.fn()}
                onOpenOperatorDashboard={vi.fn()}
                {...props}
            />
        </MessagingProvider>,
    );
}

// The Actions tab is the shared action list (G101). A locked row is
// aria-disabled (still focusable) and shows its reason in place of its
// description, wired to the row by aria-describedby.
async function actionRow(id) {
    const list = await screen.findByRole('list', { name: 'Stake actions' });
    const row = list.querySelector(`[data-action-id="${id}"]`);
    if (!row) throw new Error(`no "${id}" row in the Stake actions list`);
    return row;
}

const isLocked = (row) => row.getAttribute('aria-disabled') === 'true';
const reasonOf = (row) => document.getElementById(row.getAttribute('aria-describedby') || '')?.textContent ?? null;

describe('StakeDetail bubbles', () => {
    it('shows Claimable and Earned amounts without a ticker, with fiat from the price source', async () => {
        price.rate = 2.73;
        mount();

        const bubbles = await screen.findByRole('group', { name: 'Rewards summary' });
        expect(within(bubbles).getByText('Claimable')).toBeInTheDocument();
        expect(within(bubbles).getByText('Earned')).toBeInTheDocument();
        expect(bubbles.textContent).not.toMatch(/XCHAIN/);
        // 12.4 XCHAIN at $2.73.
        expect(within(bubbles).getAllByText('≈ $33.85')).toHaveLength(2);
        expect(screen.getByText('≈ $3,412.50')).toBeInTheDocument();
    });

    it('hides every fiat line when no price is known', async () => {
        mount();

        const bubbles = await screen.findByRole('group', { name: 'Rewards summary' });
        expect(within(bubbles).getAllByText('12.4')).toHaveLength(2);
        expect(document.body.textContent).not.toMatch(/≈|\$/);
    });
});

describe('StakeDetail locked tiles', () => {
    it('locks Add Stake and Unstake during the stake cooldown and says how long is left', async () => {
        mount({
            stakes: [{ action_index: 1, amount: '1250', asset: 'XCHAIN', status: 'valid', block_index: 50, deactivation_block: 106 }],
        });

        // Six bitcoin blocks at the 10 minute target.
        const cooldown = "Locked while the stake's cooldown runs, about 1 hour left.";
        await waitFor(async () => expect(reasonOf(await actionRow('add-stake'))).toBe(cooldown));
        for (const id of ['add-stake', 'unstake']) {
            const row = await actionRow(id);
            expect(isLocked(row)).toBe(true);
            expect(reasonOf(row)).toBe(cooldown);
        }
        expect(isLocked(await actionRow('claim'))).toBe(false);
        expect(isLocked(await actionRow('delegate'))).toBe(false);
    });

    it('locks Revoke with no delegated key and an unwired action with its own reason', async () => {
        mount({ props: { onStakeMore: undefined } });

        await waitFor(async () => expect(isLocked(await actionRow('revoke'))).toBe(true));
        expect(reasonOf(await actionRow('revoke'))).toBe('No delegated key to revoke.');
        expect(isLocked(await actionRow('add-stake'))).toBe(true);
        expect(reasonOf(await actionRow('add-stake'))).toBe('Not available in this wallet yet.');
        expect(screen.queryByText(/demo/i)).toBeNull();
    });

    it('locks Claim when nothing is claimable', async () => {
        mount({ rewards: [] });

        await waitFor(async () => expect(reasonOf(await actionRow('claim'))).toBe('No rewards to claim yet.'));
        expect(isLocked(await actionRow('claim'))).toBe(true);
    });
});
