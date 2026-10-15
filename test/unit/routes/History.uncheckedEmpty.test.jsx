// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One message per state: an empty History in a wallet whose balances could not
// be checked says so once (as Send does) instead of "No activity yet" beside
// the "Some balances may be out of date" notice.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const reach = vi.hoisted(() => ({ overall: 'degraded', refresh: vi.fn() }));
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
            <History walletId="wallet-unchecked" accountId="account-a" />
        </MessagingProvider>,
    );
}

beforeEach(() => { reach.overall = 'degraded'; reach.refresh.mockClear(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('History empty state when balances could not be checked', () => {
    it('shows one unchecked message with Try again and no "No activity yet"', async () => {
        const messaging = makeMessaging();
        mount(messaging);

        expect(await screen.findByText("Balances couldn't be checked")).toBeInTheDocument();
        expect(screen.queryByText('No activity yet')).toBeNull();

        const calls = messaging.getAddressHistory.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reach.refresh).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(messaging.getAddressHistory.mock.calls.length).toBeGreaterThan(calls));
    });

    it('keeps "No activity yet" when balances were checked', async () => {
        reach.overall = 'online';
        mount(makeMessaging());
        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
    });
});
