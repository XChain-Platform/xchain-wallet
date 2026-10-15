// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// regression: on a real (non-demo) wallet Home showed "$0.00 USD" and
// "3 tokens not priced" for BTC, LTC and DOGE while the price oracle was
// healthy, because balance reads carry no price and Home never attached
// one. Send priced the same coins, since it asks the rate cache itself.
// The hero now gets the oracle rate on every native row, a zero balance
// with a known price counts as priced, and a coin without one is called a
// coin.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';
import { walletBalances } from '../../../packages/core/src/flows/balances.js';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;
const PRICE_BY_TICKER = { BTC: '80000', LTC: '90', DOGE: '0.2' };

// Fetch is held until `release()` so a test can see the unpriced state
// first and the priced state after the oracle answers.
function venue() {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: {
            bitcoin: 'https://explorer.test',
            litecoin: 'https://explorer.test',
            dogecoin: 'https://explorer.test',
        },
        fetch: async (url) => {
            calls.push(url);
            await gate;
            const m = /explorer\.test\/(BTC|LTC|DOGE)\/api\/price_snapshots\/FINALIZED\/status/.exec(url);
            if (!m) return { ok: false, status: 404, json: async () => ({}) };
            const t = m[1];
            return {
                ok: true,
                json: async () => ({ data: [{ coin_pair: `${t}/USD`, price: PRICE_BY_TICKER[t], block_timestamp: FRESH_TS }] }),
            };
        },
    });
    return { calls, release: () => release() };
}

function balancesOf(quantities) {
    const out = {};
    for (const [chainId, [tick, quantity]] of Object.entries(quantities)) {
        out[chainId] = [{
            address: `${chainId}-addr`,
            balances: { native: { tick, quantity, divisibility: 8 }, tokens: [] },
        }];
    }
    return out;
}

const ZERO_COINS = {
    'bitcoin-mainnet': ['BTC', '0'],
    'litecoin-mainnet': ['LTC', '0'],
    'dogecoin-mainnet': ['DOGE', '0'],
};

function mount({ balances, walletId = 'real-wallet-1', settings = {}, messaging: messagingOverride, ...props }) {
    const messaging = messagingOverride || { getSettings: vi.fn(async () => settings) };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HomeTabs
                chainRegistry={defaultRegistry()}
                balances={balances}
                walletId={walletId}
                networkFilter="all"
                {...props}
            />
        </MessagingProvider>,
    );
}

function hero() {
    return screen.getByRole('region', { name: 'Active address balance' });
}

beforeEach(() => {
    _resetPriceLookupForTests();
    clearDemoWalletId();
});
afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
    clearDemoWalletId();
});

describe('Home native rows on a real wallet', () => {
    it.each([
        ['testnet', 'bitcoin-testnet', 'TBTC'],
        ['regtest', 'bitcoin-regtest', 'RBTC'],
    ])('never polls a price source for %s holdings, before or after settings load', async (activeNetwork, chainId, networkCode) => {
        let resolveSettings;
        const settings = new Promise((resolve) => { resolveSettings = resolve; });
        const calls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://mainnet.test' },
            fetch: async (url) => {
                calls.push(url);
                return {
                    ok: true,
                    json: async () => ({ data: [
                        { coin_pair: 'BTC/USD', price: '80000', block_timestamp: FRESH_TS },
                    ] }),
                };
            },
        });
        mount({ balances: balancesOf({ [chainId]: [networkCode, '1'] }), settings });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toEqual([]);

        resolveSettings({ activeNetwork });
        await new Promise((resolve) => setTimeout(resolve, 20));
        // Test networks carry no fiat value, so nothing is priced at all.
        expect(calls).toEqual([]);
    });

    it('reaches no price source when the settings read fails', async () => {
        const calls = [];
        configureFiatRateSource({
            now: () => NOW,
            fetch: async (url) => {
                calls.push(url);
                return { ok: true, json: async () => ({ data: [] }) };
            },
        });
        mount({
            balances: balancesOf({ 'bitcoin-mainnet': ['BTC', '1'] }),
            messaging: { getSettings: vi.fn(async () => { throw new Error('settings unavailable'); }) },
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        // Without the privacy choice the CoinGecko fallback may be opted out.
        expect(calls).toEqual([]);
    });

    it('prices zero-balance coins from the oracle and drops the "not priced" note', async () => {
        const { calls, release } = venue();
        mount({ balances: balancesOf(ZERO_COINS) });

        // A zero holding has no fiat value to leave unpriced while rates load.
        expect(within(hero()).queryByText(/not priced/)).toBeNull();
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));

        release();
        await waitFor(() => expect(within(hero()).queryByText(/not priced/)).toBeNull());
        expect(within(hero()).getByText('$0.00')).toBeInTheDocument();
        expect(calls.some((u) => u.includes('/BTC/api/price_snapshots/FINALIZED/status'))).toBe(true);
    });

    it('shows price unavailable instead of zero while a funded coin price loads', async () => {
        const { release } = venue();
        mount({ balances: balancesOf({ 'bitcoin-mainnet': ['BTC', '50000000'] }) });

        expect(within(hero()).getByText('Price unavailable')).toBeInTheDocument();
        expect(within(hero()).queryByText('$0.00')).toBeNull();
        release();
        await waitFor(() => expect(within(hero()).getByText('$40,000.00')).toBeInTheDocument());
        expect(within(hero()).queryByText('Price unavailable')).toBeNull();
        expect(within(hero()).queryByText(/not priced/)).toBeNull();
    });
});

describe('Home test-network fiat', () => {
    const regtestBalances = {
        'bitcoin-regtest': [{
            address: 'bitcoin-regtest-addr',
            balances: {
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8, fiatRate: 70000 },
                tokens: [
                    { tick: 'EXAMPLE', quantity: '200000000', divisibility: 8, fiatRate: 0.5 },
                ],
            },
        }],
    };

    it('keeps fixture fiat in the demo hero, rows, and chart', async () => {
        markDemoWallet('demo-wallet-1');
        const messaging = {
            getSettings: vi.fn(async () => ({})),
            getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
        };
        mount({ balances: regtestBalances, walletId: 'demo-wallet-1', messaging });

        expect(within(hero()).getByText('$70,001.00')).toBeInTheDocument();
        expect(document.querySelector('[data-balance-key="bitcoin-regtest:BTC"]')).toHaveTextContent('$70,000.00');
        const chart = await screen.findByRole('img', { name: /Portfolio performance chart/ });
        expect(chart).toHaveAccessibleName(expect.stringMatching(/End \$70,001\.00 USD\./));

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(document.querySelector('[data-balance-key="bitcoin-regtest:EXAMPLE"]')).toHaveTextContent('$1.00');
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('strips fixture fiat and the chart from a real test-network wallet', () => {
        const messaging = {
            getSettings: vi.fn(async () => ({})),
            getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
        };
        mount({ balances: regtestBalances, walletId: 'real-wallet-1', messaging });

        expect(within(hero()).getByText('Test coins have no value')).toBeInTheDocument();
        expect(document.querySelector('[data-balance-key="bitcoin-regtest:BTC"]')).not.toHaveTextContent('$');
        expect(screen.queryByRole('region', { name: 'Portfolio performance' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(document.querySelector('[data-balance-key="bitcoin-regtest:EXAMPLE"]')).not.toHaveTextContent('$');
        expect(screen.getByRole('region', { name: 'Unpriced tokens' })).toBeInTheDocument();
        expect(messaging.getNativePricesRequest).not.toHaveBeenCalled();
    });
});

describe('Home token rows on a real wallet', () => {
    it('prices only the DEX-traded token, skips spam-looking dust, and keeps the count aligned', async () => {
        const calls = [];
        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async (url) => {
                calls.push(url);
                if (url.includes('/api/price_snapshots/')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: [{ coin_pair: 'BTC/USD', price: '80000', block_timestamp: FRESH_TS }],
                        }),
                    };
                }
                if (url.includes('/api/market/MARKET/BTC')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: [{
                                tick1: 'MARKET',
                                tick2: 'BTC',
                                tick1_price: '0.000001',
                                tick2_price: '1000000',
                                last_updated: FRESH_TS,
                            }],
                        }),
                    };
                }
                if (url.includes('/api/market/UNKNOWN/BTC')) {
                    return { ok: true, json: async () => ({ data: [] }) };
                }
                if (url.includes('/api/market/SPAM/BTC')) {
                    return {
                        ok: true,
                        json: async () => ({
                            data: [{
                                tick1: 'SPAM',
                                tick2: 'BTC',
                                tick1_price: '1',
                                tick2_price: '1',
                                last_updated: FRESH_TS,
                            }],
                        }),
                    };
                }
                return { ok: false, status: 404, json: async () => ({}) };
            },
        });
        mount({
            balances: {
                'bitcoin-mainnet': [{
                    address: 'bitcoin-mainnet-addr',
                    balances: {
                        tokens: [
                            { tick: 'MARKET', quantity: '100000000', divisibility: 8 },
                            { tick: 'UNKNOWN', quantity: '100000000', divisibility: 8 },
                            { tick: 'SPAM', quantity: '1', divisibility: 8 },
                        ],
                    },
                }],
            },
        });

        expect(within(hero()).getByText('3 tokens not priced')).toBeInTheDocument();
        expect(calls).toEqual([]);
        expect(calls.some((url) => url.includes('/api/market/MARKET/BTC'))).toBe(false);
        expect(document.body.textContent).not.toContain('$80,000.00');

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        await waitFor(() => expect(screen.getByText('$0.08 · DEX price')).toBeInTheDocument());
        expect(within(hero()).getByText('2 tokens not priced')).toBeInTheDocument();
        expect(within(hero()).getByText('$0.08')).toBeInTheDocument();
        expect(within(hero()).getByText(/Updated/)).toBeInTheDocument();
        const unpriced = screen.getByRole('region', { name: 'Unpriced tokens' });
        expect(unpriced.querySelector('[data-balance-key="bitcoin-mainnet:UNKNOWN"]')).toBeTruthy();
        expect(within(unpriced).queryByText('MARKET')).toBeNull();
        const unknown = document.querySelector('[data-balance-key="bitcoin-mainnet:UNKNOWN"]');
        expect(unknown.textContent).not.toContain('$');
        expect(calls.some((url) => url.includes('/api/market/MARKET/BTC'))).toBe(true);
        expect(calls.some((url) => url.includes('SPAM'))).toBe(false);

        // Leaving the Tokens tab keeps the known token value in the total and
        // sends no new price request.
        const callsBeforeCoins = calls.length;
        fireEvent.click(screen.getByRole('tab', { name: 'Coins' }));
        await act(async () => {});
        expect(within(hero()).getByText('$0.08')).toBeInTheDocument();
        expect(within(hero()).getByText('2 tokens not priced')).toBeInTheDocument();
        expect(calls).toHaveLength(callsBeforeCoins);
    });
});

describe('Home cold-load request budget', () => {
    function memCollection(rows) {
        return {
            list: async () => rows.map((row) => ({ ...row })),
            findBy: async (field, value) => rows.filter((row) => row[field] === value).map((row) => ({ ...row })),
        };
    }

    it('keeps a five-address, ten-token wallet at or below five requests before a token tab opens', async () => {
        const requests = [];
        const addresses = Array.from({ length: 5 }, (_, index) => `bc1qcold${index}`);
        const vault = {
            wallets: memCollection([{ id: 'wallet-cold', importedKeys: [] }]),
            accounts: memCollection([{ id: 'account-cold', walletId: 'wallet-cold' }]),
            addresses: memCollection(addresses.map((address, index) => ({
                id: `address-${index}`,
                accountId: 'account-cold',
                chain: 'bitcoin',
                network: 'mainnet',
                address,
                addressType: 'p2wpkh',
                derivationPath: `m/84'/0'/0'/0/${index}`,
                label: `Address ${index + 1}`,
            }))),
        };
        const sdk = {
            getBalancesBatch: vi.fn(async (batch) => {
                requests.push('balances-batch');
                return Object.fromEntries(batch.map((address, addressIndex) => [address, {
                    address: { balances: { confirmed: addressIndex === 0 ? '1.00000000' : '0.00000000' } },
                    balances: {
                        data: Array.from({ length: 2 }, (_, tokenIndex) => ({
                            tick: `TOKEN${addressIndex * 2 + tokenIndex + 1}`,
                            amount: '1',
                            decimals: 0,
                        })),
                    },
                    error: null,
                }]));
            }),
        };
        const registry = defaultRegistry();
        const balances = await walletBalances({
            vault,
            walletId: 'wallet-cold',
            chainRegistry: registry,
            sdkRegistry: { get: () => sdk },
            activeNetwork: 'mainnet',
        });
        expect(balances['bitcoin-mainnet']).toHaveLength(5);
        expect(new Set(balances['bitcoin-mainnet'].flatMap((entry) => (
            entry.balances.tokens.map((token) => token.tick)
        )))).toHaveProperty('size', 10);

        configureFiatRateSource({
            now: () => NOW,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async (url) => {
                requests.push('fiat-rate');
                if (url.includes('/api/market/')) {
                    return { ok: true, json: async () => ({ data: [] }) };
                }
                expect(url).toContain('/BTC/api/price_snapshots/FINALIZED/status');
                return {
                    ok: true,
                    json: async () => ({
                        data: [{ coin_pair: 'BTC/USD', price: '80000', block_timestamp: FRESH_TS }],
                    }),
                };
            },
        });
        const messaging = {
            getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
            getNativePricesRequest: vi.fn(async () => {
                requests.push('native-prices');
                return { prices: {} };
            }),
            verifyBalance: vi.fn(async () => {
                requests.push('balance-proof');
                return { status: 'verified' };
            }),
            getOwnedTokens: vi.fn(async () => {
                requests.push('owned-tokens');
                return [];
            }),
            getTokenInfo: vi.fn(async () => {
                requests.push('token-info');
                return null;
            }),
            getHoldersForToken: vi.fn(async () => {
                requests.push('token-holders');
                return [];
            }),
            getAddressHistory: vi.fn(async () => {
                requests.push('history');
                return [];
            }),
        };

        mount({
            balances,
            walletId: 'wallet-cold',
            messaging,
            verifyProofsEnabled: true,
        });
        // Home shares one native price request across the hero, chart and rows.
        await waitFor(() => expect(requests.filter((name) => name === 'native-prices').length).toBeGreaterThanOrEqual(1));
        await waitFor(() => expect(requests.filter((name) => name === 'fiat-rate')).toHaveLength(1));

        expect(requests.length).toBeLessThanOrEqual(5);
        expect(requests.filter((name) => name === 'balances-batch')).toHaveLength(1);
        expect(messaging.verifyBalance).not.toHaveBeenCalled();
        expect(messaging.getOwnedTokens).not.toHaveBeenCalled();
        expect(messaging.getTokenInfo).not.toHaveBeenCalled();
        expect(messaging.getHoldersForToken).not.toHaveBeenCalled();
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        await waitFor(() => expect(messaging.verifyBalance).toHaveBeenCalledTimes(10));
        await waitFor(() => expect(messaging.getOwnedTokens).toHaveBeenCalledTimes(5));
    });
});

describe('Home hidden-token totals', () => {
    it('excludes hidden rows from both the hero and portfolio chart', async () => {
        markDemoWallet('demo-wallet-1');
        mount({
            walletId: 'demo-wallet-1',
            hiddenKeys: new Set(['bitcoin-mainnet:HIDDEN']),
            balances: {
                'bitcoin-mainnet': [{
                    address: 'bitcoin-mainnet-addr',
                    balances: {
                        tokens: [
                            { tick: 'VISIBLE', quantity: '100', divisibility: 0, fiatRate: 1 },
                            { tick: 'HIDDEN', quantity: '200', divisibility: 0, fiatRate: 1 },
                        ],
                    },
                }],
            },
        });

        expect(within(hero()).getByText('$100.00')).toBeInTheDocument();
        const chart = await screen.findByRole('img', { name: /Portfolio performance chart/ });
        expect(chart).toHaveAccessibleName(expect.stringMatching(/End \$100\.00 USD\./));
        expect(hero()).not.toHaveTextContent('$300.00');

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByRole('button', { name: 'Show 1 hidden token' })).toBeInTheDocument();
    });
});

describe('TotalBalanceHero unpriced note', () => {
    const messaging = { getSettings: vi.fn(async () => ({})) };
    const renderHero = (rows) => render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TotalBalanceHero rows={rows} walletId="real-wallet-1" networkFilter="all" />
        </MessagingProvider>,
    );
    const native = (over) => ({ kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '0', divisibility: 8, fiatRate: null, ...over });

    it('shows no price or change warning for unpriced zero balances', () => {
        renderHero([native(), native({ chainId: 'litecoin-mainnet', tick: 'LTC' })]);
        expect(screen.queryByText(/not priced/)).toBeNull();
        expect(hero()).not.toHaveTextContent(/▲|▼|%/);
    });

    it('names coins and tokens apart', () => {
        renderHero([
            native({ quantity: '100' }),
            native({ kind: 'token', tick: 'XCP', quantity: '100' }),
            native({ kind: 'token', tick: 'PEPECASH', quantity: '100' }),
        ]);
        expect(screen.getByText('1 coin and 2 tokens not priced')).toBeInTheDocument();
    });
});
