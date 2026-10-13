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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

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

function mount({ balances, walletId = 'real-wallet-1', settings = {} }) {
    const messaging = { getSettings: vi.fn(async () => settings) };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HomeTabs
                chainRegistry={defaultRegistry()}
                balances={balances}
                walletId={walletId}
                networkFilter="all"
            />
        </MessagingProvider>,
    );
}

function hero() {
    return screen.getByRole('region', { name: 'Active address balance' });
}

beforeEach(() => _resetPriceLookupForTests());
afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
});

describe('Home native rows on a real wallet', () => {
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

describe('Home token rows on a real wallet', () => {
    it('prices only the DEX-traded token and keeps the count aligned with the rows', async () => {
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
                        ],
                    },
                }],
            },
        });

        expect(within(hero()).getByText('2 tokens not priced')).toBeInTheDocument();
        await waitFor(() => expect(within(hero()).getByText('1 token not priced')).toBeInTheDocument());
        expect(within(hero()).getByText('$0.08')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('$80,000.00');

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByText('$0.08 · DEX price')).toBeInTheDocument();
        const unknown = document.querySelector('[data-balance-key="bitcoin-mainnet:UNKNOWN"]');
        expect(unknown.textContent).not.toContain('$');
        expect(calls.some((url) => url.includes('/api/market/MARKET/BTC'))).toBe(true);
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
