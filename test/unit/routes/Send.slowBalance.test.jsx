// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Send with the device online but the wallet services unreachable: the
// balance reads hang while the reachability probe has not yet decided. The
// form shows after a short wait with "Balance unavailable" in its hint, not
// "Loading" until the probe reaches offline.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
const { Send } = await import('../../../packages/core/src/shared/routes/Send.jsx');

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function mountWithHangingReads() {
    let finishAddressRead = () => {};
    const balances = { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn(() => new Promise((resolve) => { finishAddressRead = () => resolve(balances); })),
        getWalletBalances: vi.fn(() => new Promise(() => {})),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', grace: { testSendThresholdSats: 0 } }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {} }),
    ));
    return { messaging, finishAddressRead: () => finishAddressRead() };
}

afterEach(() => cleanup());

describe('Send while the balance reads hang', () => {
    it('shows the form with "Balance unavailable" instead of Loading, and fills the hint when the read returns', async () => {
        const { finishAddressRead } = mountWithHangingReads();
        expect(await screen.findByText('Loading…')).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Send' })).toBeNull();

        expect(await screen.findByRole('form', { name: 'Send' }, { timeout: 4000 })).toBeInTheDocument();
        expect(screen.queryByText('Loading…')).toBeNull();
        expect(screen.getByText('Balance unavailable')).toBeInTheDocument();

        await act(async () => { finishAddressRead(); });
        await waitFor(() => expect(screen.getByText('1 BTC available')).toBeInTheDocument());
        expect(screen.queryByText('Balance unavailable')).toBeNull();
    });
});
