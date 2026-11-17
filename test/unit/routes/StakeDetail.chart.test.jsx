// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qstakingchartstakingchartstakingchartx';

afterEach(cleanup);

function mount({ stakes, rewards, claims = [] }) {
    const messaging = {
        getStakesForAddress: vi.fn().mockResolvedValue(stakes),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue(rewards),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue(claims),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 1000 }),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakeDetail
                walletId="wallet-chart"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
    return { messaging, ...view };
}

describe('StakeDetail Hero 2 chart', () => {
    it('draws stepped principal and dashed pending rewards on the labelled token scale', async () => {
        const { container } = mount({
            stakes: [
                { action_index: 1, amount: '25000', asset: 'XCHAIN', status: 'valid', block_index: 100 },
                { action_index: 2, amount: '5000', asset: 'XCHAIN', status: 'valid', block_index: 500, deactivation_block: 900 },
            ],
            rewards: [{ id: 1, amount: '82.4', block_index: 600 }],
            claims: [{ action_index: 3, amount: '20', status: 'valid', block_index: 700 }],
        });

        const chart = await screen.findByRole('img', { name: /^Staked\./ });
        expect(chart).toHaveAccessibleName(/Staked \+ rewards\./);
        expect(screen.getAllByText('Validator Stake')).toHaveLength(1);
        const heroTitle = screen.getByText('Staked + rewards');
        const hero = heroTitle.closest('section');
        expect(hero).toHaveAccessibleName('Staked + rewards');
        expect([...hero.querySelectorAll('[data-stake-hero-line]')].map((line) => line.dataset.stakeHeroLine))
            .toEqual(['title', 'change', 'total']);
        expect(within(hero).queryByText('Staked', { selector: 'span' })).toBeNull();
        expect(within(hero).queryByText('Validator Stake')).toBeNull();

        const primary = chart.querySelector('[data-chart-series="primary"]');
        const secondary = chart.querySelector('[data-chart-series="secondary"]');
        const primaryPoints = primary.getAttribute('points').split(' ');
        expect(primaryPoints.some((point, index) => {
            if (index === 0) return false;
            const [x, y] = point.split(',');
            const [previousX, previousY] = primaryPoints[index - 1].split(',');
            return x === previousX && y !== previousY;
        })).toBe(true);
        expect(primary).toHaveAttribute('stroke-width', '2');
        expect(secondary).toHaveAttribute('stroke-width', '1.25');
        expect(secondary).toHaveAttribute('stroke-dasharray', '4 3');

        expect(container.querySelectorAll('[data-chart-guide]')).toHaveLength(9);
        const scale = [...container.querySelectorAll('[data-chart-scale]')];
        expect(scale).toHaveLength(5);
        expect(scale.every((label) => label.textContent.endsWith(' XCHAIN'))).toBe(true);
        expect(scale[0]).toHaveTextContent('30,082.4 XCHAIN');
        expect(scale.at(-1)).toHaveTextContent('0 XCHAIN');

        const rangeRegion = screen.getByLabelText('Staked balance chart');
        expect(within(rangeRegion).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All']);
        fireEvent.click(within(rangeRegion).getByRole('tab', { name: '24h' }));
        expect(within(rangeRegion).getByRole('tab', { name: '24h' })).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps each history source to one bulk read as event counts grow', async () => {
        const stakes = Array.from({ length: 200 }, (_, index) => ({
            action_index: index + 1,
            amount: '125',
            asset: 'XCHAIN',
            status: 'valid',
            block_index: 100 + index * 2,
        }));
        const rewards = Array.from({ length: 200 }, (_, index) => ({
            id: index + 1,
            amount: '0.5',
            block_index: 101 + index * 2,
        }));
        const { messaging } = mount({ stakes, rewards });

        await screen.findByRole('img', { name: /^Staked\./ });
        await waitFor(() => {
            expect(messaging.getStakesForAddress).toHaveBeenCalledTimes(1);
            expect(messaging.getRewardsForAddress).toHaveBeenCalledTimes(1);
            expect(messaging.getRewardClaimsForAddress).toHaveBeenCalledTimes(1);
            expect(messaging.getDelegationsForAddress).toHaveBeenCalledTimes(1);
        });
    });

    it('keeps the fixed hero title when reward rows have no historical block', async () => {
        const { container } = mount({
            stakes: [{ action_index: 1, amount: '25000', asset: 'XCHAIN', status: 'valid', block_index: 500 }],
            rewards: [{ id: 1, amount: '82.4' }],
        });

        await screen.findByRole('img', { name: /^Staked\./ });
        expect(screen.getByText('Staked + rewards')).toBeInTheDocument();
        expect(screen.queryByText('+82.4 XCHAIN unclaimed')).toBeNull();
        expect(container.querySelector('[data-chart-series="secondary"]')).toBeNull();
    });
});
