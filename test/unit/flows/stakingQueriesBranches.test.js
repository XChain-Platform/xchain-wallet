// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import * as queries from '../../../packages/core/src/flows/stakingQueries.js';

const addressQueries = [
    ['stakesForAddress', 'getStakes'],
    ['delegationsForAddress', 'getDelegations'],
    ['rewardsForAddress', 'getValidatorRewards'],
    ['rewardClaimsForAddress', 'getCollects'],
    ['contractStakesForAddress', 'getContractStakes'],
    ['contractUnstakesForAddress', 'getContractUnstakes'],
    ['slashEventsForAddress', 'getSlashEvents'],
];

describe('staking query validation branches', () => {
    it.each(addressQueries)('%s validates its context and forwards address options', async (name, method) => {
        const query = queries[name];
        await expect(query({ chainId: 'chain', address: 'address' }))
            .rejects.toThrow(`${name}: sdkRegistry is required`);
        await expect(query({ sdkRegistry: {}, address: 'address' }))
            .rejects.toThrow(`${name}: chainId is required`);
        await expect(query({ sdkRegistry: {}, chainId: 'chain' }))
            .rejects.toThrow(`${name}: address is required`);

        const result = { data: [name] };
        const sdk = { [method]: vi.fn(async () => result) };
        const sdkRegistry = { get: vi.fn(() => sdk) };
        const opts = { limit: 7 };

        await expect(query({ sdkRegistry, chainId: 'chain', address: 'address', opts }))
            .resolves.toBe(result);
        expect(sdk[method]).toHaveBeenCalledWith('address', 'address', opts);
    });

    it.each([
        ['contractStakesForAddress', 'getContractStakes'],
        ['contractUnstakesForAddress', 'getContractUnstakes'],
        ['slashEventsForAddress', 'getSlashEvents'],
    ])('%s reports an older SDK without its method', async (name, method) => {
        const sdkRegistry = { get: vi.fn(() => ({})) };
        await expect(queries[name]({ sdkRegistry, chainId: 'chain', address: 'address' }))
            .rejects.toThrow(`sdk.${method} not yet available`);
    });

    it('validates chain-only queries before resolving the SDK', async () => {
        await expect(queries.validatorsForChain({ chainId: 'chain' }))
            .rejects.toThrow('validatorsForChain: sdkRegistry is required');
        await expect(queries.validatorsForChain({ sdkRegistry: {} }))
            .rejects.toThrow('validatorsForChain: chainId is required');
        await expect(queries.capabilityThresholds({ chainId: 'chain' }))
            .rejects.toThrow('capabilityThresholds: sdkRegistry is required');
        await expect(queries.capabilityThresholds({ sdkRegistry: {} }))
            .rejects.toThrow('capabilityThresholds: chainId is required');
    });
});
