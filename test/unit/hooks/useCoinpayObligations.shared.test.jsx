// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One scan per tree (rate-limits spec, M4 row 29 / C45). Home's resume cards
// and the shells' nav badge both want the same pending-COINPAY rows, and each
// `useCoinpayObligations` instance costs one explorer read PER ADDRESS per
// sweep, so two instances in one tree doubled the coinpay traffic.
//
// What is pinned here, counted at `getCoinpayObligationsForAddress` (the
// per-address explorer read, which is the cost the row exists to remove):
//   a) under a provider, the provider plus two consumers issue ONE read per
//      address, not three;
//   b) with no provider above it the shared hook still scans on its own, which
//      is what keeps the extension popup's Home working (it mounts no badge);
//   c) the provider's `refresh` reaches every consumer, so a manual re-scan is
//      not swallowed by the indirection.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const { messaging } = vi.hoisted(() => ({
    messaging: {
        getAddressesByChain: vi.fn(),
        getCoinpayObligationsForAddress: vi.fn(),
    },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

const { CoinpayObligationsProvider, useSharedCoinpayObligations } = await import(
    '../../../packages/core/src/shared/hooks/useCoinpayObligations.js');

const CHAIN = 'litecoin-regtest';
const ADDRS = ['mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi', 'mg8Jz5776UdyiYcBb9Z873NTozEiADRW5H'];
const POLL_MS = 60_000;

/** The per-address explorer read: one call per address per scan. */
const reads = () => messaging.getCoinpayObligationsForAddress.mock.calls.length;

function pendingRow(address) {
    return [{
        coinpay_status: 'pending_coinpay',
        payer_address: address,
        payee_address: 'payee1',
        action_index: '77',
        coin_amount: '0.5',
        expiration: String(Math.floor(Date.now() / 1000) + 3600),
    }];
}

/** A consumer that renders what it got, so identity can be asserted on screen. */
function Consumer({ label, walletId, accountId }) {
    const { obligations, refresh } = useSharedCoinpayObligations(walletId, accountId);
    return (
        <div>
            <span data-testid={`${label}-count`}>{obligations.length}</span>
            <button type="button" data-testid={`${label}-refresh`} onClick={refresh}>refresh</button>
        </div>
    );
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    messaging.getAddressesByChain.mockReset()
        .mockResolvedValue({ [CHAIN]: ADDRS.map((address) => ({ address })) });
    messaging.getCoinpayObligationsForAddress.mockReset()
        .mockImplementation(({ address }) => Promise.resolve(pendingRow(address)));
});

afterEach(() => { vi.useRealTimers(); });

describe('useSharedCoinpayObligations', () => {
    it('costs one read per address for the whole tree when a provider is mounted', async () => {
        render(
            <CoinpayObligationsProvider walletId="w1" accountId="a1" pollMs={POLL_MS}>
                <Consumer label="home" walletId="w1" accountId="a1" />
                <Consumer label="badge" walletId="w1" accountId="a1" />
            </CoinpayObligationsProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('home-count')).toHaveTextContent('2'));
        // Two addresses, one scan. Three instances scanning independently
        // (provider + two consumers) would be six.
        expect(reads()).toBe(ADDRS.length);
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(1);
        // Both consumers see the SAME rows, which is what makes the single
        // scan sufficient rather than merely cheaper.
        expect(screen.getByTestId('badge-count')).toHaveTextContent('2');
    });

    it('scans on its own when no provider is mounted above it', async () => {
        render(<Consumer label="home" walletId="w1" accountId="a1" />);

        await waitFor(() => expect(screen.getByTestId('home-count')).toHaveTextContent('2'));
        expect(reads()).toBe(ADDRS.length);
    });

    it('re-scans for every consumer when the provider refreshes', async () => {
        render(
            <CoinpayObligationsProvider walletId="w1" accountId="a1" pollMs={POLL_MS}>
                <Consumer label="home" walletId="w1" accountId="a1" />
                <Consumer label="badge" walletId="w1" accountId="a1" />
            </CoinpayObligationsProvider>,
        );
        await waitFor(() => expect(screen.getByTestId('home-count')).toHaveTextContent('2'));
        expect(reads()).toBe(ADDRS.length);

        // The refresh a consumer holds is the PROVIDER's refresh, so pressing
        // it moves the one instance every consumer reads.
        messaging.getCoinpayObligationsForAddress.mockImplementation(() => Promise.resolve([]));
        await act(async () => { screen.getByTestId('home-refresh').click(); });

        await waitFor(() => expect(screen.getByTestId('badge-count')).toHaveTextContent('0'));
        expect(reads()).toBe(ADDRS.length * 2);
        expect(screen.getByTestId('home-count')).toHaveTextContent('0');
    });
});
