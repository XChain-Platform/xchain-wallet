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
import { showHomeBalances } from '../../helpers/homeBalances.js';

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
        showHomeBalances('tokens');

        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
    });

    it('keeps Tokens in saved name order', () => {
        localStorage.setItem('xc:balances:sort:wallet-sort', 'name');
        mount();
        showHomeBalances('tokens');

        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:AAA',
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:ZED',
        ]);
    });

    it('applies the saved sort choice across coin and token lists', () => {
        localStorage.setItem('xc:balances:sort:wallet-sort', 'name');
        // Balances remembered as Coins on this wallet.
        localStorage.setItem('xc:balances:type:wallet-sort', 'coins');
        mount();

        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
        const panel = screen.getByRole('dialog', { name: 'Filter and sort' });
        const trigger = () => Array.from(panel.querySelectorAll('button[aria-haspopup="listbox"]'))
            .find((button) => /^Sort by (name|value)$/.test(button.textContent.trim()));
        expect(trigger().textContent.trim()).toBe('Sort by name');
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'bitcoin-mainnet:BTC',
        ]);

        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: /Sort by value/i }));
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:BTC',
            'litecoin-mainnet:LTC',
        ]);

        showHomeBalances('tokens');
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:ZED',
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:AAA',
        ]);
    });
});
