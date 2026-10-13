// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTablistKeys } from '../../../packages/core/src/shared/keyboard/useTablistKeys.js';

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
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

function KeyboardHarness({ children }) {
    useTablistKeys();
    return children;
}

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

    it('switches market panels with arrow, Home, and End keys', async () => {
        render(
            <KeyboardHarness>
                <MarketView
                    walletId="wallet-1"
                    chainId="bitcoin-mainnet"
                    tick1="XCHAIN"
                    tick2="BTC"
                    onBack={() => {}}
                />
            </KeyboardHarness>,
        );

        const book = screen.getByRole('tab', { name: 'Book' });
        book.focus();
        fireEvent.keyDown(book, { key: 'ArrowRight' });
        expect(screen.getByText('Recent trades panel')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Trades' })).toHaveFocus();

        fireEvent.keyDown(document.activeElement, { key: 'End' });
        expect(screen.getByText('Trade history panel')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();

        fireEvent.keyDown(document.activeElement, { key: 'Home' });
        expect(screen.getByRole('button', { name: 'Pick exact price' })).toBeInTheDocument();
        expect(book).toHaveFocus();
    });

    it('operates market filters and reaches result rows from the keyboard', async () => {
        messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'BTC', tick2: 'AAA', depth: 10 },
                { tick1: 'BTC', tick2: 'BBB', depth: 9 },
                { tick1: 'BTC', tick2: 'CCC', depth: 8 },
                { tick1: 'BTC', tick2: 'DDD', depth: 7 },
                { tick1: 'BTC', tick2: 'EEE', depth: 6 },
                { tick1: 'BTC', tick2: 'FFF', depth: 5 },
            ]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
        };
        render(
            <KeyboardHarness>
                <MarketsList
                    walletId="wallet-1"
                    selectedAsset={{ chainId: 'bitcoin-mainnet', tick: 'BTC' }}
                    onChangeAsset={() => {}}
                    onOpenMarket={() => {}}
                />
            </KeyboardHarness>,
        );

        await screen.findByRole('button', { name: 'Open AAA market' });
        expect(screen.queryByRole('button', { name: 'Open FFF market' })).toBeNull();

        const popular = screen.getByRole('tab', { name: 'Popular' });
        popular.focus();
        fireEvent.keyDown(popular, { key: 'ArrowLeft' });
        const all = screen.getByRole('tab', { name: 'All' });
        expect(all).toHaveFocus();
        expect(all).toHaveAttribute('aria-selected', 'true');

        const lastRow = await screen.findByRole('button', { name: 'Open FFF market' });
        lastRow.focus();
        expect(lastRow).toHaveFocus();
        expect(lastRow.tabIndex).toBe(0);
    });
});
