// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A watch-only wallet cannot sign, so no surface offers it a signing step,
// while Send stays open on every route because it builds unsigned
// transactions.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { DetailCard } from '../../../packages/core/src/shared/routes/History.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qsendersendersendersendersendersendersa';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => {
    cleanup();
    resetWalletModes();
    localStorage.clear();
});

function modeMessaging(walletMode, extra = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const base = {
        getSettings: vi.fn().mockResolvedValue({
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode }]),
        updateSettings: vi.fn().mockResolvedValue({}),
        ...extra,
    };
    // Every call a surface makes that the test does not care about resolves
    // to nothing, so each case lists only the reads it asserts on.
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

function mount(messaging, child) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>,
    );
}

function homeMessaging(walletMode) {
    return modeMessaging(walletMode, {
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode }]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'address-1', address: ADDRESS },
        }),
        listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 'retired-session' }] }),
    });
}

describe('watch-only route boundaries', () => {
    it('offers no stored signing session on Home', async () => {
        const messaging = homeMessaging('full');
        mount(messaging, (
            <Home activeWalletId="wallet-1" onSend={vi.fn()} />
        ));

        // With balances on screen Home shows the balance card and no action row.
        await screen.findByLabelText('Balance summary');
        expect(messaging.listConfirmSessions).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Unfinished transactions' })).toBeNull();
    });

    it('draws no Send row on Home for a watch-only wallet', async () => {
        // Send lives in the navigation; Home shows no quick action row.
        const messaging = homeMessaging('watcher');
        messaging.getWalletBalances = vi.fn().mockRejectedValue(new Error('offline'));
        mount(messaging, (
            <Home activeWalletId="wallet-1" onSend={vi.fn()} />
        ));

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
        expect(messaging.listConfirmSessions).not.toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Unfinished transactions' })).toBeNull();
    });

    it('opens a watch-only zero-balance Send form with no password field', async () => {
        const messaging = modeMessaging('watcher', {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    id: 'address-1',
                    address: ADDRESS,
                    publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0",
                    source: 'hd',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: 'address-1', address: ADDRESS },
            }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '0', divisibility: 8 },
                tokens: [],
            }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
            getAddressHistory: vi.fn().mockResolvedValue([]),
        });

        mount(messaging, <Send walletId="wallet-1" onBack={() => {}} />);

        expect(await screen.findByRole('form', { name: 'Send' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Password')).toBeNull();
    });

    it.each([
        ['full', true],
        ['watcher', false],
    ])('offers Speed up on a %s wallet history entry: %s', async (walletMode, offered) => {
        const messaging = modeMessaging(walletMode, {
            listContacts: vi.fn().mockResolvedValue([]),
            replaceTx: vi.fn(),
        });
        mount(messaging, (
            <DetailCard
                entry={{
                    action: 'SEND',
                    blockIndex: 0,
                    chainId: CHAIN,
                    txHash: 'a'.repeat(64),
                    address: ADDRESS,
                    source: ADDRESS,
                    rbf: true,
                    raw: {},
                    pending: { rbf: true },
                }}
                peerCache={{}}
                walletId="wallet-1"
                showFiatInHistory={false}
                fiatCurrency="USD"
            />
        ));

        await waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        // Speed up and Cancel are rows of the card's Actions tab list (G101).
        const list = await screen.findByRole('list', { name: 'Transaction actions' });
        if (offered) {
            expect(await within(list).findByText('Speed up transaction')).not.toBeNull();
        } else {
            expect(within(list).queryByText('Speed up transaction')).toBeNull();
            expect(within(list).queryByText('Cancel transaction')).toBeNull();
        }
        expect(messaging.replaceTx).not.toHaveBeenCalled();
    });

    it('keeps Send live on Token Detail for a watch-only wallet (it builds unsigned for the signer)', async () => {
        const onSend = vi.fn();
        mount(modeMessaging('watcher'), (
            <TokenDetail
                walletId="wallet-1"
                chainId={CHAIN}
                tick="BTC"
                kind="native"
                quantity="100000000"
                onBack={() => {}}
                onSend={onSend}
            />
        ));

        const row = await screen.findByRole('list', { name: 'Actions for BTC' });
        const send = await within(row).findByRole('button', { name: /^Send\b/ });
        // Send opens the same unsigned-transaction flow as Home, so the row
        // is enabled and pressing it opens the Send route.
        await waitFor(() => expect(send).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(send);
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/watch-only and can't sign/i)).toBeNull();
    });

    it('opens Token Detail in full mode when the settings read fails', async () => {
        const onSend = vi.fn();
        const messaging = modeMessaging('watcher', {
            getSettings: vi.fn().mockRejectedValue(new Error('vault busy')),
        });
        mount(messaging, (
            <TokenDetail
                walletId="wallet-1"
                chainId={CHAIN}
                tick="BTC"
                kind="native"
                quantity="100000000"
                onBack={() => {}}
                onSend={onSend}
            />
        ));

        const row = await screen.findByRole('list', { name: 'Actions for BTC' });
        expect(await within(row).findByRole('button', { name: /^Send\b/ })).toBeInTheDocument();
    });

    it('opens the Send form when the settings read fails', async () => {
        const messaging = modeMessaging('full', {
            getSettings: vi.fn().mockRejectedValue(new Error('vault busy')),
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    id: 'address-1',
                    address: ADDRESS,
                    publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0",
                    source: 'hd',
                }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: 'address-1', address: ADDRESS },
            }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
            getAddressHistory: vi.fn().mockResolvedValue([]),
        });

        mount(messaging, <Send walletId="wallet-1" onBack={() => {}} />);

        expect(await screen.findByRole('form', { name: 'Send' })).toBeInTheDocument();
    });
});
