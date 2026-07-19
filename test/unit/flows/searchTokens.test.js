// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/searchTokens. Substring token search over one chain via
// sdk.getTokens. Normalizes the explorer's {data:[...]} envelope and the
// dev-mock's bare array, upper-cases ticks, clamps the limit to [1,50],
// and swallows failures into an empty list (the picker just shows fewer
// rows rather than an error).

import { describe, it, expect, vi } from 'vitest';
import { searchPlatformTokens } from '../../../packages/core/src/flows/searchTokens.js';

function mkRegistry(sdk) {
    return { get: () => sdk };
}

describe('flows/searchTokens searchPlatformTokens', () => {
    it('maps explorer rows to normalized hits (uppercased tick, string supplies)', async () => {
        const sdk = {
            getTokens: vi.fn(async () => ({
                data: [
                    { tick: 'pepecreature', supply: 1000, max_supply: 2000 },
                    { tick: 'PEPECASH', supply: null, max_supply: null },
                ],
            })),
        };
        const out = await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'pepe' });
        expect(out).toEqual([
            { tick: 'PEPECREATURE', totalSupply: '1000', maxSupply: '2000' },
            { tick: 'PEPECASH', totalSupply: null, maxSupply: null },
        ]);
    });

    it('accepts a bare array (dev-mock SDK) as well as an envelope', async () => {
        const sdk = { getTokens: async () => [{ tick: 'FOO', supply: 5, max_supply: 5 }] };
        const out = await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'f' });
        expect(out).toEqual([{ tick: 'FOO', totalSupply: '5', maxSupply: '5' }]);
    });

    it('trims the query and clamps the limit into [1,50]', async () => {
        const sdk = { getTokens: vi.fn(async () => []) };
        await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: '  pepe  ', limit: 999 });
        expect(sdk.getTokens).toHaveBeenCalledWith('pepe', 'token', { limit: 50 });
        await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'x', limit: 0 });
        expect(sdk.getTokens).toHaveBeenLastCalledWith('x', 'token', { limit: 20 });
        await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'x', limit: -3 });
        expect(sdk.getTokens).toHaveBeenLastCalledWith('x', 'token', { limit: 1 });
    });

    it('returns [] for a blank query without calling the SDK', async () => {
        const sdk = { getTokens: vi.fn(async () => [{ tick: 'FOO' }]) };
        expect(await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: '   ' })).toEqual([]);
        expect(sdk.getTokens).not.toHaveBeenCalled();
    });

    it('drops rows with no usable tick', async () => {
        const sdk = { getTokens: async () => [{ tick: '' }, { supply: 1 }, null, { tick: 'OK' }] };
        const out = await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'o' });
        expect(out).toEqual([{ tick: 'OK', totalSupply: null, maxSupply: null }]);
    });

    it('swallows a getTokens rejection into an empty list', async () => {
        const sdk = { getTokens: async () => { throw new Error('network down'); } };
        expect(await searchPlatformTokens({ sdkRegistry: mkRegistry(sdk), chainId: 'c', query: 'x' })).toEqual([]);
    });

    it('returns [] when the resolved SDK has no getTokens method', async () => {
        expect(await searchPlatformTokens({ sdkRegistry: mkRegistry({}), chainId: 'c', query: 'x' })).toEqual([]);
    });

    it('throws when sdkRegistry or chainId is missing', async () => {
        await expect(searchPlatformTokens({ chainId: 'c', query: 'x' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(searchPlatformTokens({ sdkRegistry: mkRegistry({}), query: 'x' })).rejects.toThrow(/chainId is required/);
    });
});
