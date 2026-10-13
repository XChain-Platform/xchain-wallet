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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

        // Before the oracle answers the coins are unpriced, and named as coins.
        expect(within(hero()).getByText('3 coins not priced')).toBeInTheDocument();
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));

        release();
        await waitFor(() => expect(within(hero()).queryByText(/not priced/)).toBeNull());
        expect(within(hero()).getByText('$0.00')).toBeInTheDocument();
        expect(calls.some((u) => u.includes('/BTC/api/price_snapshots/FINALIZED/status'))).toBe(true);
    });

    it('sums a funded coin at the oracle rate', async () => {
        const { release } = venue();
        mount({ balances: balancesOf({ 'bitcoin-mainnet': ['BTC', '50000000'] }) });
        release();
        await waitFor(() => expect(within(hero()).getByText('$40,000.00')).toBeInTheDocument());
        expect(within(hero()).queryByText(/not priced/)).toBeNull();
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

    it('shows no note when every row has a rate, even at zero balance', () => {
        renderHero([native({ fiatRate: 80000 }), native({ chainId: 'litecoin-mainnet', tick: 'LTC', fiatRate: 90 })]);
        expect(screen.queryByText(/not priced/)).toBeNull();
    });

    it('names coins and tokens apart', () => {
        renderHero([
            native(),
            native({ kind: 'token', tick: 'XCP', quantity: '100' }),
            native({ kind: 'token', tick: 'PEPECASH', quantity: '100' }),
        ]);
        expect(screen.getByText('1 coin and 2 tokens not priced')).toBeInTheDocument();
    });
});
