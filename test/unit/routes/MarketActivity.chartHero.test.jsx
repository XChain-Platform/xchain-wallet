// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import homeTabsStyles from '../../../packages/core/src/shared/components/HomeTabs.module.css';
import portfolioChartStyles from '../../../packages/core/src/shared/components/PortfolioChart.module.css';
import heroStyles from '../../../packages/core/src/shared/components/TotalBalanceHero.module.css';

const NOW = 1_785_186_698;

function priceRows(tick) {
    const quote = tick === 'BTC' ? 'XCP' : 'BTC';
    return [
        { action_index: `${tick}-1`, status: 'valid', give_tick: tick, give_amount: '2', get_tick: quote, get_amount: '4', timestamp: NOW - 3 * 86400 },
        { action_index: `${tick}-2`, status: 'valid', give_tick: tick, give_amount: '2', get_tick: quote, get_amount: '10', timestamp: NOW - 2 * 86400 },
        { action_index: `${tick}-3`, status: 'valid', give_tick: tick, give_amount: '2', get_tick: quote, get_amount: '6', timestamp: NOW - 86400 },
    ];
}

function messagingStub() {
    const balances = {
        'bitcoin-mainnet': [{
            address: 'bc1qmarketplace',
            balances: {
                native: { tick: 'BTC', displayName: 'Bitcoin', quantity: '25', divisibility: 0 },
                tokens: [{ tick: 'XCHAIN', displayName: 'XChain', quantity: '25', divisibility: 0 }],
            },
        }],
    };
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', language: 'en-US' }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qmarketplace' }],
        }),
        getWalletBalances: vi.fn().mockResolvedValue(balances),
        searchTokens: vi.fn().mockResolvedValue([]),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispenses: vi.fn().mockImplementation(({ chainId, query }) => Promise.resolve({
            data: chainId === 'bitcoin-mainnet' ? priceRows(query) : [],
        })),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
    };
}

function mount(width) {
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width,
        height: 800,
        top: 0,
        right: width,
        bottom: 800,
        left: 0,
        x: 0,
        y: 0,
        toJSON() {},
    });
    render(
        <MessagingProvider shell="web" messaging={messagingStub()}>
            <MarketActivity walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function expectSharedChartHero(market, quote) {
    const chart = await screen.findByRole('region', { name: `${market} price chart` });
    const stack = chart.parentElement;
    const summary = stack.querySelector(`section[aria-label="${market} market"]`);
    const plot = await waitFor(() => {
        const rendered = chart.querySelector('svg[role="img"]');
        expect(rendered).not.toBeNull();
        return rendered;
    });
    const line = plot.querySelector('[data-chart-series="primary"]');
    const guides = [...plot.querySelectorAll('[data-chart-guide]')];
    const labels = [...chart.querySelectorAll('[data-chart-scale]')];

    expect(stack).toHaveClass(homeTabsStyles.heroStack, homeTabsStyles.heroStackWithChart);
    expect(summary).toHaveClass(heroStyles.hero);
    expect(chart).toHaveClass(portfolioChartStyles.wrap, portfolioChartStyles.behind);
    expect(chart.className).not.toContain('undefined');

    expect(line).toHaveAttribute('points', '0.00,96.00 50.00,4.00 100.00,65.33');
    expect(line).toHaveAttribute('data-chart-tone', 'up');
    expect(line).toHaveAttribute('stroke', 'var(--xc-hero-chart-up)');
    expect(guides).toHaveLength(9);
    expect(guides.map((guide) => guide.getAttribute('data-chart-guide-kind')))
        .toEqual(['labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled']);
    expect(guides.map((guide) => guide.getAttribute('y1')))
        .toEqual(['4', '15.5', '27', '38.5', '50', '61.5', '73', '84.5', '96']);
    expect(labels).toHaveLength(5);
    expect(labels.map((label) => label.textContent)).toEqual([
        `5 ${quote}`,
        `4.25 ${quote}`,
        `3.5 ${quote}`,
        `2.75 ${quote}`,
        `2 ${quote}`,
    ]);
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Marketplace Home-style chart hero', () => {
    it('uses the full shared scale and nine-line grid at narrow widths', async () => {
        mount(600);
        await expectSharedChartHero('XCHAIN', 'BTC');
        expect(document.querySelector('[data-list-detail="marketplace"]')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: '24h' }));
        await waitFor(() => {
            const line = document.querySelector('[aria-label="XCHAIN price chart"] [data-chart-series="primary"]');
            expect(line).toHaveAttribute('points', '0.00,4.00 100.00,96.00');
            expect(line).toHaveAttribute('data-chart-tone', 'down');
            expect(line).toHaveAttribute('stroke', 'var(--xc-hero-chart-down)');
        });
        const move = document.querySelector('[aria-label^="24h change:"]');
        expect(move).toHaveAttribute('aria-label', '24h change: Decrease: -40.00%');
        expect(move).toHaveClass(heroStyles.changeNegative);
    });

    it('keeps the same shared scale and nine-line grid in the wide detail panel', async () => {
        mount(900);
        await waitFor(() => expect(document.querySelector('[data-list-detail="marketplace"]')).not.toBeNull());
        await expectSharedChartHero('BTC', 'XCP');
    });
});
