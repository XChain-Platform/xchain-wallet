// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host flows behind the My orders and My swaps cancel and edit re-reads
// carry `fresh` to the explorer client: the cancel lists through their
// options, the offer detail and its expiry clock through explorer paths,
// since getAction(index) takes no options. Without it they read as before.

import { describe, it, expect, vi } from 'vitest';
import {
    orderCancelsForAddress,
    orderDetail,
    swapCancelsForAddress,
    swapDetail,
} from '../../../packages/core/src/flows/marketQueries.js';

const STATUS = { last_block: { BTC: 800 }, chain_tip: { BTC: 800 }, last_block_time: { BTC: 4_000 } };

function fakeSdk() {
    const sdk = {
        explorer: {
            coin: 'BTC',
            get: vi.fn(async (path) => (path === '/status' ? STATUS : { state: { status: 'open' } })),
        },
        getAction: vi.fn(async () => ({ state: { status: 'open' } })),
        getStatus: vi.fn(async () => STATUS),
        getOrderCancels: vi.fn(async () => ({ data: [] })),
        getSwapCancels: vi.fn(async () => ({ data: [] })),
    };
    return { sdk, sdkRegistry: { get: () => sdk } };
}

describe('market re-read flows carry fresh to the explorer client', () => {
    it.each([
        ['orderCancelsForAddress', orderCancelsForAddress, 'getOrderCancels'],
        ['swapCancelsForAddress', swapCancelsForAddress, 'getSwapCancels'],
    ])('%s lists fresh only when asked', async (_name, read, method) => {
        const { sdk, sdkRegistry } = fakeSdk();
        await read({ sdkRegistry, chainId: 'c', address: 'a', fresh: true });
        expect(sdk[method]).toHaveBeenLastCalledWith('a', 'address', { fresh: true });
        await read({ sdkRegistry, chainId: 'c', address: 'a' });
        expect(sdk[method]).toHaveBeenLastCalledWith('a', 'address', undefined);
    });

    it.each([
        ['orderDetail', orderDetail],
        ['swapDetail', swapDetail],
    ])('%s reads the offer and the clock fresh only when asked', async (_name, read) => {
        const { sdk, sdkRegistry } = fakeSdk();
        await read({ sdkRegistry, chainId: 'c', actionIndex: '7', fresh: true });
        expect(sdk.explorer.get).toHaveBeenCalledWith('/action/7', { fresh: true });
        expect(sdk.explorer.get).toHaveBeenCalledWith('/status', { noRetry: true, fresh: true });
        expect(sdk.getAction).not.toHaveBeenCalled();

        sdk.explorer.get.mockClear();
        await read({ sdkRegistry, chainId: 'c', actionIndex: '7' });
        expect(sdk.getAction).toHaveBeenCalledWith('7');
        expect(sdk.explorer.get.mock.calls.every(([, opts]) => !opts?.fresh)).toBe(true);
    });
});
