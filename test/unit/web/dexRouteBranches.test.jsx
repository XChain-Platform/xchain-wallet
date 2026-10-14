// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDexRoute } from '../../../packages/web/src/surfaces/dex.jsx';

const walletViews = [
    'markets',
    'markets-picker',
    'market',
    'swap',
    'create-order',
    'my-orders',
    'my-swaps',
    'cross-chain-swap',
    'cross-chain-order',
];

function makeContext(overrides = {}) {
    return {
        activeWalletId: 'wallet-1',
        activeAccountId: null,
        marketsAsset: { chainId: 'bitcoin-mainnet', tick: 'BTC' },
        setMarketsAsset: vi.fn(),
        activeMarket: { chainId: 'bitcoin-mainnet', tick1: 'BTC', tick2: 'XCP' },
        setActiveMarket: vi.fn(),
        setUnlockedView: vi.fn(),
        setDispenserRef: vi.fn(),
        formBack: vi.fn(),
        ...overrides,
    };
}

describe('DEX route branches', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects wallet-gated and unknown views while leaving activity public', () => {
        for (const view of walletViews) {
            expect(renderDexRoute(view, makeContext({ activeWalletId: null, activeMarket: null }))).toBeNull();
        }
        expect(renderDexRoute('unknown', makeContext())).toBeNull();
        expect(renderDexRoute('market-activity', makeContext({ activeWalletId: null }))).not.toBeNull();
    });

    it('wires markets navigation and selection callbacks', () => {
        const ctx = makeContext();
        const markets = renderDexRoute('markets', ctx);
        markets.props.onChangeAsset();
        markets.props.onOpenMarket('litecoin-mainnet', 'LTC', 'XCP');
        markets.props.onBack();

        expect(ctx.setActiveMarket).toHaveBeenCalledWith({ chainId: 'litecoin-mainnet', tick1: 'LTC', tick2: 'XCP' });
        expect(ctx.setUnlockedView.mock.calls.map(([view]) => view)).toEqual(['markets-picker', 'market', 'home']);

        const picker = renderDexRoute('markets-picker', ctx);
        expect(picker.props.accountId).toBeUndefined();
        picker.props.onSelect({ chainId: 'dogecoin-mainnet', tick: 'DOGE', displayName: 'Dogecoin', kind: 'native' });
        picker.props.onBack();
        expect(ctx.setMarketsAsset).toHaveBeenCalledWith({
            chainId: 'dogecoin-mainnet',
            tick: 'DOGE',
            displayName: 'Dogecoin',
            kind: 'native',
        });

        const accountPicker = renderDexRoute('markets-picker', makeContext({ activeAccountId: 'account-1' }));
        expect(accountPicker.props.accountId).toBe('account-1');
    });

    it('wires the selected market callbacks', () => {
        const ctx = makeContext();
        const market = renderDexRoute('market', ctx);
        market.props.onSwap();
        market.props.onBack();

        expect(ctx.setActiveMarket).toHaveBeenNthCalledWith(1, {
            chainId: 'bitcoin-mainnet',
            tick1: 'XCP',
            tick2: 'BTC',
        });
        expect(ctx.setActiveMarket).toHaveBeenNthCalledWith(2, null);
        expect(ctx.setUnlockedView).toHaveBeenCalledWith('markets');
    });

    it('wires form, order, and swap routes', () => {
        const ctx = makeContext();
        renderDexRoute('swap', ctx).props.onBack();
        renderDexRoute('cross-chain-swap', ctx).props.onBack();
        renderDexRoute('create-order', ctx).props.onManageOrders();
        renderDexRoute('create-order', ctx).props.onBack();
        renderDexRoute('cross-chain-order', ctx).props.onManageOrders();
        renderDexRoute('cross-chain-order', ctx).props.onBack();
        renderDexRoute('my-orders', ctx).props.onBack();
        renderDexRoute('my-orders', ctx).props.onCreateOrder();
        renderDexRoute('my-swaps', ctx).props.onBack();
        renderDexRoute('my-swaps', ctx).props.onCreateSwap();

        expect(ctx.formBack).toHaveBeenCalledTimes(4);
        expect(ctx.setUnlockedView.mock.calls.map(([view]) => view)).toEqual([
            'my-orders',
            'my-orders',
            'home',
            'create-order',
            'home',
            'swap',
        ]);
    });

    it('opens a dispenser from public market activity', () => {
        const ctx = makeContext({ activeWalletId: null });
        const activity = renderDexRoute('market-activity', ctx);
        activity.props.onOpenDispenser('dogecoin-mainnet', '900000.1');
        activity.props.onBack();

        expect(ctx.setDispenserRef).toHaveBeenCalledWith({
            chainId: 'dogecoin-mainnet',
            actionIndex: '900000.1',
            origin: 'explorer',
        });
        expect(ctx.setUnlockedView.mock.calls.map(([view]) => view)).toEqual(['dispenser-detail', 'home']);
    });
});
