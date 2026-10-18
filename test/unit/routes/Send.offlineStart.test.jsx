// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Send with the device offline: the form renders at once instead of waiting
// on balance reads that cannot finish, and the page carries one offline
// message.

import React, { useMemo, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'unknown' }));

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
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import {
    ReachabilityNoticeHiddenContext,
    ShellNoticesContext,
} from '../../../packages/core/src/shared/components/noticesRoute.js';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';

const CHAIN = 'bitcoin-mainnet';
const WALLET_ID = 'offline-send-wallet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
let savedResizeObserver;

beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    reachability.overall = 'unknown';
    delete navigator.onLine;
});

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function messagingWith(defaults) {
    return new Proxy(defaults, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

// Network reads that never settle, the way an unreachable explorer behaves
// while the request layer is still retrying.
const pending = () => vi.fn(() => new Promise(() => {}));

function offlineMessaging() {
    return messagingWith({
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'address-1', address: ADDRESS },
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        getWalletBalances: pending(),
        getAddressBalances: pending(),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
    });
}

// The shell's notice slot as the layout wires it: a screen that states the
// offline state itself hides the reachability notice.
function ShellNotices({ children }) {
    const [hidden, setHidden] = useState(0);
    const notices = useMemo(() => ({ claim: () => () => {}, setReachabilityHidden: setHidden }), []);
    return (
        <ShellNoticesContext.Provider value={notices}>
            <ReachabilityNoticeHiddenContext.Provider value={hidden > 0}>
                <ReachabilityBanner />
            </ReachabilityNoticeHiddenContext.Provider>
            {children}
        </ShellNoticesContext.Provider>
    );
}

function renderSend(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ShellNotices>
                    <Send walletId={WALLET_ID} onBack={() => {}} />
                </ShellNotices>
            </ToastHost>
        </MessagingProvider>,
    );
}

describe('Send offline start', () => {
    it('renders the form at once while balance reads cannot finish', async () => {
        setNavigatorOnline(false);
        const messaging = offlineMessaging();

        renderSend(messaging);

        expect(await screen.findByDisplayValue(ADDRESS)).toBeInTheDocument();
        expect(document.getElementById('send-form')).not.toBeNull();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(messaging.getAddressBalances).not.toHaveBeenCalled();
        expect(screen.getByText(/Sending needs a network connection/)).toBeInTheDocument();
        expect(screen.getByText('Balance unavailable')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('carries one offline message: the shell notice and the fee notice step aside', async () => {
        setNavigatorOnline(false);
        reachability.overall = 'offline';

        renderSend(offlineMessaging());

        expect(await screen.findByText(/Sending needs a network connection/)).toBeInTheDocument();
        expect(screen.queryByText('Some balances may be out of date')).toBeNull();
        expect(screen.queryByText(/Live fee estimate unavailable/)).toBeNull();
    });

    it('shows the saved balance for the source address offline', async () => {
        setNavigatorOnline(false);
        writeBalanceCache(WALLET_ID, null, {
            balances: {
                [CHAIN]: [{
                    address: ADDRESS,
                    balances: { native: { tick: 'BTC', quantity: '150000000', divisibility: 8 }, tokens: [] },
                }],
            },
            activeByChain: {},
            fetchedAt: Date.now() - 60_000,
        }, 'mainnet');

        renderSend(offlineMessaging());

        expect(await screen.findByText(/1\.5 BTC available/)).toBeInTheDocument();
    });

    it('runs the balance check when the connection returns', async () => {
        setNavigatorOnline(false);
        const messaging = offlineMessaging();
        renderSend(messaging);
        expect(await screen.findByDisplayValue(ADDRESS)).toBeInTheDocument();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();

        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(screen.getByDisplayValue(ADDRESS)).toBeInTheDocument();
    });
});
