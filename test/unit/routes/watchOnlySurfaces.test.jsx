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
    localStorage.clear();
});

function resumableSession(walletId) {
    return {
        id: 'sign-me',
        createdAt: Date.now() - 1000,
        request: { walletId, chainId: CHAIN },
        composed: { chainId: CHAIN, psbt: 'cHNidP8=', actionString: 'SEND|BTC|1' },
        dispatch: {
            software: 'sendToken',
            label: 'Send BTC',
            base: { walletId, chainId: CHAIN, from: { address: ADDRESS } },
        },
    };
}

function modeMessaging(walletMode, extra = {}) {
    const base = {
        getSettings: vi.fn().mockResolvedValue({
            walletMode,
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        updateSettings: vi.fn().mockResolvedValue({ walletMode }),
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
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet' }]),
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
        listConfirmSessions: vi.fn().mockResolvedValue({
            sessions: [resumableSession('wallet-1')],
        }),
    });
}

describe('watch-only route boundaries', () => {
    it('offers a full wallet its unfinished signing session on Home', async () => {
        const messaging = homeMessaging('full');
        mount(messaging, (
            <Home activeWalletId="wallet-1" onSend={vi.fn()} onResumeConfirm={vi.fn()} />
        ));

        expect(await screen.findByRole('group', { name: 'Unfinished transactions' }))
            .toBeInTheDocument();
    });

    it('keeps Send on Home but offers a watch-only wallet no signing session', async () => {
        const messaging = homeMessaging('watcher');
        mount(messaging, (
            <Home activeWalletId="wallet-1" onSend={vi.fn()} onResumeConfirm={vi.fn()} />
        ));

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(within(row).getByRole('button', { name: 'Send' })).toBeInTheDocument();
        await waitFor(() => expect(messaging.listConfirmSessions).toHaveBeenCalled());
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
        await screen.findByRole('button', { name: /More/i });
        fireEvent.click(screen.getByRole('button', { name: /More/i }));
        const menu = await screen.findByRole('menu');
        if (offered) {
            expect(within(menu).queryByText('Speed up')).not.toBeNull();
        } else {
            expect(within(menu).queryByText('Speed up')).toBeNull();
            expect(within(menu).queryByText('Cancel transaction')).toBeNull();
        }
        expect(messaging.replaceTx).not.toHaveBeenCalled();
    });

    it('keeps Send on Token Detail for a watch-only wallet', async () => {
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

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        const send = await within(row).findByRole('button', { name: 'Send' });
        fireEvent.click(send);
        expect(onSend).toHaveBeenCalledTimes(1);
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

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(await within(row).findByRole('button', { name: 'Send' })).toBeInTheDocument();
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
