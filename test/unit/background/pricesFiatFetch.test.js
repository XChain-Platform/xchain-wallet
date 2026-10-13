// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// prices.fiatFetch lets a page that may not fetch (the desktop renderer,
// connect-src 'self') get fiat rates through its host. It must fetch only
// the price lookup's own URLs, never act as a general fetch, and keep
// CoinGecko behind the price-data privacy switch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { isFiatRateSourceUrl } from '../../../packages/core/src/flows/priceLookup.js';
import { chainRegistry, memCollection } from './_addressesByChainFixture.js';

const ORACLE = 'https://explorer.xchain.io/BTC/api/price_snapshots/FINALIZED/status?limit=25';
const MARKET = 'https://explorer.xchain.io/LTC/api/market/PEPECASH/LTC';
const GECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

describe('isFiatRateSourceUrl', () => {
    it('accepts the lookup\'s oracle, market and CoinGecko URLs', () => {
        expect(isFiatRateSourceUrl(ORACLE)).toBe(true);
        expect(isFiatRateSourceUrl(MARKET)).toBe(true);
        expect(isFiatRateSourceUrl(GECKO)).toBe(true);
    });

    it('refuses everything else', () => {
        for (const url of [
            'http://explorer.xchain.io/BTC/api/price_snapshots/FINALIZED/status?limit=25',
            'https://explorer.xchain.io/BTC/api/address/bc1qxyz',
            'https://explorer.xchain.io/BTC/api/market/A/B/extra',
            'https://evil.example/BTC/api/price_snapshots/FINALIZED/status',
            'https://explorer.xchain.io.evil.example/BTC/api/price_snapshots/FINALIZED/status',
            'https://user:pw@explorer.xchain.io/BTC/api/price_snapshots/FINALIZED/status',
            'https://explorer.xchain.io:8443/BTC/api/price_snapshots/FINALIZED/status',
            'https://api.coingecko.com/api/v3/coins/bitcoin',
            'not a url',
            '',
        ]) {
            expect([url, isFiatRateSourceUrl(url)]).toEqual([url, false]);
        }
    });
});

function makeHost({ priceDataEnabled } = {}) {
    const vault = {
        wallets: memCollection(),
        accounts: memCollection(),
        addresses: memCollection(),
        signers: memCollection(),
        settings: {
            async get() {
                return { schemaVersion: 1, activeNetwork: 'mainnet', privacy: priceDataEnabled === undefined ? {} : { priceDataEnabled } };
            },
            async put() {},
        },
    };
    return createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

afterEach(() => vi.unstubAllGlobals());

describe('prices.fiatFetch host handler', () => {
    it('fetches an allowed URL and returns its JSON', async () => {
        const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [1] }) }));
        vi.stubGlobal('fetch', fetchSpy);
        const res = await makeHost().handle({ type: 'prices.fiatFetch', request: { url: ORACLE } });
        expect(res.ok).toBe(true);
        expect(res.result).toEqual({ ok: true, status: 200, body: { data: [1] } });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toBe(ORACLE);
    });

    it('refuses any other URL without fetching', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const res = await makeHost().handle({ type: 'prices.fiatFetch', request: { url: 'https://evil.example/x' } });
        expect(res.result).toMatchObject({ ok: false, error: 'not a fiat-rate source' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('keeps CoinGecko behind the price-data privacy switch', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const res = await makeHost({ priceDataEnabled: false }).handle({ type: 'prices.fiatFetch', request: { url: GECKO } });
        expect(res.result).toMatchObject({ ok: false, error: 'price data disabled' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes an HTTP error status back without a body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
        const res = await makeHost().handle({ type: 'prices.fiatFetch', request: { url: ORACLE } });
        expect(res.result).toEqual({ ok: false, status: 429 });
    });
});
