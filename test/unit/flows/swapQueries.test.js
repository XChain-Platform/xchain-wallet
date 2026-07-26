// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-18 SWAP query passthroughs backing MySwapsView: cross-pair swaps by
// address, the authoritative swap_cancels feed, and per-swap detail.

import { describe, it, expect, vi } from 'vitest';
import {
    swapsForAddress,
    swapCancelsForAddress,
    swapDetail,
    swapLifecycleFor,
} from '../../../packages/core/src/flows/marketQueries.js';

function fakeRegistry(sdk) {
    return { get: vi.fn(() => sdk) };
}

describe('swap query passthroughs', () => {
    it('swapsForAddress queries getSwaps(addr, "address")', async () => {
        const sdk = { getSwaps: vi.fn(async () => ({ data: [] })) };
        await swapsForAddress({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'addr-1', opts: { limit: 3 } });
        expect(sdk.getSwaps).toHaveBeenCalledWith('addr-1', 'address', { limit: 3 });
    });

    it('swapCancelsForAddress queries getSwapCancels(addr, "address")', async () => {
        const sdk = { getSwapCancels: vi.fn(async () => ({ data: [] })) };
        await swapCancelsForAddress({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'addr-1' });
        expect(sdk.getSwapCancels).toHaveBeenCalledWith('addr-1', 'address', undefined);
    });

    it('swapDetail queries getAction(index)', async () => {
        const sdk = { getAction: vi.fn(async () => ({ state: { status: 'open' } })) };
        await swapDetail({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', actionIndex: 1841 });
        expect(sdk.getAction).toHaveBeenCalledWith('1841');
    });

    it('each validates its required args', async () => {
        await expect(swapsForAddress({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/address is required/);
        await expect(swapCancelsForAddress({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/address is required/);
        await expect(swapDetail({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/actionIndex is required/);
    });
});

// PC-21 trade lifecycle: swapLifecycleFor dispatches kind -> SDK method.
describe('swapLifecycleFor (PC-21)', () => {
    it('dispatches address-scoped kinds with type "address"', async () => {
        const sdk = {
            getSwapEdits: vi.fn(async () => ({ data: [] })),
            getSwapExpires: vi.fn(async () => ({ data: [] })),
            getSwapCancels: vi.fn(async () => ({ data: [] })),
        };
        const reg = fakeRegistry(sdk);
        await swapLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'edits', query: 'addr-1', opts: { limit: 3 } });
        expect(sdk.getSwapEdits).toHaveBeenCalledWith('addr-1', 'address', { limit: 3 });
        await swapLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'expires', query: 'addr-1' });
        expect(sdk.getSwapExpires).toHaveBeenCalledWith('addr-1', 'address', undefined);
        await swapLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'cancels', query: 'addr-1' });
        expect(sdk.getSwapCancels).toHaveBeenCalledWith('addr-1', 'address', undefined);
    });

    it('matches read the recent block feed with an empty query allowed', async () => {
        const sdk = { getSwapMatches: vi.fn(async () => ({ data: [] })) };
        await swapLifecycleFor({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', kind: 'matches' });
        expect(sdk.getSwapMatches).toHaveBeenCalledWith('', 'block', undefined);
    });

    it('requires a query for non-match kinds and rejects unknown kinds', async () => {
        await expect(swapLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'edits' }))
            .rejects.toThrow(/query is required/);
        await expect(swapLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'bogus', query: 'x' }))
            .rejects.toThrow(/unknown kind/);
    });
});
