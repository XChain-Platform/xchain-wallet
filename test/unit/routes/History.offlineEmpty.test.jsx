// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One message per state: an empty History in a wallet whose balances could not
// be checked says so once (as Send does) instead of "No activity yet" beside
// the "Some balances may be out of date" notice.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const reach = vi.hoisted(() => ({ overall: 'offline', refresh: vi.fn() }));
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: reach.overall,
        perChain: [],
        refresh: reach.refresh,
        lastChecked: null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="wallet-offline-empty" accountId="account-a" />
        </MessagingProvider>,
    );
}

beforeEach(() => { reach.overall = 'offline'; reach.refresh.mockClear(); });
afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete navigator.onLine;
});

describe('History offline with nothing saved', () => {
    it('shows one offline message when the device has no network', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        mount(makeMessaging());

        expect(await screen.findByText("You're offline")).toBeInTheDocument();
        expect(screen.getByText('History loads when the connection returns.')).toBeInTheDocument();
        expect(screen.queryByText(/Connect to load history/)).toBeNull();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('shows the same single message when every service is unreachable, and Try again rechecks', async () => {
        const messaging = makeMessaging();
        mount(messaging);

        expect(await screen.findByText("You're offline")).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.getAllByRole('status').filter((el) => /offline/i.test(el.textContent))).toHaveLength(1);

        // While the verdict is offline no read can finish, so none starts; the
        // recheck flips the verdict and the page then loads by itself.
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reach.refresh).toHaveBeenCalledTimes(1);
    });

    it('keeps the unchecked message when services are only degraded', async () => {
        reach.overall = 'degraded';
        mount(makeMessaging());
        expect(await screen.findByText("Balances couldn't be checked")).toBeInTheDocument();
        expect(screen.queryByText("You're offline")).toBeNull();
    });
});
