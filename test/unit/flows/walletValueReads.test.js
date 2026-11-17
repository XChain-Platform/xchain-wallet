// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The value chart's three platform reads: the two batch history routes
// (POST /history and POST /native_history, through the SDK's explorer
// transport until the SDK carries them) and the token price series
// (GET /price_history from the coin's mainnet explorer).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    WALLET_HISTORY_BATCH_MAX,
    walletHistoryBatch,
    walletNativeHistoryBatch,
} from '../../../packages/core/src/flows/walletValueReads.js';
import {
    PRICE_HISTORY_ASSETS_MAX,
    configureFiatRateSource,
    fetchPriceHistory,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { chainRegistry, memCollection } from '../background/_addressesByChainFixture.js';

const BTC = 'bitcoin-mainnet';
const HISTORY_PAGE = { amount_unit: 'base', addresses: ['a'], limit: 100, next_cursor: '7', actions: [] };
const NATIVE_PAGE = { transactions: [], cursor: null, history_from_height: 0, sync: { reorg_count: 0 } };

function registryWith(sdk) {
    return { get: vi.fn(() => sdk) };
}

afterEach(() => {
    _resetPriceLookupForTests();
});

describe('walletHistoryBatch', () => {
    it('posts one batch to /history through the SDK\'s explorer transport', async () => {
        const post = vi.fn(async () => HISTORY_PAGE);
        const answer = await walletHistoryBatch({
            sdkRegistry: registryWith({ explorer: { post } }), chainId: BTC,
            addresses: ['a', 'b'], before: '9', since: 100, limit: 100, extra: 'dropped',
        });
        expect(answer).toBe(HISTORY_PAGE);
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe('/history');
        expect(post.mock.calls[0][1]).toEqual({ addresses: ['a', 'b'], before: '9', since: 100, limit: 100 });
    });

    it('uses the SDK\'s own method when a later SDK carries it', async () => {
        const getHistoryBatch = vi.fn(async () => HISTORY_PAGE);
        const post = vi.fn();
        await walletHistoryBatch({ sdkRegistry: registryWith({ getHistoryBatch, explorer: { post } }), chainId: BTC, addresses: ['a'] });
        expect(getHistoryBatch).toHaveBeenCalledWith(['a'], {});
        expect(post).not.toHaveBeenCalled();
    });

    it('reaches the explorer through requireExplorer(), so an SDK without one fails with its own error', async () => {
        const post = vi.fn(async () => HISTORY_PAGE);
        await walletHistoryBatch({ sdkRegistry: registryWith({ requireExplorer: () => ({ post }) }), chainId: BTC, addresses: ['a'] });
        expect(post).toHaveBeenCalledTimes(1);
        const missing = Object.assign(new Error('Explorer not configured.'), { code: 'EXPLORER_NOT_CONFIGURED' });
        const requireExplorer = () => { throw missing; };
        await expect(walletNativeHistoryBatch({ sdkRegistry: registryWith({ requireExplorer }), chainId: BTC, addresses: ['a'] }))
            .rejects.toMatchObject({ code: 'EXPLORER_NOT_CONFIGURED' });
    });

    it('refuses an explorer that answers the POST with something else (an older explorer\'s JSON-RPC error)', async () => {
        const post = vi.fn(async () => ({ jsonrpc: '2.0', error: { code: -32600 } }));
        await expect(walletHistoryBatch({ sdkRegistry: registryWith({ explorer: { post } }), chainId: BTC, addresses: ['a'] }))
            .rejects.toMatchObject({ code: 'EXPLORER_BATCH_UNSUPPORTED' });
    });

    it('never sends more than 20 addresses or a non-string one', async () => {
        const post = vi.fn(async () => HISTORY_PAGE);
        const sdkRegistry = registryWith({ explorer: { post } });
        const many = Array.from({ length: WALLET_HISTORY_BATCH_MAX + 1 }, (_, i) => `a${i}`);
        await expect(walletHistoryBatch({ sdkRegistry, chainId: BTC, addresses: many })).rejects.toThrow(/at most 20/);
        await expect(walletHistoryBatch({ sdkRegistry, chainId: BTC, addresses: [42] })).rejects.toThrow(/non-empty string/);
        await expect(walletHistoryBatch({ sdkRegistry, chainId: BTC, addresses: [] })).rejects.toThrow(/non-empty array/);
        expect(post).not.toHaveBeenCalled();
    });
});

describe('walletNativeHistoryBatch', () => {
    it('posts one batch to /native_history with the tracker\'s paging fields', async () => {
        const post = vi.fn(async () => NATIVE_PAGE);
        await walletNativeHistoryBatch({
            sdkRegistry: registryWith({ explorer: { post } }), chainId: BTC,
            addresses: ['a'], cursor: 'c1', from_time: 5, from_height: 10, limit: 200,
        });
        expect(post.mock.calls[0][0]).toBe('/native_history');
        expect(post.mock.calls[0][1]).toEqual({ addresses: ['a'], cursor: 'c1', from_time: 5, from_height: 10, limit: 200 });
    });

    it('refuses a body without transactions', async () => {
        const post = vi.fn(async () => ({ error: 'nope' }));
        await expect(walletNativeHistoryBatch({ sdkRegistry: registryWith({ explorer: { post } }), chainId: BTC, addresses: ['a'] }))
            .rejects.toMatchObject({ code: 'EXPLORER_BATCH_UNSUPPORTED' });
    });
});

describe('host routes', () => {
    function host(sdk) {
        const settings = { async get() { return { schemaVersion: 1, activeNetwork: 'mainnet', privacy: {} }; }, async put() {} };
        return createBackgroundHost({
            vault: { wallets: memCollection(), accounts: memCollection(), addresses: memCollection(), signers: memCollection(), settings },
            chainRegistry,
            sdkRegistry: registryWith(sdk),
            signerPool: { get: () => null, has: () => false },
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
        });
    }

    it('serves history.walletBatch and history.nativeBatch from the batch reads', async () => {
        const post = vi.fn(async (path) => (path === '/history' ? HISTORY_PAGE : NATIVE_PAGE));
        const h = host({ explorer: { post } });
        const tokens = await h.handle({ type: 'history.walletBatch', request: { chainId: BTC, addresses: ['a'] } });
        const coins = await h.handle({ type: 'history.nativeBatch', request: { chainId: BTC, addresses: ['a'] } });
        expect(tokens.result).toEqual(HISTORY_PAGE);
        expect(coins.result).toEqual(NATIVE_PAGE);
        expect(post.mock.calls.map((c) => c[0])).toEqual(['/history', '/native_history']);
    });
});

describe('fetchPriceHistory', () => {
    it('reads every asset in one call on the coin\'s mainnet explorer, in USD, within the bucket ceiling', async () => {
        const urls = [];
        configureFiatRateSource({
            now: () => 2_000_000_000_000,
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async (url) => {
                urls.push(url);
                return { ok: true, json: async () => ({ series: [{ asset: 'PEPE', source: 'dex', quote: 'BTC', points: [] }], missing: ['RARE'], quote: 'BTC' }) };
            },
        });
        const answer = await fetchPriceHistory({ chainCoin: 'bitcoin', assets: ['BTC', 'PEPE', 'RARE'], interval: 'day', from: 0 });
        expect(answer.missing).toEqual(['RARE']);
        expect(urls).toHaveLength(1);
        const url = new URL(urls[0]);
        expect(url.origin + url.pathname).toBe('https://explorer.test/BTC/api/price_history');
        expect(url.searchParams.get('assets')).toBe('BTC,PEPE,RARE');
        expect(url.searchParams.get('fiat')).toBe('USD');
        const span = Number(url.searchParams.get('to')) - Number(url.searchParams.get('from'));
        expect(span / 86400).toBeLessThan(1000);
    });

    it('refuses more than 50 assets in one call', async () => {
        configureFiatRateSource({ explorerUrlByCoin: { bitcoin: 'https://explorer.test' }, fetch: vi.fn() });
        const assets = Array.from({ length: PRICE_HISTORY_ASSETS_MAX + 1 }, (_, i) => `T${i}`);
        await expect(fetchPriceHistory({ chainCoin: 'bitcoin', assets, interval: 'hour', from: 0 })).rejects.toThrow(/at most 50/);
    });
});
