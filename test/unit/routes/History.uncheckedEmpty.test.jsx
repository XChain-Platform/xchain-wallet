// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An empty History shows its plain empty state even when balances could not
// be checked: no per-page network error and no Try again, since the app's
// reachability banner reports network trouble once.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
    it('shows "No activity yet" with no unchecked message or Try again', async () => {
        mount(makeMessaging());

        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.getByText('Activity appears here after you send or receive.')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('keeps "No activity yet" when balances were checked', async () => {
        reach.overall = 'online';
        mount(makeMessaging());
        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
    });
});
