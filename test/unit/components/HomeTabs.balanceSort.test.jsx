// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

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

import {
    HomeTabs,
    sortBalanceRows,
} from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import {
    _resetPriceLookupForTests,
    configureFiatRateSource,
    getTokenFiatRate,
    refreshTokenFiatRate,
} from '../../../packages/core/src/flows/priceLookup.js';

const tabsCss = readFileSync(
    'packages/core/src/shared/components/HomeTabs.module.css',
    'utf8',
);

const descriptors = new Map([
    ['bitcoin-mainnet', {
        id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Zeta coin',
        color: '#111111', networkKind: 'mainnet',
    }],
    ['litecoin-mainnet', {
        id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Alpha coin',
        color: '#222222', networkKind: 'mainnet',
    }],
    ['dogecoin-mainnet', {
        id: 'dogecoin-mainnet', coin: 'dogecoin', displayName: 'Beta coin',
        color: '#333333', networkKind: 'mainnet',
    }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((descriptor) => descriptor.coin === coin),
    all: () => [...descriptors.values()],
};

function nativeBalance(tick, quantity, fiatRate) {
    return [{
        address: `${tick}-address`,
        balances: { native: { tick, quantity, divisibility: 0, fiatRate }, tokens: [] },
    }];
}

function mount(walletId = 'wallet-a') {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{
                'bitcoin-mainnet': nativeBalance('BTC', '1', 10),
                'litecoin-mainnet': nativeBalance('LTC', '3', 10),
                'dogecoin-mainnet': nativeBalance('DOGE', '2', 10),
            }}
            walletId={walletId}
            networkFilter="all"
        />,
    );
}

function mountTokens() {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={{
                'bitcoin-mainnet': [{
                    address: 'token-address',
                    balances: {
                        tokens: [
                            { tick: 'ZED', displayName: 'Zulu token', quantity: '3', divisibility: 0, fiatRate: 1 },
                            { tick: 'BETA', displayName: 'Beta token', quantity: '1', divisibility: 0, fiatRate: 1 },
                            { tick: 'AAA', displayName: 'Alpha token', quantity: '999', divisibility: 0 },
                        ],
                    },
                }],
            }}
            walletId="wallet-tokens"
            networkFilter="all"
        />,
    );
}

function renderedKeys() {
    return [...document.querySelectorAll('[data-balance-key]')]
        .map((element) => element.dataset.balanceKey);
}

beforeEach(() => {
    _resetPriceLookupForTests();
    localStorage.clear();
    mocks.getNativePricesRequest.mockReset();
    mocks.getNativePricesRequest.mockResolvedValue({
        prices: {
            'bitcoin-mainnet': { change24hPct: 5 },
            'litecoin-mainnet': { change24hPct: -1 },
            'dogecoin-mainnet': { change24hPct: 2 },
        },
    });
});

afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
});

describe('balance row sorting', () => {
    it('sorts exact values and changes descending, names ascending, and missing metrics last', () => {
        const rows = [
            { chainId: 'c:a', tick: 'AAA', displayName: 'Zulu', quantity: '9007199254740993', divisibility: 0, fiatRate: 1, change24hPct: -2 },
            { chainId: 'c:b', tick: 'BBB', displayName: 'Alpha', quantity: '9007199254740992', divisibility: 0, fiatRate: 1, change24hPct: 4 },
            { chainId: 'c:c', tick: 'CCC', displayName: 'Beta', quantity: '999999999999999999', divisibility: 0, fiatRate: null, change24hPct: null },
        ];

        expect(sortBalanceRows(rows, 'value').map((row) => row.tick)).toEqual(['AAA', 'BBB', 'CCC']);
        expect(sortBalanceRows(rows, 'name').map((row) => row.tick)).toEqual(['BBB', 'CCC', 'AAA']);
        expect(sortBalanceRows(rows, 'change').map((row) => row.tick)).toEqual(['BBB', 'AAA', 'CCC']);
    });

    it('keeps the populated sort control compact on the tab row at 360px', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        mount();

        const sort = screen.getByRole('combobox', { name: 'Sort balances' });
        const tablist = screen.getByRole('tablist', { name: 'Wallet view' });
        expect(sort).toBeVisible();
        expect(sort.closest('label')?.parentElement).toBe(tablist.parentElement);
        expect([...sort.options].map((option) => option.textContent))
            .toEqual(['Value', 'Name', '24h change']);
        const phoneRules = tabsCss.slice(tabsCss.indexOf('@media (max-width: 420px)'));
        expect(phoneRules).toMatch(/\.tabsRow\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
        expect(phoneRules).toMatch(/\.sortSelect\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;/s);
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'dogecoin-mainnet:DOGE',
            'bitcoin-mainnet:BTC',
        ]);

        await waitFor(() => expect(mocks.getNativePricesRequest).toHaveBeenCalled());
        fireEvent.change(sort, { target: { value: 'change' } });
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:BTC',
            'dogecoin-mainnet:DOGE',
            'litecoin-mainnet:LTC',
        ]);
    });

    it('does not render sort controls above the first-funding card at 360px', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        render(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{}}
                walletId="empty-wallet"
                networkFilter="all"
            />,
        );

        expect(screen.getByText('Fund your wallet')).toBeVisible();
        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByText('No tokens yet')).toBeVisible();
        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
    });

    it('restores the choice only for the wallet that saved it', () => {
        const first = mount('wallet-a');
        fireEvent.change(screen.getByLabelText('Sort balances'), { target: { value: 'name' } });
        expect(localStorage.getItem('xc:balances:sort:wallet-a')).toBe('name');
        first.unmount();

        mount('wallet-a');
        expect(screen.getByLabelText('Sort balances')).toHaveValue('name');
        cleanup();

        mount('wallet-b');
        expect(screen.getByLabelText('Sort balances')).toHaveValue('value');
    });

    it('keeps unpriced tokens after priced tokens in every sort mode', () => {
        mountTokens();
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        const sort = screen.getByLabelText('Sort balances');

        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:ZED',
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:AAA',
        ]);
        fireEvent.change(sort, { target: { value: 'name' } });
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:ZED',
            'bitcoin-mainnet:AAA',
        ]);
        fireEvent.change(sort, { target: { value: 'change' } });
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:ZED',
            'bitcoin-mainnet:AAA',
        ]);
    });
});

describe('token balance change data', () => {
    it('keeps a DEX market 24h change with the token fiat rate', async () => {
        const now = Date.parse('2026-10-13T12:00:00Z');
        configureFiatRateSource({
            now: () => now,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: vi.fn(async (url) => {
                if (url.includes('/api/price_snapshots/')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: [{
                                coin_pair: 'BTC/USD',
                                price: '100000',
                                block_timestamp: Math.floor(now / 1000),
                            }],
                        }),
                    };
                }
                return {
                    ok: true,
                    json: async () => ({
                        data: [{
                            tick1: 'PEPECASH',
                            tick2: 'BTC',
                            tick1_price: '0.00000020',
                            tick1_24hr_change: '-3.5',
                            last_updated: Math.floor(now / 1000),
                        }],
                    }),
                };
            }),
        });

        await refreshTokenFiatRate({
            chainCoin: 'bitcoin',
            tick: 'PEPECASH',
            nativeTicker: 'BTC',
        });

        expect(getTokenFiatRate({ chainCoin: 'bitcoin', tick: 'PEPECASH' }))
            .toMatchObject({ rate: 0.02, change24hPct: -3.5 });
    });
});
