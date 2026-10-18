// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import * as queries from '../../../packages/core/src/flows/marketQueries.js';

function registryFor(sdk) {
    return { get: vi.fn(() => sdk) };
}

const tokenQueries = [
    ['ordersForToken', 'getOrders', 'token'],
    ['swapsForToken', 'getSwaps', 'token'],
    ['historyForToken', 'getHistory', 'token'],
];

describe('market query uncovered branches', () => {
    it('validates and forwards the market list', async () => {
        await expect(queries.getMarkets({ chainId: 'chain' })).rejects.toThrow('sdkRegistry is required');
        await expect(queries.getMarkets({ sdkRegistry: {} })).rejects.toThrow('chainId is required');
        const sdk = { getMarkets: vi.fn(async () => ['market']) };
        await expect(queries.getMarkets({ sdkRegistry: registryFor(sdk), chainId: 'chain', tick: 'AAA' }))
            .resolves.toEqual(['market']);
        expect(sdk.getMarkets).toHaveBeenCalledWith('AAA');
    });

    it.each([
        ['getMarket', 'getMarket'],
        ['getMarketHistory', 'getMarketHistory'],
        ['getMarketOrders', 'getMarketOrders'],
        ['getOrderbook', 'getOrderbook'],
    ])('%s validates both ticks and forwards them', async (name, method) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', tick1: 'A', tick2: 'B' }))
            .rejects.toThrow('sdkRegistry is required');
        await expect(query({ sdkRegistry: {}, tick1: 'A', tick2: 'B' }))
            .rejects.toThrow('chainId is required');
        await expect(query({ sdkRegistry: {}, chainId: 'chain', tick2: 'B' }))
            .rejects.toThrow('tick1 is required');
        await expect(query({ sdkRegistry: {}, chainId: 'chain', tick1: 'A' }))
            .rejects.toThrow('tick2 is required');

        const sdk = { [method]: vi.fn(async () => name) };
        const input = {
            sdkRegistry: registryFor(sdk), chainId: 'chain', tick1: 'A', tick2: 'B',
            address: 'owner', opts: { limit: 4 },
        };
        await expect(query(input)).resolves.toBe(name);
        const suffix = name === 'getMarketHistory' || name === 'getMarketOrders'
            ? ['owner', input.opts]
            : [];
        expect(sdk[method]).toHaveBeenCalledWith('A', 'B', ...suffix);
    });

    it.each(tokenQueries)('%s validates a ticker and forwards token scope', async (name, method, scope) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', tick: 'AAA' })).rejects.toThrow('sdkRegistry is required');
        await expect(query({ sdkRegistry: {}, tick: 'AAA' })).rejects.toThrow('chainId is required');
        await expect(query({ sdkRegistry: {}, chainId: 'chain' })).rejects.toThrow('tick is required');
        const sdk = { [method]: vi.fn(async () => name) };
        const opts = { limit: 2 };
        await expect(query({ sdkRegistry: registryFor(sdk), chainId: 'chain', tick: 'AAA', opts }))
            .resolves.toBe(name);
        expect(sdk[method]).toHaveBeenCalledWith('AAA', scope, opts);
    });

    it.each([
        ['ordersForAddress', 'getOrders'],
        ['orderCancelsForAddress', 'getOrderCancels'],
        ['swapsForAddress', 'getSwaps'],
        ['swapCancelsForAddress', 'getSwapCancels'],
    ])('%s validates address context', async (name, method) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', address: 'owner' })).rejects.toThrow('sdkRegistry is required');
        await expect(query({ sdkRegistry: {}, address: 'owner' })).rejects.toThrow('chainId is required');
        await expect(query({ sdkRegistry: {}, chainId: 'chain' })).rejects.toThrow('address is required');
        const sdk = { [method]: vi.fn(async () => name) };
        await expect(query({ sdkRegistry: registryFor(sdk), chainId: 'chain', address: 'owner' }))
            .resolves.toBe(name);
    });

    it.each([
        ['orderDetail'],
        ['swapDetail'],
    ])('%s validates context and accepts numeric zero', async (name) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', actionIndex: '1' })).rejects.toThrow('sdkRegistry is required');
        await expect(query({ sdkRegistry: {}, actionIndex: '1' })).rejects.toThrow('chainId is required');
        await expect(query({ sdkRegistry: {}, chainId: 'chain', actionIndex: '' }))
            .rejects.toThrow('actionIndex is required');
        const sdk = { getAction: vi.fn(async () => name) };
        await expect(query({ sdkRegistry: registryFor(sdk), chainId: 'chain', actionIndex: 0 }))
            .resolves.toBe(name);
        expect(sdk.getAction).toHaveBeenCalledWith('0');
    });

    it.each([
        ['orderLifecycleFor', 'getOrderMatches'],
        ['swapLifecycleFor', 'getSwapMatches'],
    ])('%s validates context and honors an explicit type', async (name, method) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', kind: 'matches' })).rejects.toThrow('sdkRegistry is required');
        await expect(query({ sdkRegistry: {}, kind: 'matches' })).rejects.toThrow('chainId is required');
        const sdk = { [method]: vi.fn(async () => name) };
        await expect(query({
            sdkRegistry: registryFor(sdk), chainId: 'chain', kind: 'matches',
            query: 'block-1', type: 'height', opts: { limit: 1 },
        })).resolves.toBe(name);
        expect(sdk[method]).toHaveBeenCalledWith('block-1', 'height', { limit: 1 });
    });

    it('normalizes genesis response shapes and missing SDK methods', async () => {
        await expect(queries.genesisForToken({ chainId: 'chain', tick: 'AAA' }))
            .rejects.toThrow('sdkRegistry is required');
        await expect(queries.genesisForToken({ sdkRegistry: {}, tick: 'AAA' }))
            .rejects.toThrow('chainId is required');
        await expect(queries.genesisForToken({ sdkRegistry: {}, chainId: 'chain' }))
            .rejects.toThrow('tick is required');
        await expect(queries.genesisForToken({
            sdkRegistry: registryFor({}), chainId: 'chain', tick: 'AAA',
        })).resolves.toBeNull();

        for (const [rows, expected] of [
            [[{ id: 1 }, { id: 2 }], { id: 2 }],
            [{ data: [{ id: 3 }] }, { id: 3 }],
            [{ data: 'invalid' }, null],
            [[], null],
        ]) {
            const sdk = { getIssues: vi.fn(async () => rows) };
            await expect(queries.genesisForToken({
                sdkRegistry: registryFor(sdk), chainId: 'chain', tick: 'AAA',
            })).resolves.toEqual(expected);
        }
    });

    it('validates subtokens and handles old and current SDKs', async () => {
        await expect(queries.subtokensForTick({ chainId: 'chain', tick: 'AAA' }))
            .rejects.toThrow('sdkRegistry is required');
        await expect(queries.subtokensForTick({ sdkRegistry: {}, tick: 'AAA' }))
            .rejects.toThrow('chainId is required');
        await expect(queries.subtokensForTick({ sdkRegistry: {}, chainId: 'chain' }))
            .rejects.toThrow('tick is required');
        await expect(queries.subtokensForTick({
            sdkRegistry: registryFor({}), chainId: 'chain', tick: 'AAA',
        })).resolves.toEqual([]);

        const sdk = { getTokens: vi.fn(async () => ['AAA.CHILD']) };
        const opts = { limit: 5 };
        await expect(queries.subtokensForTick({
            sdkRegistry: registryFor(sdk), chainId: 'chain', tick: 'AAA', opts,
        })).resolves.toEqual(['AAA.CHILD']);
        expect(sdk.getTokens).toHaveBeenCalledWith('AAA', 'subtoken', opts);
    });
});
