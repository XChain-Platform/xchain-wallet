// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Operator ruling 2026-11-13 for the Market page: the Book and Trades tabs show
// only their rows (no panel heading, Spread or last-trade line), My Orders is
// one newest-first list with its status in the header filter, and the header
// carries the standard filter (G95), then an open-on-explorer button.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketView } from '../../../packages/core/src/shared/routes/MarketView.jsx';
import { openSelectListbox, selectOption } from '../../helpers/selectOption.js';

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({ open: false, composing: false, isWatcherMode: false, run: vi.fn(), confirmProps: {} }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));
vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({ flag: false, mandatory: false }),
}));

const CHAIN = 'bitcoin-mainnet';
const OWNER = { id: 'a1', address: 'bc1qownerexampleexampleexampleexampleexample' };
const NOW = Math.floor(Date.now() / 1000);

function makeMessaging(overrides = {}) {
    return {
        getMarket: vi.fn().mockResolvedValue({}),
        getMarketHistory: vi.fn((args) => Promise.resolve(args.address
            // The user's own fills on this market.
            ? [
                { type: 'sell', price: '0.00030000', amount: '7', timestamp: NOW - 600, tx_hash: 'fillolder' },
                { type: 'buy', price: '0.00031000', amount: '9', timestamp: NOW - 60, tx_hash: 'fillnewest' },
            ]
            // Every trade on the market.
            : [
                { type: 'buy', price: '0.00025000', amount: '3', timestamp: NOW - 120, tx_hash: 'tradeaaa' },
                { type: 'sell', price: '0.00026000', amount: '4', timestamp: NOW - 240, tx_hash: 'tradebbb' },
            ])),
        getOrderbook: vi.fn().mockResolvedValue({
            bids: [['0.00020000', '100'], ['0.00019000', '50']],
            asks: [['0.00022000', '80'], ['0.00023000', '60']],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getMarketOrders: vi.fn().mockResolvedValue([
            { type: 'buy', price: '0.00018000', amount: '12', action_index: 41, timestamp: NOW - 300, tx_hash: 'openorder' },
        ]),
        listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        saveWatchlistEntry: vi.fn().mockResolvedValue({}),
        clearWatchlistEntry: vi.fn().mockResolvedValue({}),
        ...overrides,
    };
}

function renderMarket(props = {}, messaging = makeMessaging()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketView walletId="w" chainId={CHAIN} tick1="TOK" tick2="BTC" onBack={() => {}} onTrade={() => {}} {...props} />
        </MessagingProvider>,
    );
    return messaging;
}

function openFilter() {
    const trigger = screen.getByRole('button', { name: 'Filter market' });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
}

function search(text) {
    openFilter();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
}

function tabPanel() {
    return screen.getByRole('tabpanel', { name: /Book|Trades|My Orders/ });
}

let openSpy;
beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Market page header controls', () => {
    it('puts the filter, then open-on-explorer, in the page header', async () => {
        renderMarket();
        const header = screen.getByRole('banner');
        const filter = within(header).getByRole('button', { name: 'Filter market' });
        const explorer = within(header).getByRole('button', { name: 'Open this market on the explorer' });
        expect(filter.compareDocumentPosition(explorer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(explorer);
        expect(openSpy).toHaveBeenCalledTimes(1);
        const [url, target, features] = openSpy.mock.calls[0];
        expect(url).toMatch(/^https?:\/\/[^/]+\/[A-Za-z]+\/market\/TOK\/BTC$/);
        expect(target).toBe('_blank');
        expect(features).toBe('noopener,noreferrer');
    });

    it('encodes each ticker as one path segment of the explorer link', async () => {
        renderMarket({ tick1: 'A/B?C', tick2: 'BTC' });
        fireEvent.click(screen.getByRole('button', { name: 'Open this market on the explorer' }));
        expect(openSpy.mock.calls[0][0]).toMatch(/\/market\/A%2FB%3FC\/BTC$/);
    });

    it('keeps the controls with the market card in the DEX right panel', async () => {
        renderMarket({ embedded: true });
        expect(screen.queryByRole('banner')).toBeNull();
        const filter = screen.getByRole('button', { name: 'Filter market' });
        const explorer = screen.getByRole('button', { name: 'Open this market on the explorer' });
        const summary = screen.getByRole('region', { name: 'Market summary' });
        expect(filter.compareDocumentPosition(explorer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(explorer.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('Market page Book tab', () => {
    it('shows only the column header row and the book rows', async () => {
        renderMarket();
        await screen.findByRole('button', { name: /Pick buy bid price 0.00020000/ });
        const panel = tabPanel();
        expect(within(panel).queryByText('Order book')).toBeNull();
        expect(panel.textContent).not.toMatch(/Spread/);
        expect(within(panel).queryByText('Last trade')).toBeNull();
        expect(within(panel).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Size', 'Bid (BTC)', 'Ask (BTC)', 'Size']);
    });

    it('narrows the book by price or size', async () => {
        renderMarket();
        await screen.findByRole('button', { name: /Pick buy bid price 0.00020000/ });
        search('0.00023');
        expect(screen.queryByRole('button', { name: /Pick buy bid price/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Pick sell ask price 0.00023000/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Pick sell ask price 0.00022000/ })).toBeNull();

        search('50');
        expect(screen.getByRole('button', { name: /Pick buy bid price 0.00019000/ })).toBeInTheDocument();
        search('999999');
        expect(within(tabPanel()).getByText('No rows match the search.')).toBeInTheDocument();
    });

    it('leaves a failed book read to the page message, with no Try Again in the tab (G91)', async () => {
        renderMarket({}, makeMessaging({ getOrderbook: vi.fn().mockRejectedValue(new Error('down')) }));
        await screen.findByText(/Couldn't load order book/);
        expect(within(tabPanel()).queryByRole('button', { name: 'Try Again' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Try Again' })).toHaveLength(1);
    });
});

describe('Market page Trades tab', () => {
    it('shows the trade rows with no Recent trades heading, and searches by price, amount or transaction', async () => {
        renderMarket();
        fireEvent.click(screen.getByRole('tab', { name: /Trades/ }));
        const table = await screen.findByRole('table', { name: 'Recent trades' });
        await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
        expect(within(tabPanel()).queryByText('Recent trades')).toBeNull();
        expect(table.querySelector('caption')).toBeNull();

        search('tradebbb');
        expect(within(table).getAllByRole('row')).toHaveLength(2);
        expect(within(table).getByText(/^0\.00026/)).toBeInTheDocument();
        search('3');
        expect(within(table).getAllByRole('row')).toHaveLength(2);
    });
});

describe('Market page My Orders tab', () => {
    async function openOrders(messaging) {
        renderMarket({}, messaging);
        fireEvent.click(screen.getByRole('tab', { name: /My Orders/ }));
        const list = await screen.findByRole('region', { name: 'My orders' });
        await waitFor(() => expect(list.querySelectorAll('li[data-order-status]')).toHaveLength(3));
        return list;
    }

    const statuses = (list) => [...list.querySelectorAll('li[data-order-status]')].map((li) => li.getAttribute('data-order-status'));

    it('lists open orders and fills in one list, newest first, with no Open | Filled switch', async () => {
        const list = await openOrders();
        expect(screen.queryByRole('radiogroup', { name: 'My orders' })).toBeNull();
        expect(screen.queryByRole('radio', { name: /Open|Filled/ })).toBeNull();
        expect(within(list).queryByText('Open orders')).toBeNull();
        // Fills at 1 and 10 minutes ago around the open order at 5 minutes ago.
        expect(statuses(list)).toEqual(['filled', 'open', 'filled']);
        expect(within(list).getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    });

    it('narrows by the unlabelled Status dropdown and lights the filter', async () => {
        const list = await openOrders();
        const trigger = screen.getByRole('button', { name: 'Filter market' });
        expect(trigger.parentElement.querySelector('[class*="filterBadge"]')).toBeNull();
        openFilter();
        // No visible label: the name is the dropdown's accessible name only.
        const status = screen.getByRole('combobox', { name: 'Order status' });
        expect(status).toHaveTextContent('All orders');
        const listbox = openSelectListbox(status);
        expect([...listbox.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())).toEqual(['All orders', 'Open', 'Filled']);

        selectOption(status, 'filled');
        expect(statuses(list)).toEqual(['filled', 'filled']);
        expect(trigger.parentElement.querySelector('[class*="filterBadge"]')).not.toBeNull();
        selectOption(screen.getByRole('combobox', { name: 'Order status' }), 'open');
        expect(statuses(list)).toEqual(['open']);
    });

    it('keeps a failed fills read on the page message while open orders keep polling', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const messaging = makeMessaging();
            const marketWide = messaging.getMarketHistory;
            messaging.getMarketHistory = vi.fn((args) => (args.address
                ? Promise.reject(new Error('fills down'))
                : marketWide(args)));
            renderMarket({}, messaging);
            fireEvent.click(screen.getByRole('tab', { name: /My Orders/ }));
            await screen.findByText(/Couldn't load your orders/);
            // A few good open-order polls later the failure still shows, once.
            await vi.advanceTimersByTimeAsync(16000);
            expect(messaging.getMarketOrders.mock.calls.length).toBeGreaterThan(1);
            expect(screen.getByText(/Couldn't load your orders/)).toBeInTheDocument();
            expect(screen.getAllByRole('button', { name: 'Try Again' })).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('searches the orders by price, amount or transaction', async () => {
        const list = await openOrders();
        search('fillolder');
        expect(statuses(list)).toEqual(['filled']);
        search('0.00018');
        expect(statuses(list)).toEqual(['open']);
        search('nothing-like-this');
        expect(within(list).getByText('No rows match the search.')).toBeInTheDocument();
    });

    it('offers the Status dropdown only on My Orders', async () => {
        renderMarket();
        openFilter();
        expect(screen.queryByRole('combobox', { name: 'Order status' })).toBeNull();
    });
});
