// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home quick actions against the network: offline refusals carry one message
// and never navigate, a connection that flaps decides at the moment of the
// click, and an indexer that fails or stalls leaves the actions that need no
// network (Receive, History, Addresses) routing.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: 'normal',
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
        error: null,
    }),
}));

const WALLET = { id: 'network-wallet', name: 'Network Wallet' };
const BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qnetwork',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }],
};

function makeMessaging(getWalletBalances = vi.fn().mockResolvedValue(BALANCES)) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances,
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    };
}

function handlers() {
    return {
        onSend: vi.fn(),
        onReceive: vi.fn(),
        onExchange: vi.fn(),
        onSwap: vi.fn(),
        onCreateToken: vi.fn(),
        onHistory: vi.fn(),
        onAddresses: vi.fn(),
    };
}

function mountHome(messaging, props, shell = 'desktop') {
    return render(
        <MessagingProvider shell={shell} messaging={messaging}>
            <ToastHost>
                <Home activeWalletId={WALLET.id} {...props} />
            </ToastHost>
        </MessagingProvider>,
    );
}

function setOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
    act(() => { window.dispatchEvent(new Event(online ? 'online' : 'offline')); });
}

afterEach(() => {
    cleanup();
    delete navigator.onLine;
});

describe('Home network actions while offline', () => {
    it.each([
        ['Exchange', 'onExchange', /Exchange needs a network connection\./],
        ['Create token', 'onCreateToken', /Creating a token needs a network connection\./],
    ])('refuses %s with one message and does not navigate', async (name, prop, message) => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const h = handlers();
        mountHome(makeMessaging(), h);

        const button = await screen.findByRole('button', { name });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(button);
        expect(h[prop]).not.toHaveBeenCalled();
        const shown = await screen.findAllByText(message);
        expect(shown).toHaveLength(1);
    });
});

describe('Home network actions across an offline and online flap', () => {
    it('decides each click by the connection at that moment', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const h = handlers();
        mountHome(makeMessaging(), h);
        const row = await screen.findByRole('group', { name: 'Quick actions' });
        const exchange = () => within(row).getByRole('button', { name: 'Exchange' });

        setOnline(false);
        await waitFor(() => expect(exchange()).toHaveAttribute('aria-disabled', 'true'));
        fireEvent.click(exchange());
        expect(h.onExchange).not.toHaveBeenCalled();

        setOnline(true);
        await waitFor(() => expect(exchange()).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(exchange());
        expect(h.onExchange).toHaveBeenCalledTimes(1);

        // A fast flap that ends offline leaves the next click refused.
        setOnline(false);
        setOnline(true);
        setOnline(false);
        await waitFor(() => expect(exchange()).toHaveAttribute('aria-disabled', 'true'));
        fireEvent.click(exchange());
        fireEvent.click(within(row).getByRole('button', { name: 'Swap' }));
        expect(h.onExchange).toHaveBeenCalledTimes(1);
        expect(h.onSwap).not.toHaveBeenCalled();
    });
});

describe('Home actions while the indexer fails or stalls', () => {
    it.each([
        ['returns HTTP 500', () => vi.fn().mockRejectedValue(Object.assign(
            new Error('Explorer returned HTTP 500'), { status: 500, service: 'explorer' },
        ))],
        ['never answers', () => vi.fn(() => new Promise(() => {}))],
    ])('routes Receive, History and Addresses when the indexer %s', async (_label, makeRead) => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const h = handlers();
        const messaging = makeMessaging(makeRead());
        mountHome(messaging, h);

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        fireEvent.click(await screen.findByRole('button', { name: 'Receive' }));
        fireEvent.click(screen.getByRole('button', { name: 'History' }));
        fireEvent.click(screen.getByRole('button', { name: 'Addresses' }));
        expect(h.onReceive).toHaveBeenCalledTimes(1);
        expect(h.onHistory).toHaveBeenCalledTimes(1);
        expect(h.onAddresses).toHaveBeenCalledTimes(1);
    });
    it('keeps the quick actions on a compact Home whose first balance read returns HTTP 500', async () => {
        // Earlier cases save balances for this wallet; this case starts with nothing saved.
        localStorage.clear();
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const h = handlers();
        mountHome(makeMessaging(vi.fn().mockRejectedValue(Object.assign(
            new Error('Explorer returned HTTP 500'), { status: 500, service: 'explorer' },
        ))), h, 'popup');

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Receive' }));
        fireEvent.click(within(row).getByRole('button', { name: 'Send' }));
        expect(h.onReceive).toHaveBeenCalledTimes(1);
        expect(h.onSend).toHaveBeenCalledTimes(1);
    });
});

describe('Home quick actions beside Retry when the first balance read fails with nothing saved', () => {
    // Earlier cases save balances for this wallet; each case here starts with nothing saved.
    beforeEach(() => { localStorage.clear(); });

    it('renders Retry and the Send, Receive and Exchange group on a full Home', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const h = handlers();
        const read = vi.fn().mockRejectedValue(Object.assign(
            new Error('Explorer returned HTTP 500'), { status: 500, service: 'explorer' },
        ));
        mountHome(makeMessaging(read), h);

        const retry = await screen.findByRole('button', { name: 'Retry' });
        expect(retry).toBeTruthy();
        const row = screen.getByRole('group', { name: 'Quick actions' });
        for (const name of ['Send', 'Receive', 'Exchange']) {
            expect(within(row).getByRole('button', { name })).toBeTruthy();
        }
        fireEvent.click(within(row).getByRole('button', { name: 'Receive' }));
        expect(h.onReceive).toHaveBeenCalledTimes(1);
    });

    it('renders the quick action group while offline with nothing saved (control)', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const h = handlers();
        mountHome(makeMessaging(vi.fn(() => new Promise(() => {}))), h);

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        for (const name of ['Send', 'Receive', 'Exchange']) {
            expect(within(row).getByRole('button', { name })).toBeTruthy();
        }
    });
});
