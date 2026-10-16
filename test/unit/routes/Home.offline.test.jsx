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
        const onCreateToken = vi.fn();
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        mountHome(messaging, onSend, { onSwap, onCreateToken });

        await waitFor(() => expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeTruthy());
        expect(screen.getByText(/^Updated /)).toBeTruthy();

        // A failed background read leaves the last successful rows and sync
        // time intact instead of returning Home to a loading state.
        messaging.getWalletBalances.mockRejectedValueOnce(new Error('Failed to fetch'));
        vi.setSystemTime(Date.now() + flows.BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();

        setNavigatorOnline(false);
        act(() => { window.dispatchEvent(new Event('offline')); });
        await waitFor(() => expect(screen.getByText(/Showing cached balances/)).toBeTruthy());
        // Offline, the freshness label names the saved data and keeps the last
        // sync time in its title.
        expect(screen.getByText('Offline, showing saved data').getAttribute('title')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getByText(/Sending needs a network connection/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
        expect(onSwap).not.toHaveBeenCalled();
        expect(screen.getByText(/Swapping needs a network connection/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
        expect(onCreateToken).not.toHaveBeenCalled();
        expect(screen.getByText(/Creating a token needs a network connection/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);

        messaging.getWalletBalances.mockResolvedValue(BALANCES);
        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.queryByText(/Showing cached balances/)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('gives a fresh offline wallet its actions under the one offline message', async () => {
        // Nothing saved yet and no network: the balances are unavailable, but
        // Home still offers its actions instead of an empty page.
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

        const actions = await screen.findByRole('group', { name: 'Quick actions' });
        expect(screen.getAllByText('You are offline. Connect to load balances and use network actions.'))
            .toHaveLength(1);
        expect(screen.queryByLabelText('Loading balances')).toBeNull();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();

        const send = within(actions).getByRole('button', { name: 'Send' });
        expect(send).toHaveAttribute('aria-disabled', 'true');
        expect(send).toHaveAttribute('title', 'Send needs a network connection');
        fireEvent.click(send);
        expect(onSend).not.toHaveBeenCalled();

        fireEvent.click(within(actions).getByRole('button', { name: 'Receive' }));
        expect(onReceive).toHaveBeenCalledTimes(1);
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
});
