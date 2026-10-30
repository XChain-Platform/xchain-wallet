// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home must render the wallet the HOST says is active, not the first wallet in
// the list. Home used to own `activeWalletId` outright and only ever seeded it
// to wallets[0], while the shell handed down `activeAccountId` for whichever
// wallet the user switched to. After any switch the two disagreed, and the
// balance read went out as a cross-wallet (walletId, accountId) pair that
// `walletBalances` rejects by design - "account X does not belong to wallet Y" -
// which blanked Home behind an error for every multi-wallet user.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import {
    readBalanceCache,
    writeBalanceCache,
} from '../../../packages/core/src/shared/utils/balanceCache.js';

const WALLET_A = { id: 'wallet-a', name: 'Main Wallet' };
const WALLET_B = { id: 'wallet-b', name: 'Buyer Wallet' };
const ACCOUNT_B = 'account-b';

const balance = (chainId, address, tick, quantity) => ({
    [chainId]: [{
        address,
        balances: { native: { tick, quantity, divisibility: 8 }, tokens: [] },
    }],
});

function mountHome(props = {}) {
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
        listAccounts: vi.fn().mockResolvedValue([{ id: ACCOUNT_B, index: 0, walletId: WALLET_B.id }]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { ...props }),
        ),
    );
    return { messaging, view };
}

beforeEach(() => localStorage.clear());

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Home honours the host active wallet', () => {
    it('replaces the first-paint skeleton in the balance surface slot', async () => {
        let finishBalances;
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn(() => new Promise((resolve) => { finishBalances = resolve; })),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Home
                    activeWalletId={WALLET_A.id}
                    activeAccountId="account-a"
                    onSend={() => {}}
                    onReceive={() => {}}
                />
            </MessagingProvider>,
        );

        const loading = await screen.findByRole('status', { name: /loading balances/i });
        const slotAnchor = loading.previousElementSibling;
        expect(loading.querySelectorAll('[aria-hidden="true"]')).not.toHaveLength(0);
        expect([...loading.querySelectorAll('[style]')].some((node) => node.style.height === '72px')).toBe(true);

        // The balance read starts once the active network setting has loaded.
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await act(async () => { finishBalances({}); });

        const walletTabs = await screen.findByRole('tablist', { name: 'Wallet view' });
        // The balance surface takes the skeleton's slot: the element right
        // after the same anchor now holds the wallet tabs.
        expect(slotAnchor.nextElementSibling).toContainElement(walletTabs);
        expect(screen.queryByRole('status', { name: /loading balances/i })).toBeNull();
    });

    it('reads balances for the HOST wallet, not wallets[0]', async () => {
        // The switched-to wallet is second in the list: self-electing wallets[0]
        // is exactly the bug, so a passing assertion here has to come from the
        // prop winning.
        const { messaging } = mountHome({
            activeWalletId: WALLET_B.id,
            activeAccountId: ACCOUNT_B,
        });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        const [walletId, accountId] = messaging.getWalletBalances.mock.calls[0];
        expect(walletId).toBe(WALLET_B.id);
        expect(accountId).toBe(ACCOUNT_B);
        // The pair must be internally consistent: the account belongs to the
        // wallet that was queried, which is what walletBalances enforces.
        expect(messaging.getWalletBalances.mock.calls
            .every(([w]) => w === WALLET_B.id)).toBe(true);
    });

    it('falls back to the first wallet when the host wires no active wallet', async () => {
        // Shells that predate the prop keep working off Home's local state.
        const { messaging } = mountHome({});
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(messaging.getWalletBalances.mock.calls[0][0]).toBe(WALLET_A.id);
    });

    it('re-reads balances against the new wallet when the host switches', async () => {
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const tree = (walletId, accountId) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { activeWalletId: walletId, activeAccountId: accountId }),
        );
        const { rerender } = render(tree(WALLET_A.id, 'account-a'));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());

        rerender(tree(WALLET_B.id, ACCOUNT_B));
        await waitFor(() => {
            const last = messaging.getWalletBalances.mock.calls.at(-1);
            expect(last[0]).toBe(WALLET_B.id);
            expect(last[1]).toBe(ACCOUNT_B);
        });
    });

    it('shows only the active wallet cache while its fresh balances load', async () => {
        writeBalanceCache(WALLET_A.id, 'account-a', {
            balances: balance('bitcoin-mainnet', 'bc1qwalleta', 'BTC', '100000000'),
            activeByChain: {},
            fetchedAt: 100,
        });
        writeBalanceCache(WALLET_B.id, ACCOUNT_B, {
            balances: balance('dogecoin-mainnet', 'DWalletB', 'DOGE', '200000000'),
            activeByChain: {},
            fetchedAt: 200,
        });

        const finishBalances = {};
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn((walletId) => new Promise((resolve) => {
                finishBalances[walletId] = resolve;
            })),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const tree = (walletId, accountId) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <Home activeWalletId={walletId} activeAccountId={accountId} />
            </MessagingProvider>
        );
        const { rerender } = render(tree(WALLET_A.id, 'account-a'));

        expect(await screen.findByText(/^BTC\b/)).toBeTruthy();
        expect(screen.getByText('Updating balances…')).toBeTruthy();

        rerender(tree(WALLET_B.id, ACCOUNT_B));

        expect(await screen.findByText(/^DOGE\b/)).toBeTruthy();
        expect(screen.queryByText(/^BTC\b/)).toBeNull();
        expect(screen.getByText('Updating balances…')).toBeTruthy();

        await act(async () => {
            finishBalances[WALLET_B.id](balance('litecoin-mainnet', 'ltc1qfresh', 'LTC', '300000000'));
        });
        expect(await screen.findByText(/^LTC\b/)).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('Updating balances…')).toBeNull());
        await waitFor(() => {
            expect(readBalanceCache(WALLET_B.id, ACCOUNT_B)?.balances)
                .toEqual(balance('litecoin-mainnet', 'ltc1qfresh', 'LTC', '300000000'));
        });
    });

    it.each([
        ['bitcoin-mainnet', true],
        ['bitcoin-testnet', false],
    ])('offers an unfinished %s confirm on mainnet Home: %s', async (chainId, offered) => {
        const address = 'bc1qresumeresumeresumeresumeresumeresume0';
        const session = {
            id: `resume-${chainId}`,
            createdAt: Date.now() - 1000,
            request: { walletId: WALLET_A.id, chainId },
            composed: { chainId, psbt: 'cHNidP8=', actionString: 'SEND|BTC|1' },
            dispatch: {
                software: 'sendToken',
                label: 'Send BTC',
                base: { walletId: WALLET_A.id, chainId, from: { address } },
            },
        };
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
            listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Home activeWalletId={WALLET_A.id} onResumeConfirm={vi.fn()} />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.listConfirmSessions).toHaveBeenCalled());
        if (offered) {
            expect(await screen.findByRole('group', { name: 'Unfinished transactions' })).toBeTruthy();
        } else {
            await act(async () => {});
            expect(screen.queryByRole('group', { name: 'Unfinished transactions' })).toBeNull();
        }
    });

    describe('an unfinished confirm does not wait on the network', () => {
        const address = 'bc1qresumeresumeresumeresumeresumeresume0';
        const session = {
            id: 'resume-local',
            createdAt: Date.now() - 1000,
            request: { walletId: WALLET_A.id, chainId: 'bitcoin-mainnet' },
            composed: { chainId: 'bitcoin-mainnet', psbt: 'cHNidP8=', actionString: 'SEND|BTC|1' },
            dispatch: {
                software: 'sendToken',
                label: 'Send BTC',
                base: { walletId: WALLET_A.id, chainId: 'bitcoin-mainnet', from: { address } },
            },
        };
        const mountWithSession = (getWalletBalances) => {
            const messaging = {
                listWallets: vi.fn().mockResolvedValue([WALLET_A]),
                listAccounts: vi.fn().mockResolvedValue([]),
                getWalletBalances,
                getAddressesByChain: vi.fn().mockResolvedValue({}),
                getActiveAddresses: vi.fn().mockResolvedValue({}),
                getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
                listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
            };
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <Home activeWalletId={WALLET_A.id} onResumeConfirm={vi.fn()} />
                </MessagingProvider>,
            );
            return messaging;
        };

        it('offers the confirm while the balance read is still pending', async () => {
            const messaging = mountWithSession(vi.fn(() => new Promise(() => {})));

            expect(await screen.findByRole('group', { name: 'Unfinished transactions' })).toBeTruthy();
            expect(messaging.getWalletBalances).toHaveBeenCalled();
        });

        it('offers the confirm when the device is offline', async () => {
            const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
            Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
            try {
                const messaging = mountWithSession(vi.fn().mockResolvedValue({}));

                expect(await screen.findByRole('group', { name: 'Unfinished transactions' })).toBeTruthy();
                expect(messaging.getWalletBalances).not.toHaveBeenCalled();
            } finally {
                if (descriptor) Object.defineProperty(Navigator.prototype, 'onLine', descriptor);
            }
        });
    });
});
