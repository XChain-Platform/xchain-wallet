// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// History when the device still reports a network but the shared probe finds
// every service unreachable (Wi-Fi and data off in the phone app): the page
// shows one offline state at once, with no skeleton, no load error and no
// read that cannot finish.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'offline' }));

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

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

afterEach(() => {
    cleanup();
    localStorage.clear();
    reachability.overall = 'offline';
    delete navigator.onLine;
});

describe('History offline by probe', () => {
    it('shows one offline state and reads nothing', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        const client = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getAddressHistory: vi.fn(() => new Promise(() => {})),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={client}>
                <ToastHost>
                    <History walletId="wallet-probe" accountId="account-probe" />
                </ToastHost>
            </MessagingProvider>,
        );

        expect(await screen.findByText("You're offline")).toBeInTheDocument();
        expect(screen.getByText('History loads when the connection returns.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Loading history')).toBeNull();
        expect(screen.queryByText(/Could not load history/)).toBeNull();
        expect(client.getAddressHistory).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Refreshing history' })).toBeNull();
    });
});
