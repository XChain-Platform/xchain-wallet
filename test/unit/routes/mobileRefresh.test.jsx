// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'litecoin-regtest';
const HOME_CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function deferred() {
    let reject;
    const promise = new Promise((_, rejectPromise) => { reject = rejectPromise; });
    return { promise, reject };
}

function provider(messaging, child) {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

afterEach(() => cleanup());

describe('mobile refresh', () => {
    it('keeps Home balances visible and blocks a second refresh while an error is pending', async () => {
        const held = deferred();
        const balances = {
            [HOME_CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        };
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn()
                .mockResolvedValueOnce(balances)
                .mockImplementationOnce(() => held.promise),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
        ));

        expect(await screen.findByText('BTC · Bitcoin')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));

        const refreshing = screen.getByRole('button', { name: 'Refreshing portfolio' });
        expect(refreshing).toBeDisabled();
        fireEvent.click(refreshing);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);

        await act(async () => { held.reject(new Error('Failed to fetch')); });

        expect(await screen.findByText(/Couldn't refresh balances/)).toBeInTheDocument();
        expect(screen.getByText('BTC · Bitcoin')).toBeInTheDocument();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();
    });

    it('offers one Home refresh control, in the hero', async () => {
        const balances = {
            [HOME_CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        };
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn().mockResolvedValue(balances),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
        ));

        expect(await screen.findByText('BTC · Bitcoin')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Refresh(ing)? balances/ })).toBeNull();
        const hero = screen.getByRole('region', { name: 'Active address balance' });
        const refresh = screen.getByRole('button', { name: 'Refresh portfolio' });
        expect(hero.contains(refresh)).toBe(true);
        expect(screen.getAllByRole('button', { name: /Refresh(ing)? portfolio/ })).toHaveLength(1);

        fireEvent.click(refresh);
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh portfolio' })).not.toBeDisabled());
    });

    it('treats a resolved per-address balance error as a failed refresh', async () => {
        const balances = {
            [HOME_CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        };
        const refused = {
            [HOME_CHAIN]: [{
                address: ADDRESS,
                balances: null,
                error: 'Explorer returned HTTP 429',
                errorCode: 'RATE_LIMITED',
                retryAfterSeconds: 3,
            }],
        };
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn()
                .mockResolvedValueOnce(balances)
                .mockResolvedValueOnce(refused),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
        ));

        expect(await screen.findByText('BTC · Bitcoin')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));

        expect(await screen.findByText(/Couldn't refresh balances/)).toBeInTheDocument();
        expect(screen.getByText('BTC · Bitcoin')).toBeInTheDocument();
        expect(screen.queryByText(/retrying/)).toBeNull();
    });

    it('keeps History rows visible and blocks a second refresh while an error is pending', async () => {
        const held = deferred();
        const historyRow = {
            action: 'SEND',
            action_index: '1',
            block_index: 100,
            timestamp: Math.floor(Date.now() / 1000),
            tx_hash: 'deadbeef1',
            status: 'valid',
            details: { tick: 'ALPHA', source: ADDRESS },
        };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([historyRow]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn()
                .mockResolvedValueOnce([])
                .mockImplementationOnce(() => held.promise),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(provider(
            messaging,
            <History walletId={WALLET.id} accountId={ACCOUNT.id} />,
        ));

        await waitFor(() => expect(document.querySelector('[data-history-key]')).not.toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));

        const refreshing = screen.getByRole('button', { name: 'Refreshing history' });
        expect(refreshing).toBeDisabled();
        fireEvent.click(refreshing);
        expect(messaging.getAddressHistory).toHaveBeenCalledTimes(2);
        expect(messaging.getAddressMempool).toHaveBeenCalledTimes(2);

        await act(async () => { held.reject(new Error('Failed to fetch')); });

        expect(await screen.findByText(/Couldn't refresh history/)).toBeInTheDocument();
        expect(document.querySelector('[data-history-key]')).not.toBeNull();
        expect(screen.queryByRole('status', { name: 'Loading history' })).toBeNull();
    });
});
