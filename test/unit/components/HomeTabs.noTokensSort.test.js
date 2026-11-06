// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

const mocks = vi.hoisted(() => ({
    getNativePricesRequest: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: {}, loading: false }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({}),
    useTokenFiatRates: () => ({}),
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const descriptors = new Map([
    ['bitcoin-mainnet', {
        id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Zeta coin',
        color: '#111111', networkKind: 'mainnet',
    }],
    ['litecoin-mainnet', {
        id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Alpha coin',
        color: '#222222', networkKind: 'mainnet',
    }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((descriptor) => descriptor.coin === coin),
    all: () => [...descriptors.values()],
};

function mount() {
    return render(createElement(HomeTabs, {
        chainRegistry,
        balances: {
            'bitcoin-mainnet': [{
                address: 'btc-address',
                balances: {
                    native: { tick: 'BTC', quantity: '1', divisibility: 0, fiatRate: 100 },
                    tokens: [
                        { tick: 'ZED', displayName: 'Zulu token', quantity: '3', divisibility: 0, fiatRate: 1 },
                        { tick: 'BETA', displayName: 'Beta token', quantity: '1', divisibility: 0, fiatRate: 1 },
                        { tick: 'AAA', displayName: 'Alpha token', quantity: '999', divisibility: 0 },
                    ],
                },
            }],
            'litecoin-mainnet': [{
                address: 'ltc-address',
                balances: {
                    native: { tick: 'LTC', quantity: '3', divisibility: 0, fiatRate: 10 },
                    tokens: [],
                },
            }],
        },
        walletId: 'wallet-sort',
        networkFilter: 'all',
    }));
}

function renderedKeys() {
    return screen.queryAllByRole('listitem')
        .map((element) => element.dataset.balanceKey);
}

beforeEach(() => {
    localStorage.clear();
    mocks.getNativePricesRequest.mockReset();
    mocks.getNativePricesRequest.mockResolvedValue({ prices: {} });
});

afterEach(() => {
    cleanup();
});

describe('Home Tokens sorting', () => {
    it('does not show a sort control on Tokens', () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
    });

    it('keeps Tokens in value order despite a saved name sort', () => {
        localStorage.setItem('xc:balances:sort:wallet-sort', 'name');
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:ZED',
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:AAA',
        ]);
    });

    it('keeps the saved sort select working on Coins', () => {
        localStorage.setItem('xc:balances:sort:wallet-sort', 'name');
        mount();

        const sort = screen.getByRole('combobox', { name: 'Sort balances' });
        expect(sort).toHaveValue('name');
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'bitcoin-mainnet:BTC',
        ]);

        fireEvent.change(sort, { target: { value: 'value' } });
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:BTC',
            'litecoin-mainnet:LTC',
        ]);
    });
});
