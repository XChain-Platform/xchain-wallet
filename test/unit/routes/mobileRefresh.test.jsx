// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { chooseHistoryMenuItem, historyMenuItem, historyMoreButton } from './historyMoreMenu.js';

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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

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
        // The poll interval is created at mount, so the clock is faked first.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
        ));

        expect(await screen.findByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeInTheDocument();
        // The hero has no manual refresh (its card keeps only the unit swap
        // and the eye), so the reload is the poll beat: one beat starts the
        // read and the next beat, while it is pending, does not double it.
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });
            expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);
            await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });
            expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);

            await act(async () => { held.reject(new Error('Failed to fetch')); });
        } finally {
            vi.useRealTimers();
        }

        expect(await screen.findByText(/Couldn't load balances/)).toBeInTheDocument();
        expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeInTheDocument();
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

        expect(await screen.findByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Refresh(ing)? balances/ })).toBeNull();
        // Ruling G11: the card is captioned with the wallet name and carries only the unit swap and
        // the eye, so the hero menu with its Refresh portfolio row is retired.
        const hero = screen.getByRole('region', { name: WALLET.name });
        expect(within(hero).queryByRole('button', { name: 'Balance actions' })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: /Refresh(ing)? portfolio/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Refresh(ing)? portfolio/ })).toBeNull();
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
        // No manual refresh on the hero: the poll beat is the reload.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
        ));

        expect(await screen.findByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeInTheDocument();
        try {
            await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });
        } finally {
            vi.useRealTimers();
        }

        expect(await screen.findByText(/Couldn't load balances/)).toBeInTheDocument();
        expect(screen.getByText('Bitcoin', { selector: '[title="Bitcoin"]' })).toBeInTheDocument();
        expect(screen.getByText(/Showing saved balances from the last successful sync/))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.queryByText('Fund your wallet')).toBeNull();
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
        // Refresh sits in the ⋯ menu, an outlined icon button on the title
        // line right of the filter (G02, G95 supersede the 2026-10-15
        // content-actions-row ruling: nothing sits between the header and
        // the list).
        const more = historyMoreButton();
        expect(more).toHaveClass(buttonStyles.md);
        expect(more).toHaveClass(buttonStyles.iconOnly);
        expect(more.closest('[data-history-header-actions]')).not.toBeNull();
        expect(document.querySelector('[data-xc-page-actions]')).toBeNull();
        chooseHistoryMenuItem('Refresh history');

        const refreshing = historyMenuItem('Refreshing history');
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
