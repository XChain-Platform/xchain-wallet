// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
    getNativePricesRequest: vi.fn(),
    heroProps: { current: null },
    chartProps: { current: null },
    collectibleKeys: new Set(),
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: (props) => {
        mocks.heroProps.current = props;
        return null;
    },
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: (props) => {
        mocks.chartProps.current = props;
        return null;
    },
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: {}, loading: false }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => mocks.collectibleKeys,
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
    return screen.queryAllByRole('listitem')
        .map((element) => element.dataset.balanceKey);
}

beforeEach(() => {
    _resetPriceLookupForTests();
    localStorage.clear();
    mocks.getNativePricesRequest.mockReset();
    mocks.heroProps.current = null;
    mocks.chartProps.current = null;
    mocks.collectibleKeys.clear();
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
    it('shares one history-enabled native price response across the Home headline and chart', async () => {
        const prices = {
            'bitcoin-mainnet': { change24hPct: 1.4, sparkline: [100, 97.16] },
            'litecoin-mainnet': { change24hPct: -1, sparkline: [100, 99] },
            'dogecoin-mainnet': { change24hPct: 2, sparkline: [100, 102] },
        };
        mocks.getNativePricesRequest.mockResolvedValue({ prices });

        mount();

        await waitFor(() => expect(mocks.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: ['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet'],
            includeSparkline: true,
            fiatCurrency: 'USD',
        }));
        await waitFor(() => expect(mocks.heroProps.current.nativePriceMap).toBe(prices));
        expect(mocks.chartProps.current.nativePriceMap).toBe(prices);
        expect(mocks.getNativePricesRequest).toHaveBeenCalledTimes(1);
    });

    it('sorts exact values descending, names ascending, and missing values last', () => {
        const rows = [
            { chainId: 'c:a', tick: 'AAA', displayName: 'Zulu', quantity: '9007199254740993', divisibility: 0, fiatRate: 1, change24hPct: -2 },
            { chainId: 'c:b', tick: 'BBB', displayName: 'Alpha', quantity: '9007199254740992', divisibility: 0, fiatRate: 1, change24hPct: 4 },
            { chainId: 'c:c', tick: 'CCC', displayName: 'Beta', quantity: '999999999999999999', divisibility: 0, fiatRate: null, change24hPct: null },
        ];

        expect(sortBalanceRows(rows, 'value').map((row) => row.tick)).toEqual(['AAA', 'BBB', 'CCC']);
        expect(sortBalanceRows(rows, 'name').map((row) => row.tick)).toEqual(['BBB', 'CCC', 'AAA']);
        expect(sortBalanceRows(rows, 'change').map((row) => row.tick)).toEqual(['BBB', 'CCC', 'AAA']);
    });

    it.each([360, 400])('puts one filter and sort button after complete tab labels at %ipx', async (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        mount();

        const filter = screen.getByRole('button', { name: 'Filter and sort' });
        const tablist = screen.getByRole('tablist', { name: 'Wallet view' });
        expect(filter).toBeVisible();
        expect(filter.parentElement?.parentElement).toBe(tablist.parentElement);
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Coins', 'Tokens', 'NFTs', 'DeFi', 'Activity']);
        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
        expect(tablist.compareDocumentPosition(filter)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        fireEvent.click(filter);
        expect(screen.getByRole('radio', { name: 'Name' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Value' })).not.toBeChecked();

        const narrowRules = tabsCss.slice(
            tabsCss.indexOf('@media not all and (min-width: 600px)'),
            tabsCss.indexOf('/* ───── Tab panel'),
        );
        expect(narrowRules).toMatch(/\.tabsRow\s*>\s*\[role='tablist'\]\s*\{[^}]*width:\s*100%;/s);
        expect(narrowRules).not.toMatch(/flex-direction:\s*column/);
        expect(tabsCss).toMatch(/\.tabsRow\s+\[role='tab'\]\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'dogecoin-mainnet:DOGE',
            'bitcoin-mainnet:BTC',
        ]);

        fireEvent.click(screen.getByRole('radio', { name: 'Value' }));
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'dogecoin-mainnet:DOGE',
            'bitcoin-mainnet:BTC',
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
        expect(screen.queryByRole('button', { name: 'Filter and sort' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByText('No tokens yet')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Filter and sort' })).toBeNull();
    });

    it('restores the choice only for the wallet that saved it', () => {
        const first = mount('wallet-a');
        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Value' }));
        expect(localStorage.getItem('xc:balances:sort:wallet-a')).toBe('value');
        first.unmount();

        mount('wallet-a');
        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
        expect(screen.getByRole('radio', { name: 'Value' })).toBeChecked();
        cleanup();

        mount('wallet-b');
        fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
        expect(screen.getByRole('radio', { name: 'Name' })).toBeChecked();
    });

    it('sorts tokens by name by default and renders an unpriced token as zero fiat', () => {
        mountTokens();
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        expect(screen.queryByRole('combobox', { name: 'Sort balances' })).toBeNull();
        expect(renderedKeys()).toEqual([
            'bitcoin-mainnet:AAA',
            'bitcoin-mainnet:BETA',
            'bitcoin-mainnet:ZED',
        ]);
        expect(screen.getByText('$0.00')).toBeInTheDocument();
    });

    it('falls back to name for removed and unknown saved sort values', () => {
        localStorage.setItem('xc:balances:sort:wallet-a', 'change');
        mount('wallet-a');
        expect(renderedKeys()).toEqual([
            'litecoin-mainnet:LTC',
            'dogecoin-mainnet:DOGE',
            'bitcoin-mainnet:BTC',
        ]);
    });

    it('stacks an NFT ticker immediately under its name', () => {
        mocks.collectibleKeys.add('bitcoin-mainnet:AAA');
        mountTokens();
        fireEvent.click(screen.getByRole('tab', { name: 'NFTs' }));

        const name = screen.getByText('Alpha token');
        const ticker = screen.getByText('AAA');
        expect(name.tagName).toBe('DIV');
        expect(ticker.tagName).toBe('DIV');
        expect(name.nextElementSibling).toBe(ticker);
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
