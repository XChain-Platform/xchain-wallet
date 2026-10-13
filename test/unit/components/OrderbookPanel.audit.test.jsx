// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OrderbookPanel } from '../../../packages/core/src/shared/components/OrderbookPanel.jsx';

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

        const bidScroller = screen.getByRole('region', { name: 'Buy bids order book levels' });
        expect(bidScroller.className).toMatch(/levelsScroller/);
        expect(bidScroller.firstElementChild.className).toMatch(/levelsTable/);

        const header = screen.getAllByText('Price (BTC)')[0].parentElement;
        expect(header.style.textAlign).toBe('right');
        expect(header.style.fontVariantNumeric).toBe('tabular-nums');

        expect(screen.getByText('Buy bids')).toBeInTheDocument();
        expect(screen.getByText('Sell asks')).toBeInTheDocument();

        const rowButton = screen.getByRole('button', { name: 'Pick buy bid price 0.010000' });
        const row = rowButton.firstElementChild;
        expect(row.style.textAlign).toBe('right');
        expect(row.style.fontVariantNumeric).toBe('tabular-nums');
        expect(row.querySelector('[aria-hidden="true"]').style.width).toBe('50%');

        fireEvent.click(rowButton);
        expect(onPickPrice).toHaveBeenCalledWith('0.010000');
    });

    it('shows a plain failed-load message without an empty table and retries', async () => {
        const getOrderbook = vi.fn()
            .mockRejectedValueOnce(new Error('getOrderbook: POST https://explorer.invalid/api/orderbook failed'))
            .mockResolvedValue({ bids: [['0.01', '5']], asks: [] });
        renderBook(getOrderbook);

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the order book.");
        expect(screen.getByRole('alert')).not.toHaveTextContent('explorer.invalid');
        expect(screen.queryByText('No open orders on this market.')).toBeNull();
        expect(screen.queryByText('Loading order book…')).toBeNull();
        expect(screen.queryByText('Price (BTC)')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByTitle('0.01')).toHaveTextContent('0.01');
        expect(getOrderbook).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders only valid levels from a partial response without broken values', async () => {
        const { container } = renderBook(vi.fn().mockResolvedValue({
            bids: [['0.01', '5'], ['not-a-price', '2'], null],
            asks: null,
        }));

        expect(await screen.findByTitle('0.01')).toHaveTextContent('0.01');
        expect(screen.getByRole('region', { name: 'Sell asks order book levels' })).toBeInTheDocument();
        expect(screen.getAllByText('Price (BTC)')).toHaveLength(2);
        expect(container).not.toHaveTextContent('NaN');
        expect(container).not.toHaveTextContent('undefined');
    });
});
