// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    contractsBrowseAll,
    contractsForAddress,
    contractsForSource,
    depositsForAddress,
    withdrawalsForAddress,
} from '../../../packages/core/src/flows/contractQueries.js';

const cases = [
    {
        name: 'contractsForSource', query: contractsForSource, sdkMethod: 'getContracts',
        expectedArgs: ['wallet-address', 'source', { limit: 25 }], requiresAddress: true,
    },
    {
        name: 'contractsForAddress', query: contractsForAddress, sdkMethod: 'getContracts',
        expectedArgs: ['wallet-address', 'address', { limit: 25 }], requiresAddress: true,
    },
    {
        name: 'contractsBrowseAll', query: contractsBrowseAll, sdkMethod: 'getContracts',
        expectedArgs: [null, null, { limit: 25 }], requiresAddress: false,
    },
    {
        name: 'depositsForAddress', query: depositsForAddress, sdkMethod: 'getDeposits',
        expectedArgs: ['wallet-address', 'address', { limit: 25 }], requiresAddress: true,
    },
    {
        name: 'withdrawalsForAddress', query: withdrawalsForAddress, sdkMethod: 'getWithdrawals',
        expectedArgs: ['wallet-address', 'address', { limit: 25 }], requiresAddress: true,
    },
];

describe.each(cases)('$name', ({ name, query, sdkMethod, expectedArgs, requiresAddress }) => {
    it('rejects when required parameters are missing', async () => {
        const sdkRegistry = { get: vi.fn() };
        await expect(query({ chainId: 'chain', address: 'wallet-address' }))
            .rejects.toHaveProperty('message', `${name}: sdkRegistry is required`);
        await expect(query({ sdkRegistry, address: 'wallet-address' }))
            .rejects.toHaveProperty('message', `${name}: chainId is required`);
        if (requiresAddress) {
            await expect(query({ sdkRegistry, chainId: 'chain' }))
                .rejects.toHaveProperty('message', `${name}: address is required`);
        }
    });

    it('calls the SDK with the expected arguments and returns its result', async () => {
        const result = { data: [{ action_index: '123' }] };
        const sdk = { [sdkMethod]: vi.fn(async () => result) };
        const sdkRegistry = { get: vi.fn(() => sdk) };
        const actual = await query({
            sdkRegistry, chainId: 'chain',
            address: requiresAddress ? 'wallet-address' : undefined,
            opts: { limit: 25 },
        });
        expect(sdkRegistry.get).toHaveBeenCalledWith('chain');
        expect(sdk[sdkMethod]).toHaveBeenCalledWith(...expectedArgs);
        expect(actual).toBe(result);
    });
});
