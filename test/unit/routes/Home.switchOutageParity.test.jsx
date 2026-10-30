// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home across a wallet switch and a partial balance outage.
//
// A balance read for wallet A that lands after the user moves to wallet B
// must not paint A's rows under B or save them into B's cache. A read where
// one address (or one half of an address) fails resolves without throwing:
// the entry carries `unavailable: ['native']` and no `error`, so Home commits
// it. The row then says Unavailable or "At least", and the headline above it
// must not state a confident figure the rows do not have.

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
const CHAIN = 'bitcoin-mainnet';

const nativeRow = (address, tick, quantity, fiatRate = null) => ({
    address,
    balances: {
        native: { tick, quantity, divisibility: 8, ...(fiatRate == null ? {} : { fiatRate }) },
        tokens: [],
    },
});

const unreadRow = (address) => ({
    address,
    balances: {
        native: null,
        tokens: [],
        unavailable: ['native'],
        unavailableReason: 'balance service unavailable',
    },
});

function baseMessaging(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        ...overrides,
    };
}

function tree(messaging, walletId, accountId, extra = {}) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <Home
                activeWalletId={walletId}
                activeAccountId={accountId}
                onSend={() => {}}
                onReceive={() => {}}
                {...extra}
            />
        </MessagingProvider>
    );
}

beforeEach(() => localStorage.clear());

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Home across a wallet switch with a balance read in flight', () => {
    it('keeps wallet A rows off wallet B when A answers after the switch', async () => {
        const finish = {};
        const finishActive = {};
        const messaging = baseMessaging({
            getWalletBalances: vi.fn((walletId) => new Promise((resolve) => {
                finish[walletId] = finish[walletId] || [];
                finish[walletId].push(resolve);
            })),
            getActiveAddresses: vi.fn((walletId) => new Promise((resolve) => {
                finishActive[walletId] = finishActive[walletId] || [];
                finishActive[walletId].push(resolve);
            })),
        });
        const { rerender } = render(tree(messaging, WALLET_A.id, 'account-a'));
        await waitFor(() => expect(finish[WALLET_A.id]?.length).toBeGreaterThan(0));

        rerender(tree(messaging, WALLET_B.id, 'account-b'));
        await waitFor(() => expect(finish[WALLET_B.id]?.length).toBeGreaterThan(0));

        // B answers first, then A's stale read lands.
        await act(async () => {
            for (const r of finish[WALLET_B.id]) r({ 'dogecoin-mainnet': [nativeRow('DWalletB', 'DOGE', '200000000')] });
        });
        await act(async () => {
            for (const r of finishActive[WALLET_B.id] || []) r({});
        });
        await act(async () => {
            for (const r of finish[WALLET_A.id]) r({ [CHAIN]: [nativeRow('bc1qwalleta', 'BTC', '100000000')] });
        });
        await act(async () => {
            for (const r of finishActive[WALLET_A.id] || []) r({ [CHAIN]: { id: 'x', address: 'bc1qwalleta' } });
        });

        expect(await screen.findByText(/^DOGE\b/)).toBeTruthy();
        expect(screen.queryByText(/^BTC\b/)).toBeNull();
        expect(JSON.stringify(readBalanceCache(WALLET_B.id, 'account-b')?.balances || {}))
            .not.toContain('bc1qwalleta');
        expect(JSON.stringify(readBalanceCache(WALLET_B.id, 'account-b')?.activeByChain || {}))
            .not.toContain('bc1qwalleta');
    });

    it('keeps wallet A rows off wallet B when A answers before B', async () => {
        const finish = {};
        const messaging = baseMessaging({
            getWalletBalances: vi.fn((walletId) => new Promise((resolve) => {
                finish[walletId] = finish[walletId] || [];
                finish[walletId].push(resolve);
            })),
        });
        const { rerender } = render(tree(messaging, WALLET_A.id, 'account-a'));
        await waitFor(() => expect(finish[WALLET_A.id]?.length).toBeGreaterThan(0));
        rerender(tree(messaging, WALLET_B.id, 'account-b'));
        await waitFor(() => expect(finish[WALLET_B.id]?.length).toBeGreaterThan(0));

        await act(async () => {
            for (const r of finish[WALLET_A.id]) r({ [CHAIN]: [nativeRow('bc1qwalleta', 'BTC', '100000000')] });
        });
        expect(screen.queryByText(/^BTC\b/)).toBeNull();

        await act(async () => {
            for (const r of finish[WALLET_B.id]) r({ 'dogecoin-mainnet': [nativeRow('DWalletB', 'DOGE', '200000000')] });
        });
        expect(await screen.findByText(/^DOGE\b/)).toBeTruthy();
        expect(screen.queryByText(/^BTC\b/)).toBeNull();
    });
});

describe('Home under a partial balance outage', () => {
    it('says the balance is unavailable when the only address read fails, not 0', async () => {
        const messaging = baseMessaging({
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [unreadRow('bc1qunread')] }),
        });
        render(tree(messaging, WALLET_A.id, 'account-a'));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await waitFor(() => expect(document.body.textContent).toMatch(/Balance unavailable/));
        expect(screen.queryByText('Fund your wallet')).toBeNull();
    });

    it('does not state a $0.00 headline over a balance it could not read', async () => {
        const messaging = baseMessaging({
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [unreadRow('bc1qunread')] }),
        });
        render(tree(messaging, WALLET_A.id, 'account-a'));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await act(async () => {});
        // The row says the number is unknown, so the headline cannot be a
        // confident zero and the tabs cannot ask the user to fund a wallet
        // whose balance was never read.
        expect(document.body.textContent).not.toMatch(/\$0\.00(?!\d)/);
        expect(screen.queryByText('Fund your wallet')).toBeNull();
    });

    it('marks the headline as incomplete when one address of a chain fails', async () => {
        const messaging = baseMessaging({
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [nativeRow('bc1qgood', 'BTC', '100000000', 50000), unreadRow('bc1qunread')],
            }),
        });
        render(tree(messaging, WALLET_A.id, 'account-a'));
        await waitFor(() => expect(document.body.textContent).toMatch(/At least/));
        // Rows and headline agree: the headline is a floor, not a total.
        const hero = screen.getByText(/balance$/i, { selector: 'section[aria-labelledby] span' }).closest('section');
        expect(hero.textContent).toMatch(/At least \$50,000\.00/);
    });

    it('keeps the last complete rows when a refresh read 500s on one chain', async () => {
        writeBalanceCache(WALLET_A.id, 'account-a', {
            balances: { [CHAIN]: [nativeRow('bc1qgood', 'BTC', '100000000')] },
            activeByChain: {},
            fetchedAt: Date.now() - 60_000,
        });
        const messaging = baseMessaging({
            listWallets: vi.fn().mockResolvedValue([WALLET_A]),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{ address: 'bc1qgood', balances: null, error: 'Explorer returned HTTP 500' }],
                'litecoin-mainnet': [nativeRow('ltc1qok', 'LTC', '300000000')],
            }),
        });
        render(tree(messaging, WALLET_A.id, 'account-a'));
        expect(await screen.findByText(/Showing saved balances/)).toBeTruthy();
        expect(screen.getByText(/^BTC\b/)).toBeTruthy();
        // The half-answered read does not replace the saved rows or the cache.
        expect(screen.queryByText(/^LTC\b/)).toBeNull();
        expect(JSON.stringify(readBalanceCache(WALLET_A.id, 'account-a')?.balances)).not.toContain('ltc1qok');
    });
});
