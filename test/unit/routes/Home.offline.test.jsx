// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { flows } from '../../../packages/core/src/index.js';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';

const reachability = vi.hoisted(() => ({ overall: 'normal' }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: reachability.overall,
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
        error: null,
    }),
}));

const WALLET = { id: 'offline-wallet', name: 'Offline Wallet' };
const BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qoffline',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }],
};

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function mountHome(messaging, onSend, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Home activeWalletId={WALLET.id} onSend={onSend} onReceive={() => {}} {...props} />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
    reachability.overall = 'normal';
    delete navigator.onLine;
});

describe('Home offline behavior', () => {
    it('keeps cached balances, explains blocked actions, and refreshes on reconnect', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        setNavigatorOnline(true);
        const onSend = vi.fn();
        const onSwap = vi.fn();
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        mountHome(messaging, onSend, { onSwap });

        await waitFor(() => expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeTruthy());
        expect(screen.queryByText(/^Updated /)).toBeNull();

        // A failed background read leaves the last successful rows and sync
        // time intact instead of returning Home to a loading state.
        messaging.getWalletBalances.mockRejectedValueOnce(new Error('Failed to fetch'));
        vi.setSystemTime(Date.now() + flows.BALANCE_MAX_AGE_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();

        setNavigatorOnline(false);
        act(() => { window.dispatchEvent(new Event('offline')); });
        await waitFor(() => expect(screen.getByText(/Showing cached balances/)).toBeTruthy());
        // Offline, the cached-balances notice is the one message: the balance
        // card carries no freshness line (Settings, About shows the last load).
        expect(screen.queryByText('Offline, showing saved data')).toBeNull();
        expect(screen.queryByText(/^Updated /)).toBeNull();

        // Home has no action row at all: Send, Receive, Exchange and Create
        // token live in the navigation and the wallet menu.
        for (const name of ['Send', 'Receive', 'Exchange', 'More', 'Swap', 'Create token']) {
            expect(screen.queryByRole('button', { name })).toBeNull();
        }
        // The balance card's menu no longer carries a Refresh portfolio row,
        // so the offline guard is shown by the read count staying put.
        expect(screen.queryByRole('menuitem', { name: 'Refresh portfolio' })).toBeNull();
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);

        messaging.getWalletBalances.mockResolvedValue(BALANCES);
        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.queryByText(/Showing cached balances/)).toBeNull());
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    });

    it('gives a fresh offline wallet the one offline message and no action row', async () => {
        // Nothing saved yet and no network: the balances are unavailable and
        // the navigation holds every action.
        setNavigatorOnline(false);
        const onSend = vi.fn();
        const onReceive = vi.fn();
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn(() => new Promise(() => {})),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        mountHome(messaging, onSend, { onReceive });

        expect(await screen.findAllByText('You are offline. Connect to load balances and use network actions.'))
            .toHaveLength(1);
        expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(onSend).not.toHaveBeenCalled();
        expect(onReceive).not.toHaveBeenCalled();
    });

    it('cold-starts from cached balances when services are offline but the device interface is online', async () => {
        setNavigatorOnline(true);
        reachability.overall = 'offline';
        writeBalanceCache(WALLET.id, null, {
            balances: BALANCES,
            activeByChain: {},
            fetchedAt: Date.now() - 60_000,
        });
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };

        const view = mountHome(messaging, vi.fn());

        expect(await screen.findByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeTruthy();
        expect(screen.getByText(/Showing cached balances/)).toBeTruthy();
        expect(screen.queryByText(/Updating balances/)).toBeNull();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();

        reachability.overall = 'normal';
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <Home activeWalletId={WALLET.id} onSend={() => {}} onReceive={() => {}} />
                </ToastHost>
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/Showing cached balances/)).toBeNull();
    });

    it('drops a balance error that failed before the offline verdict arrived', async () => {
        setNavigatorOnline(true);
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockRejectedValue(new Error('Failed to fetch')),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        mountHome(messaging, vi.fn());

        await screen.findByText(/Couldn't load balances/);

        setNavigatorOnline(false);
        act(() => { window.dispatchEvent(new Event('offline')); });

        await screen.findByText('You are offline. Connect to load balances and use network actions.');
        expect(screen.queryByText(/Couldn't load balances/)).toBeNull();
    });

    it('identifies an SDK load failure instead of calling the wallet offline', async () => {
        setNavigatorOnline(true);
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{
                    address: 'bc1qsdkfailed',
                    balances: null,
                    error: '[xchain-wallet/web] xchain-sdk is not loaded yet (or failed to load)',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        const view = mountHome(messaging, vi.fn());

        await screen.findByText('Part of the wallet did not load. Reload to try again.');

        reachability.overall = 'offline';
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <Home activeWalletId={WALLET.id} onSend={() => {}} onReceive={() => {}} />
                </ToastHost>
            </MessagingProvider>,
        );

        expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
        expect(screen.queryByText(/You are offline/)).toBeNull();
    });
});
