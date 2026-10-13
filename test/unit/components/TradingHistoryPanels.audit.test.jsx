// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RecentTradesPanel } from '../../../packages/core/src/shared/components/RecentTradesPanel.jsx';
import { TradeHistoryPanel } from '../../../packages/core/src/shared/components/TradeHistoryPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = { id: 'address-1', address: 'bc1qownerexample', source: 'hd' };

afterEach(() => cleanup());

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('trading history panel display states', () => {
    it('keeps Recent Trades busy until data resolves and aligns numeric rows', async () => {
        const request = deferred();
        render(
            <MessagingProvider shell="web" messaging={{ getMarketHistory: vi.fn(() => request.promise) }}>
                <RecentTradesPanel chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading recent trades…');
        expect(screen.queryByText('No trades yet.')).toBeNull();
        expect(screen.getByRole('region', { name: 'Recent trades' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => request.resolve([{
            action_index: 1,
            type: 'buy',
            price: '1.25',
            amount: '2.5000',
            timestamp: 1_800_000_000,
        }]));

        const price = await screen.findByText('1.2500');
        const side = screen.getByText('Buy');
        expect(price.closest('td')).toHaveAttribute('data-label', 'Price');
        expect(price.className).toMatch(/numeric/);
        expect(side.style.color).toBe('var(--xc-success)');
        expect(screen.getByRole('columnheader', { name: 'Price' }).closest('table').parentElement.style.overflowX).toBe('auto');
        expect(screen.queryByText('Loading recent trades…')).toBeNull();
    });

    it('keeps Trade History busy through address and history loads', async () => {
        const addressRequest = deferred();
        const historyRequest = deferred();
        const getMarketHistory = vi.fn(() => historyRequest.promise);
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn(() => addressRequest.promise),
                getMarketHistory,
            }}>
                <TradeHistoryPanel
                    walletId="wallet-1"
                    chainId={CHAIN}
                    tick1="XCHAIN"
                    tick2="BTC"
                />
            </MessagingProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading trade history…');
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();

        await act(async () => addressRequest.resolve({ [CHAIN]: [OWNER] }));
        expect(getMarketHistory).toHaveBeenCalledWith({
            chainId: CHAIN,
            tick1: 'XCHAIN',
            tick2: 'BTC',
            address: OWNER.address,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Loading trade history…');

        await act(async () => historyRequest.resolve([{
            action_index: 2,
            type: 'sell',
            price: '1.25',
            amount: '2.5000',
            timestamp: 1_800_000_000,
        }]));

        const price = await screen.findByText('1.25');
        const side = screen.getByText('Sell');
        expect(price.closest('td')).toHaveAttribute('data-label', 'Price');
        expect(price.className).toMatch(/numeric/);
        expect(side.style.color).toBe('var(--xc-danger)');
        expect(screen.getByRole('columnheader', { name: 'Price' }).closest('table').parentElement.style.overflowX).toBe('auto');
        expect(screen.getByRole('region', { name: 'Trade history' })).not.toHaveAttribute('aria-busy');
    });
});
