// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's "Payment due" resume cards, after row 29 of the rate-limits spec.
//
// Before row 29 Home ran its OWN wallet-wide coinpay scan in `loadHomeData`, so
// every 20 s balance beat spent one explorer read per address re-fetching rows
// the nav badge's hook had already fetched. The cards now render the shared
// hook's rows instead. What is pinned here:
//   1. a card is rendered from the SHARED scan (mounted under the provider,
//      Home makes no scan of its own and still shows the row), and it hands
//      `onResumeCoinpay` the resume-ref shape CoinpayForm accepts;
//   2. the 20 s beat carries NO coinpay read: the balance poll fires twice and
//      the per-address coinpay read count does not move, because the only
//      coinpay cadence left is the hook's own 60 s one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoinpayObligationsProvider } from '../../../packages/core/src/shared/hooks/useCoinpayObligations.js';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const CHAIN = 'litecoin-regtest';
const ADDRS = ['mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi', 'mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H'];

function makeMessaging({ obligations = true } = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue(
            { [CHAIN]: ADDRS.map((address) => ({ address })) },
        ),
        getCoinpayObligationsForAddress: vi.fn().mockImplementation(({ address }) => Promise.resolve(
            obligations && address === ADDRS[0]
                ? [{
                    coinpay_status: 'pending_coinpay',
                    payer_address: address,
                    payee_address: 'payee1',
                    action_index: '77',
                    coin_amount: '0.5',
                    expiration: String(Math.floor(Date.now() / 1000) + 3600),
                }]
                : [],
        )),
    };
}

function mountHome(messaging, { withProvider, onResumeCoinpay } = {}) {
    const home = React.createElement(Home, {
        activeWalletId: WALLET.id,
        onResumeCoinpay,
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            withProvider
                ? React.createElement(
                    CoinpayObligationsProvider,
                    { walletId: WALLET.id, accountId: null },
                    home,
                )
                : home,
        ),
    );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Home renders its coinpay resume cards from the shared scan', () => {
    it('shows a card for a pending obligation the provider scanned, and resumes it', async () => {
        const messaging = makeMessaging();
        const onResumeCoinpay = vi.fn();
        mountHome(messaging, { withProvider: true, onResumeCoinpay });

        const card = await screen.findByText(/Payment due: pay 0\.5 to complete matched order #77/);
        // Two addresses, ONE scan: the provider's. A Home that still scanned
        // for itself would have made four reads here.
        expect(messaging.getCoinpayObligationsForAddress).toHaveBeenCalledTimes(ADDRS.length);

        act(() => { card.closest('button').click(); });
        expect(onResumeCoinpay).toHaveBeenCalledWith({
            chainId: CHAIN,
            address: ADDRS[0],
            orderMatchActionIndex: '77',
        });
    });

    it('reads no coinpay obligations on the 20 s balance poll', async () => {
        // Every timer is faked: the balance beat is what has to fire, and the
        // shared hook's own cadence (60 s) must NOT, so the two intervals have
        // to be driven apart rather than waited on.
        vi.useFakeTimers();
        const messaging = makeMessaging();
        // No provider: Home falls back to its own instance, which is the
        // extension popup's shape and the harder case - if a coinpay read can
        // ride the balance beat at all, it rides it here.
        mountHome(messaging);

        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        const afterMountBalances = messaging.getWalletBalances.mock.calls.length;
        const afterMountReads = messaging.getCoinpayObligationsForAddress.mock.calls.length;
        expect(afterMountBalances).toBeGreaterThan(0);
        expect(afterMountReads).toBe(ADDRS.length);

        // Two full balance beats, still inside the hook's 60 s window.
        await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });

        expect(messaging.getWalletBalances.mock.calls.length).toBe(afterMountBalances + 2);
        expect(messaging.getCoinpayObligationsForAddress.mock.calls.length).toBe(afterMountReads);
    });
});
