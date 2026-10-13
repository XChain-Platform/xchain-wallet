// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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
    it('wires the selected market tab to the only visible panel', () => {
        renderMarket();

        const book = screen.getByRole('tab', { name: 'Book' });
        const trades = screen.getByRole('tab', { name: 'Trades' });
        const panel = screen.getByRole('tabpanel', { name: 'Book' });
        expect(book).toHaveAttribute('aria-selected', 'true');
        expect(book).toHaveAttribute('tabindex', '0');
        expect(book).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', book.id);
        expect(trades).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('button', { name: 'Pick exact price' })).toBeInTheDocument();

        fireEvent.click(trades);

        expect(screen.getByRole('tabpanel', { name: 'Trades' })).toBe(panel);
        expect(panel).toHaveAttribute('aria-labelledby', trades.id);
        expect(trades).toHaveAttribute('tabindex', '0');
        expect(book).toHaveAttribute('tabindex', '-1');
        expect(screen.queryByRole('button', { name: 'Pick exact price' })).toBeNull();
        expect(screen.getByText('Recent trades panel')).toBeInTheDocument();
    });

    it('announces the initial market load and replaces it with a load error', async () => {
        const request = deferred();
        messaging.getMarket = vi.fn(() => request.promise);
        renderMarket();

        expect(screen.getByRole('status')).toHaveTextContent('Loading market…');

        await act(async () => request.reject(new Error('network unavailable')));

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this market.");
        expect(screen.queryByText('Loading market…')).toBeNull();
    });

    it('clears a picked price before reversing the market', async () => {
        const onSwap = vi.fn();
        renderMarket({ onSwap });

        fireEvent.click(screen.getByRole('button', { name: 'Pick exact price' }));
        expect(screen.getByText('Prefill: 0.010000')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reverse pair to BTC/XCHAIN' }));

        expect(onSwap).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Prefill: none')).toBeInTheDocument();
    });
});
