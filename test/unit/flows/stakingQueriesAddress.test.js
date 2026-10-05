// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';

import {
    delegationsForAddress,
    rewardsForAddress,
    stakesForAddress,
} from '../../../packages/core/src/flows/stakingQueries.js';

const cases = [
    ['stakesForAddress', stakesForAddress, 'getStakes'],
    ['delegationsForAddress', delegationsForAddress, 'getDelegations'],
    ['rewardsForAddress', rewardsForAddress, 'getValidatorRewards'],
];

describe.each(cases)('%s', (name, query, sdkMethod) => {
    it('resolves the chain client, forwards the query, and returns its result', async () => {
        const opts = { limit: 25, offset: 50 };
        const result = { data: [{ action_index: '123' }] };
        const sdk = { [sdkMethod]: vi.fn().mockResolvedValue(result) };
        const sdkRegistry = { get: vi.fn(() => sdk) };

        const actual = await query({
            sdkRegistry,
            chainId: 'bitcoin-regtest',
            address: 'wallet-address',
            opts,
        });

        expect(sdkRegistry.get).toHaveBeenCalledWith('bitcoin-regtest');
        expect(sdk[sdkMethod]).toHaveBeenCalledWith('wallet-address', 'address', opts);
        expect(actual).toBe(result);
    });

    it('surfaces the registry error when the chain has no client', async () => {
        const registryError = new Error('SDKRegistry: unknown chain "missing-chain"');
        const sdkRegistry = { get: vi.fn(() => { throw registryError; }) };

        await expect(query({
            sdkRegistry,
            chainId: 'missing-chain',
            address: 'wallet-address',
            opts: { limit: 25 },
        })).rejects.toBe(registryError);
        expect(sdkRegistry.get).toHaveBeenCalledWith('missing-chain');
    });
});
