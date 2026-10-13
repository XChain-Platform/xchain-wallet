// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, isDemoWallet: () => false },
    };
});

vi.mock('../../../packages/core/src/shared/components/MarketChart.jsx', () => ({
    MarketChart: () => React.createElement('div', null, 'Chart panel'),
}));

vi.mock('../../../packages/core/src/shared/components/OrderbookPanel.jsx', () => ({
    OrderbookPanel: ({ onPickPrice }) => React.createElement(
        'button',
        { type: 'button', onClick: () => onPickPrice('0.010000') },
        'Pick exact price',
    ),
}));

vi.mock('../../../packages/core/src/shared/components/RecentTradesPanel.jsx', () => ({
    RecentTradesPanel: () => React.createElement('div', null, 'Recent trades panel'),
}));

vi.mock('../../../packages/core/src/shared/components/PlaceOrderPanel.jsx', () => ({
    PlaceOrderPanel: ({ prefillPrice }) => React.createElement(
        'div',
        null,
        `Prefill: ${prefillPrice ?? 'none'}`,
    ),
}));

vi.mock('../../../packages/core/src/shared/components/OpenOrdersPanel.jsx', () => ({
    OpenOrdersPanel: () => React.createElement('div', null, 'Open orders panel'),
}));

vi.mock('../../../packages/core/src/shared/components/TradeHistoryPanel.jsx', () => ({
    TradeHistoryPanel: () => React.createElement('div', null, 'Trade history panel'),
}));

vi.mock('../../../packages/core/src/shared/components/TickerIcon.jsx', () => ({
    TickerIcon: ({ tick }) => React.createElement('span', null, tick),
}));

import { MarketView } from '../../../packages/core/src/shared/routes/MarketView.jsx';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function renderMarket(props = {}) {
    return render(
        <MarketView
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            tick1="XCHAIN"
            tick2="BTC"
            onBack={() => {}}
            {...props}
        />,
    );
}

beforeEach(() => {
    messaging = {
        getMarket: vi.fn().mockResolvedValue({}),
        getMarketHistory: vi.fn().mockResolvedValue([]),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('MarketView market state', () => {
    it('announces the initial market load and replaces it with a load error', async () => {
        const request = deferred();
        messaging.getMarket = vi.fn(() => request.promise);
        renderMarket();

        expect(screen.getByRole('region', { name: 'Market summary' }))
            .toHaveAttribute('aria-busy', 'true');
        const loadingStatus = screen.getByRole('status', { name: 'Loading market' });
        expect(loadingStatus.querySelector('[aria-hidden="true"]'))
            .toHaveStyle({ height: '159px' });

        await act(async () => request.reject(new Error('network unavailable')));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this market.");
        expect(screen.queryByRole('status', { name: 'Loading market' })).toBeNull();
    });

    it('clears a picked price before reversing the market', async () => {
        const onSwap = vi.fn();
        renderMarket({ onSwap });

        fireEvent.click(screen.getByRole('button', { name: 'Pick exact price' }));
        expect(screen.getByText('Prefill: 0.010000')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: 'Reverse pair to BTC/XCHAIN' }));

        expect(onSwap).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Prefill: none')).toBeInTheDocument();
    });

    it('labels stale price data and refreshes it on request', async () => {
        const now = Math.floor(Date.now() / 1000);
        messaging.getMarketHistory = vi.fn()
            .mockResolvedValueOnce([
                { price: '0.01', amount: '2', type: 'buy', timestamp: now - 90000 },
            ])
            .mockResolvedValueOnce([
                { price: '0.02', amount: '3', type: 'sell', timestamp: now },
            ]);
        renderMarket();

        expect(await screen.findByText(/latest trade is over 24 hours old/i)).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Market summary' })).toHaveTextContent('0.010000 BTC');

        fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }));

        await waitFor(() => {
            expect(screen.queryByText(/latest trade is over 24 hours old/i)).toBeNull();
        });
        expect(screen.getByRole('region', { name: 'Market summary' })).toHaveTextContent('0.020000 BTC');
        expect(messaging.getMarketHistory).toHaveBeenCalledTimes(2);
    });

    it('ignores malformed history rows while rendering usable partial data', async () => {
        const now = Math.floor(Date.now() / 1000);
        messaging.getMarketHistory = vi.fn().mockResolvedValue([
            { price: 'not-a-price', amount: null, type: 'buy', timestamp: 'invalid' },
            { price: '0.02', amount: '3', type: 'sell', timestamp: now },
        ]);
        const { container } = renderMarket();

        await waitFor(() => {
            expect(screen.getByRole('region', { name: 'Market summary' })).toHaveTextContent('0.020000 BTC');
        });
        expect(container).not.toHaveTextContent('NaN');
        expect(container).not.toHaveTextContent('undefined');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
