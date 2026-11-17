// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home against the network: offline, a failing indexer and a stalled one
// leave Home with its notice, Retry and loading skeleton and never with a
// Send / Receive / Exchange / More row (those live in the navigation).

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
        onActions: vi.fn(),
        onHistory: vi.fn(),
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

function expectNoQuickActions() {
    expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
    for (const name of ['Send', 'Receive', 'Exchange', 'More', 'More actions']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
    }
}

const failingRead = () => vi.fn().mockRejectedValue(Object.assign(
    new Error('Explorer returned HTTP 500'), { status: 500, service: 'explorer' },
));

beforeEach(() => { localStorage.clear(); });

afterEach(() => {
    cleanup();
    delete navigator.onLine;
});

describe('Home draws no quick actions against the network', () => {
    it('has none while offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        mountHome(makeMessaging(), handlers());
        expect((await screen.findAllByText(/You are offline/)).length).toBe(1);
        expectNoQuickActions();
    });

    it('has none beside Retry when the first balance read fails with nothing saved', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        mountHome(makeMessaging(failingRead()), handlers());
        expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
        expectNoQuickActions();
    });

    it('has none on a compact Home whose first balance read returns HTTP 500', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        mountHome(makeMessaging(failingRead()), handlers(), 'popup');
        expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
        expectNoQuickActions();
    });

    it('shows the loading skeleton with no action row when the indexer never answers', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const messaging = makeMessaging(vi.fn(() => new Promise(() => {})));
        mountHome(messaging, handlers());
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(await screen.findByRole('status', { name: 'Loading balances' })).toBeTruthy();
        expectNoQuickActions();
    });
});
