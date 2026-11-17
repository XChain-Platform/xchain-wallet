// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Balances list prices every token in the default All types view, and
// its price reads follow the chains, never the tokens (Data Access rule): per
// coin family one oracle snapshot read, shared with the coin's own refresh,
// and one read of every market against the coin. The count at 50 tokens
// equals the count at 5. The value chart adds one price-history read per
// chain for the held tokens and the coin, 50 assets a call, so 50 tokens
// (51 assets with the coin) take two. The real HomeTabs, hooks and price lookup run; only
// fetch and the wallet's messaging are counted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';
import { clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';
import { clearWalletHistoryStore } from '../../../packages/core/src/shared/hooks/useWalletHistory.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;

const tickAt = (i) => `TOKEN${String(i).padStart(3, '0')}`;

// One whole unit of each token on one mainnet address beside 1 BTC. TOKEN000
// has its own oracle pair; every other token trades against BTC.
function balancesWith(tokenCount) {
    return {
        'bitcoin-mainnet': [{
            address: 'bc1qbulkprices',
            balances: {
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: Array.from({ length: tokenCount }, (_, i) => ({
                    tick: tickAt(i),
                    quantity: '100000000',
                    divisibility: 8,
                })),
            },
        }],
    };
}

function venue(tokenCount) {
    const urls = [];
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        fetch: async (url) => {
            urls.push(url);
            if (url.includes('/BTC/api/price_snapshots/FINALIZED/status')) {
                return {
                    ok: true,
                    json: async () => ({ data: [
                        { coin_pair: 'BTC/USD', price: '80000', block_timestamp: FRESH_TS },
                        { coin_pair: `${tickAt(0)}/USD`, price: '2', block_timestamp: FRESH_TS },
                    ] }),
                };
            }
            if (url.includes('/BTC/api/markets/BTC')) {
                // The explorer orients each row with the asked tick second.
                const data = Array.from({ length: tokenCount - 1 }, (_, i) => ({
                    tick1: tickAt(i + 1),
                    tick2: 'BTC',
                    tick1_price: '0.000001',
                    tick2_price: '1000000',
                    last_updated: FRESH_TS,
                }));
                return { ok: true, json: async () => ({ data, total: data.length }) };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
    });
    return urls;
}

async function readsAt(tokenCount) {
    _resetPriceLookupForTests();
    const urls = venue(tokenCount);
    const messaging = {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
        verifyBalance: vi.fn(async () => ({ status: 'verified' })),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HomeTabs
                chainRegistry={defaultRegistry()}
                balances={balancesWith(tokenCount)}
                walletId={`wallet-bulk-${tokenCount}`}
                networkFilter="all"
                verifyProofsEnabled
            />
        </MessagingProvider>,
    );
    const row = (i) => document.querySelector(`[data-balance-key="bitcoin-mainnet:${tickAt(i)}"]`);
    // The default Type is All types: coins and tokens in one list, every
    // token priced there without narrowing the list to Tokens.
    await waitFor(() => expect(row(tokenCount - 1)?.textContent).toContain('$0.08'));
    await waitFor(() => expect(row(0)?.textContent).toContain('$2.00'));
    // Let any trailing effect settle before counting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reads = {
        snapshot: urls.filter((u) => u.includes('/api/price_snapshots/')).length,
        markets: urls.filter((u) => u.includes('/api/markets/')).length,
        priceHistory: urls.filter((u) => u.includes('/api/price_history?')).length,
        singleMarket: urls.filter((u) => u.includes('/api/market/')).length,
        total: urls.length,
        nativePrices: messaging.getNativePricesRequest.mock.calls.length,
        // No bulk proof route exists, so proofs stay off outside Tokens.
        proofs: messaging.verifyBalance.mock.calls.length,
    };
    view.unmount();
    return reads;
}

beforeEach(() => {
    _resetPriceLookupForTests();
    clearWalletHistoryStore();
    clearDemoWalletId();
});

afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
    globalThis.localStorage?.clear();
});

describe('Home Balances token prices', () => {
    it('reads the same count at 5 and 50 tokens: one snapshot and one markets read, none per token', async () => {
        const five = await readsAt(5);
        const fifty = await readsAt(50);

        expect(five).toEqual({ snapshot: 1, markets: 1, priceHistory: 1, singleMarket: 0, total: 3, nativePrices: 1, proofs: 0 });
        expect(fifty).toEqual({ ...five, priceHistory: 2, total: 4 });
    });
});
