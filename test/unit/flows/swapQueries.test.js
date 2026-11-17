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

// My Swaps' list read: the swap pages, one edits read and the chain clock,
// never a read per swap, so the page's reads stay flat as its rows grow.
describe('swapsForAddress reads a fixed set whatever the row count', () => {
    const NOW = 2_000_000_000;

    function sdkWith(rowCount, edits = []) {
        const rows = Array.from({ length: rowCount }, (_, i) => ({
            action_index: String(5000 + i),
            source: 'owner',
            swap_status: 'open',
            expiration: NOW - 60,
            allow_list: null,
            block_list: null,
            status: 'valid',
        }));
        return {
            explorer: { coin: 'DOGE' },
            getSwaps: vi.fn(async () => ({ data: rows, total: rows.length })),
            getSwapEdits: vi.fn(async () => ({ data: edits, total: edits.length })),
            getAction: vi.fn(async () => ({ state: { status: 'open' } })),
            getStatus: vi.fn(async () => ({
                last_block: { DOGE: 10 }, chain_tip: { DOGE: 10 }, last_block_time: { DOGE: NOW },
            })),
        };
    }

    const readCounts = (sdk) => ({
        getSwaps: sdk.getSwaps.mock.calls.length,
        getSwapEdits: sdk.getSwapEdits.mock.calls.length,
        getAction: sdk.getAction.mock.calls.length,
        getStatus: sdk.getStatus.mock.calls.length,
    });

    it('makes the same reads for 2 rows as for 40 rows, with no detail read per swap', async () => {
        const small = sdkWith(2);
        const large = sdkWith(40);
        await swapsForAddress({ sdkRegistry: fakeRegistry(small), chainId: 'c', address: 'owner' });
        await swapsForAddress({ sdkRegistry: fakeRegistry(large), chainId: 'c', address: 'owner' });

        expect(readCounts(small)).toEqual({ getSwaps: 1, getSwapEdits: 1, getAction: 0, getStatus: 1 });
        expect(readCounts(large)).toEqual(readCounts(small));
    });

    it('overlays the latest valid edit as the row state and classifies expiry on it', async () => {
        const sdk = sdkWith(2, [
            { action_index: '6001', swap_action_index: '5000', expiration: NOW + 600, status: 'valid' },
            { action_index: '6003', swap_action_index: '5000', expiration: NOW + 3600, block_list: '77', status: 'valid' },
            // An invalid edit changes nothing.
            { action_index: '6004', swap_action_index: '5000', expiration: NOW + 9, status: 'invalid' },
        ]);
        const response = await swapsForAddress({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'owner' });
        const [edited, untouched] = response.data;

        expect(edited.state).toMatchObject({
            status: 'open', expiration: NOW + 3600, block_list: '77', expiry_status: 'open',
        });
        // The unedited swap keeps its creation expiration, already past the chain clock.
        expect(untouched.state).toMatchObject({ status: 'expired', expiration: NOW - 60, expiry_status: 'expired' });
    });

    it('keeps the creation terms when the edits read fails, and skips it for an empty list', async () => {
        const failing = sdkWith(1);
        failing.getSwapEdits = vi.fn(async () => { throw new Error('edits down'); });
        const response = await swapsForAddress({ sdkRegistry: fakeRegistry(failing), chainId: 'c', address: 'owner' });
        expect(response.data[0].state).toMatchObject({ expiration: NOW - 60 });

        const empty = sdkWith(0);
        await swapsForAddress({ sdkRegistry: fakeRegistry(empty), chainId: 'c', address: 'owner' });
        expect(empty.getSwapEdits).not.toHaveBeenCalled();
    });
});
