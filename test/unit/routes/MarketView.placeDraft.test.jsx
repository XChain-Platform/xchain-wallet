// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A look at the order book, trades or history keeps the order typed on the
// Place tab, and a book row picked again after an edit still fills its price.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('lightweight-charts', () => {
    const stub = () => new Proxy(() => {}, {
        get: (_target, property) => (typeof property === 'symbol' || property === 'then' ? undefined : stub()),
        apply: () => stub(),
    });
    return { createChart: () => stub(), ColorType: { Solid: 'solid' }, CrosshairMode: {}, LineStyle: {}, PriceScaleMode: {} };
});

import { MarketView } from '../../../packages/core/src/shared/routes/MarketView.jsx';

const settle = () => act(() => new Promise((resolve) => { setTimeout(resolve, 50); }));

let saved;
beforeAll(() => {
    class Stub { observe() {} unobserve() {} disconnect() {} }
    saved = { ro: globalThis.ResizeObserver, io: globalThis.IntersectionObserver };
    globalThis.ResizeObserver = Stub;
    globalThis.IntersectionObserver = Stub;
});
afterAll(() => {
    globalThis.ResizeObserver = saved.ro;
    globalThis.IntersectionObserver = saved.io;
});
afterEach(cleanup);

const ADDRESS = { id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1' };

function freshMessaging() {
    return {
        getMarket: vi.fn(async () => ({ tick1: 'XCP', tick2: 'BTC' })),
        getMarketHistory: vi.fn(async () => []),
        getOrderbook: vi.fn(async () => ({ bids: [{ price: '0.0001', size: '5' }], asks: [{ price: '0.0002', size: '3' }] })),
        getAddressesByChain: vi.fn(async () => ({ 'bitcoin-mainnet': [ADDRESS] })),
        getActiveAddresses: vi.fn(async () => ({ 'bitcoin-mainnet': ADDRESS.id })),
        getWalletBalances: vi.fn(async () => ({})),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
        getTokenInfo: vi.fn(async () => ({ divisibility: 8 })),
    };
}

function mount() {
    return render(<MarketView walletId="wallet-1" chainId="bitcoin-mainnet" tick1="XCP" tick2="BTC" onBack={() => {}} />);
}

const tab = (name) => screen.getByRole('tab', { name });

describe('MarketView Place tab draft', () => {
    it('keeps the typed price and size across a look at the book', async () => {
        messaging = freshMessaging();
        mount();
        await settle();
        fireEvent.click(tab('Place'));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '0.00015' } });
        fireEvent.change(screen.getByLabelText('Size (XCP)'), { target: { value: '4' } });
        fireEvent.click(tab('Book'));
        await settle();
        fireEvent.click(tab('Place'));
        await settle();

        expect(screen.getByLabelText('Price (BTC)')).toHaveValue('0.00015');
        expect(screen.getByLabelText('Size (XCP)')).toHaveValue('4');
    });

    it('fills the price again when the same book row is picked after an edit', async () => {
        messaging = freshMessaging();
        mount();
        await settle();
        fireEvent.click(await screen.findByRole('button', { name: /^Pick sell ask price 0\.0002/ }));
        await settle();
        expect(screen.getByLabelText('Price (BTC)')).toHaveValue('0.0002');
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '0.5' } });
        fireEvent.click(tab('Book'));
        await settle();
        fireEvent.click(await screen.findByRole('button', { name: /^Pick sell ask price 0\.0002/ }));
        await settle();

        expect(screen.getByLabelText('Price (BTC)')).toHaveValue('0.0002');
    });

    it('shows a fresh Place form for the reversed pair when the pair flips on the Place tab', async () => {
        messaging = freshMessaging();
        function Harness() {
            const [pair, setPair] = React.useState(['XCP', 'BTC']);
            return (
                <MarketView
                    walletId="wallet-1"
                    chainId="bitcoin-mainnet"
                    tick1={pair[0]}
                    tick2={pair[1]}
                    onBack={() => {}}
                    onSwap={() => setPair(([a, b]) => [b, a])}
                />
            );
        }
        render(<Harness />);
        await settle();
        fireEvent.click(tab('Place'));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '0.00015' } });
        fireEvent.click(screen.getByRole('button', { name: /^Reverse/ }));
        await settle();

        expect(screen.getByLabelText('Price (XCP)')).toHaveValue('');
        expect(screen.getByLabelText('Size (BTC)')).toBeVisible();
    });

    it('does not read wallet balances before the Place tab opens', async () => {
        messaging = freshMessaging();
        mount();
        await settle();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });
});
