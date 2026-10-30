// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A scanned payment request becomes a Send prefill. If Send's first address
// read is refused, its retry stays on that screen and keeps the scanned fields.

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const scanner = vi.hoisted(() => ({ onFrame: null }));

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: ({ onFrame }) => {
            scanner.onFrame = onFrame;
            return null;
        },
    };
});

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        overall: 'unknown',
        loading: false,
        perChain: [],
        lastChecked: null,
        refresh: vi.fn(),
        error: null,
    }),
}));

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { ScanRoute } = await import('../../../packages/core/src/shared/routes/ScanRoute.jsx');
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qsendersendersendersendersendersendersa';
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function messagingWithAddressRetry(firstRead) {
    const balances = {
        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
        tokens: [],
    };
    const base = {
        getAddressesByChain: vi.fn()
            .mockImplementationOnce(() => firstRead.promise)
            .mockResolvedValue({
                [CHAIN]: [{ id: 'source', address: SOURCE, source: 'hd' }],
            }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'source', address: SOURCE },
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0, priceDataEnabled: false },
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: SOURCE, balances }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue(balances),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function ScanToSend({ messaging }) {
    const [prefill, setPrefill] = useState(null);
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            {prefill ? (
                <Send walletId="wallet-1" prefill={prefill} onBack={() => {}} />
            ) : (
                <ScanRoute onBack={() => {}} onClassified={setPrefill} />
            )}
        </MessagingProvider>
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    scanner.onFrame = null;
    delete navigator.onLine;
});

describe('ScanRoute Send recovery', () => {
    it('retries a refused address read without dropping the scanned request', async () => {
        const firstRead = deferred();
        const messaging = messagingWithAddressRetry(firstRead);
        setNavigatorOnline(true);
        render(<ScanToSend messaging={messaging} />);

        act(() => {
            scanner.onFrame(`bitcoin:${DESTINATION}?amount=0.25`);
        });
        setNavigatorOnline(false);
        await act(async () => { firstRead.reject(new Error('HTTP 500')); });

        expect(await screen.findByText(/Couldn't load addresses/)).toBeInTheDocument();
        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });
        screen.getByRole('button', { name: 'Try again' }).click();

        expect(await screen.findByDisplayValue(DESTINATION)).toBeInTheDocument();
        expect(screen.getByDisplayValue('0.25')).toBeInTheDocument();
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(2);
    });
});
