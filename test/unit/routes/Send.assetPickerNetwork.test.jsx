// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Send's Asset picker opens on the form's chain, and its network filter can
// widen to another chain (G63); picking an asset there moves Network and
// From to that chain (G62). Send once pinned the filter with no change
// handler, so choosing another network did nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';

const BTC_FROM = 'bc1qsendersendersendersendersendersendersa';
const DOGE_FROM = 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns';

const addr = (id, address, path) => ({ id, address, publicKey: '02ab', derivationPath: path, source: 'hd' });
const ADDRESSES = {
    [BTC]: [addr('addr-btc', BTC_FROM, "m/84'/0'/0'/0/0")],
    [DOGE]: [addr('addr-doge', DOGE_FROM, "m/44'/3'/0'/0/0")],
};
const ACTIVE = {
    [BTC]: { id: 'addr-btc', address: BTC_FROM },
    [DOGE]: { id: 'addr-doge', address: DOGE_FROM },
};
const NATIVE_TICK = { [BTC]: 'BTC', [DOGE]: 'DOGE' };
const WALLET_BALANCES = {
    [BTC]: [{
        address: BTC_FROM,
        balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
    }],
    [DOGE]: [{
        address: DOGE_FROM,
        balances: { native: { tick: 'DOGE', quantity: '100000000', divisibility: 8 }, tokens: [] },
    }],
};

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue(ACTIVE),
        getAddressBalances: vi.fn(async (chainId) => ({
            native: { tick: NATIVE_TICK[chainId] || 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        })),
        getWalletBalances: vi.fn().mockResolvedValue(WALLET_BALANCES),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            activeNetwork: 'mainnet',
            lastUsedChain: { mainnet: DOGE },
        }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
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
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {}, prefill: null }),
        ),
    );
}

const fromField = () => screen.getByLabelText('From address');

async function openAssetPicker() {
    fireEvent.click(screen.getByRole('button', { name: /^Asset: DOGE/ }));
    await screen.findByRole('button', { name: /^Select Dogecoin\b/ });
}

function chooseNetwork(name) {
    const trigger = screen.getByRole('button', { name: 'Filter coins and tokens' });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /^Filter by network/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Network' }))
        .getByRole('button', { name: `Select ${name}` }));
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('Send Asset picker network filter', () => {
    it('opens filtered to the form chain', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull();
    });

    it('choosing another network shows that chain\'s assets', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        chooseNetwork('Bitcoin');
        expect(await screen.findByRole('button', { name: /^Select Bitcoin\b/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Select Dogecoin\b/ })).toBeNull();
    });

    it('All networks shows every chain\'s assets', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        chooseNetwork('All networks');
        expect(await screen.findByRole('button', { name: /^Select Bitcoin\b/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Select Dogecoin\b/ })).toBeInTheDocument();
    });

    it('picking an asset on another network moves Network and From there', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        chooseNetwork('Bitcoin');
        fireEvent.click(await screen.findByRole('button', { name: /^Select Bitcoin\b/ }));

        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
        expect(screen.getByRole('button', { name: /^Asset: BTC on Bitcoin/ })).toBeInTheDocument();
    });

    it('reopens on the form chain after a filter change and Back', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        chooseNetwork('Bitcoin');
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));

        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await openAssetPicker();
        expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull();
    });
});
