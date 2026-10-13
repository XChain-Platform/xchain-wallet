// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { flows } from '../../../packages/core/src/index.js';

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

function mountHome(messaging, onSend) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Home activeWalletId={WALLET.id} onSend={onSend} onReceive={() => {}} />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete navigator.onLine;
});

describe('Home offline behavior', () => {
    it('keeps cached balances, explains blocked actions, and refreshes on reconnect', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        setNavigatorOnline(true);
        const onSend = vi.fn();
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        };
        mountHome(messaging, onSend);

        await waitFor(() => expect(screen.getByText('BTC')).toBeTruthy());
        expect(screen.getByText(/Last synced/)).toBeTruthy();

        // A failed background read leaves the last successful rows and sync
        // time intact instead of returning Home to a loading state.
        messaging.getWalletBalances.mockRejectedValueOnce(new Error('Failed to fetch'));
        vi.setSystemTime(Date.now() + flows.BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2));
        expect(screen.getByText('BTC')).toBeTruthy();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();

        setNavigatorOnline(false);
        act(() => { window.dispatchEvent(new Event('offline')); });
        await waitFor(() => expect(screen.getByText(/Showing cached balances/)).toBeTruthy());
        expect(screen.getByText(/Last synced/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getByText(/Sending needs a network connection/)).toBeTruthy();

        messaging.getWalletBalances.mockResolvedValue(BALANCES);
        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.queryByText(/Showing cached balances/)).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(onSend).toHaveBeenCalledTimes(1);
    });
});
