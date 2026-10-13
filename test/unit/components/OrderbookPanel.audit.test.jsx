// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OrderbookPanel } from '../../../packages/core/src/shared/components/OrderbookPanel.jsx';
import { RecentTradesPanel } from '../../../packages/core/src/shared/components/RecentTradesPanel.jsx';
import { TradeHistoryPanel } from '../../../packages/core/src/shared/components/TradeHistoryPanel.jsx';

afterEach(() => cleanup());

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function renderBook(getOrderbook, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{ getOrderbook }}>
            <OrderbookPanel
                chainId="bitcoin-mainnet"
                tick1="XCHAIN"
                tick2="BTC"
                {...props}
            />
        </MessagingProvider>,
    );
}

describe('OrderbookPanel market display', () => {
    it('distinguishes loading from an empty order book', async () => {
        const request = deferred();
        renderBook(vi.fn(() => request.promise));

        expect(screen.getByRole('status')).toHaveTextContent('Loading order book…');
        expect(screen.queryByText('No open orders on this market.')).toBeNull();
        expect(screen.getByRole('region', { name: 'Order book' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => request.resolve({ bids: [], asks: [] }));

        expect(await screen.findByText('No open orders on this market.')).toBeInTheDocument();
        expect(screen.queryByText('Loading order book…')).toBeNull();
        expect(screen.getByRole('region', { name: 'Order book' })).not.toHaveAttribute('aria-busy');
    });

    it('formats and aligns exact values while retaining the exact picked price', async () => {
        const onPickPrice = vi.fn();
        renderBook(vi.fn().mockResolvedValue({
            bids: [['0.010000', '1000.0000'], ['0.009000', '500.0000']],
            asks: [['0.020000', '2000.0000']],
        }), { onPickPrice });

        const price = await screen.findByTitle('0.010000');
        expect(price).toHaveTextContent('0.01');
        expect(screen.getAllByText('1,000')).toHaveLength(2);
        expect(screen.getByText('1,500')).toBeInTheDocument();

        const columns = screen.getByText('Order book').nextElementSibling;
        expect(columns.className).toMatch(/orderBookGrid/);

        const bidScroller = screen.getByRole('region', { name: 'Bids order book levels' });
        expect(bidScroller.className).toMatch(/levelsScroller/);
        expect(bidScroller.firstElementChild.className).toMatch(/levelsTable/);

        const bids = screen.getByRole('table', { name: 'Bids' });
        const priceHeader = screen.getAllByRole('columnheader', { name: 'Price (BTC)' })[0];
        expect(priceHeader).toHaveAttribute('scope', 'col');
        expect(priceHeader.className).toContain('numeric');
        expect(bids.querySelectorAll('th[scope="col"]')).toHaveLength(3);

        const rowButton = screen.getByRole('button', { name: 'Pick price 0.010000' });
        const row = rowButton.closest('tr');
        expect(rowButton.closest('td')).toHaveAttribute('data-label', 'Price');
        expect(row.style.background).toContain('50%');

        fireEvent.click(rowButton);
        expect(onPickPrice).toHaveBeenCalledWith('0.010000');
    });

    it('shows a failed request as an error rather than an empty book', async () => {
        renderBook(vi.fn().mockRejectedValue(new Error('network unavailable')));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the order book.");
        expect(screen.queryByText('No open orders on this market.')).toBeNull();
        expect(screen.queryByText('Loading order book…')).toBeNull();
    });
});

describe('market data table semantics', () => {
    it('stacks labeled cells below 600px', () => {
        const css = readFileSync(
            'packages/core/src/shared/components/DataTable.module.css',
            'utf8',
        );

        expect(css).toMatch(/@media \(max-width: 599px\)/);
        expect(css).toMatch(/\.table \.cell\s*\{[\s\S]*display: grid/);
        expect(css).toMatch(/content: attr\(data-label\)/);
    });

    it('labels and aligns recent-trade columns', async () => {
        const getMarketHistory = vi.fn().mockResolvedValue([{
            action_index: 7,
            type: 'buy',
            price: '0.25',
            amount: '12',
            timestamp: 1_700_000_000,
        }]);
        render(
            <MessagingProvider shell="web" messaging={{ getMarketHistory }}>
                <RecentTradesPanel chainId="bitcoin-mainnet" tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        const table = await screen.findByRole('table', { name: 'Recent trades' });
        expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(4);
        expect(screen.getByRole('columnheader', { name: 'Price' }).className).toContain('numeric');
        expect(table.querySelector('td[data-label="Size (XCHAIN)"]').className).toContain('numeric');
    });

    it('gives wallet trade history a caption, scoped headers, and stacked labels', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{ address: 'bc1qowner' }],
            }),
            getMarketHistory: vi.fn().mockResolvedValue([{
                action_index: 9,
                type: 'sell',
                price: '2',
                amount: '3',
                timestamp: 1_700_000_000,
            }]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TradeHistoryPanel
                    walletId="wallet-1"
                    chainId="bitcoin-mainnet"
                    tick1="XCHAIN"
                    tick2="BTC"
                />
            </MessagingProvider>,
        );

        const table = await screen.findByRole('table', { name: 'Trade history' });
        expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(5);
        expect(await screen.findByText('bc1qowner')).toBeInTheDocument();
        expect(table.querySelector('td[data-label="Price"]')).toBeInTheDocument();
        expect(table.querySelector('td[data-label="Address"]')).toBeInTheDocument();
    });
});
