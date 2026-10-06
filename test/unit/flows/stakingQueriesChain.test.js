// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    capabilityThresholds,
    rewardClaimsForAddress,
    validatorsForChain,
} from '../../../packages/core/src/flows/stakingQueries.js';

function registryFor(sdk) {
    return { get: vi.fn(() => sdk) };
}

describe('rewardClaimsForAddress', () => {
    it('resolves the chain client and returns its address-scoped collects', async () => {
        const result = { data: [{ action_index: 'claim-1' }] };
        const sdk = { getCollects: vi.fn(async () => result) };
        const sdkRegistry = registryFor(sdk);
        const opts = { limit: 25, page: 2 };

        const actual = await rewardClaimsForAddress({
            sdkRegistry, chainId: 'chain-a', address: 'wallet-address', opts,
        });

        expect(sdkRegistry.get).toHaveBeenCalledWith('chain-a');
        expect(sdk.getCollects).toHaveBeenCalledWith('wallet-address', 'address', opts);
        expect(actual).toBe(result);
    });

    it('rejects when the chain has no client', async () => {
        const sdkRegistry = registryFor(undefined);

        await expect(rewardClaimsForAddress({
            sdkRegistry, chainId: 'missing-chain', address: 'wallet-address',
        })).rejects.toBeInstanceOf(TypeError);
        expect(sdkRegistry.get).toHaveBeenCalledWith('missing-chain');
    });
});

describe('validatorsForChain', () => {
    it('resolves the chain client and returns its validators', async () => {
        const result = { data: [{ address: 'validator-address' }] };
        const sdk = { getValidators: vi.fn(async () => result) };
        const sdkRegistry = registryFor(sdk);
        const opts = { limit: 10 };

        const actual = await validatorsForChain({ sdkRegistry, chainId: 'chain-b', opts });

        expect(sdkRegistry.get).toHaveBeenCalledWith('chain-b');
        expect(sdk.getValidators).toHaveBeenCalledWith(opts);
        expect(actual).toBe(result);
    });

    it('rejects when the chain has no client', async () => {
        const sdkRegistry = registryFor(null);

        await expect(validatorsForChain({
            sdkRegistry, chainId: 'missing-chain',
        })).rejects.toBeInstanceOf(TypeError);
        expect(sdkRegistry.get).toHaveBeenCalledWith('missing-chain');
    });
});

describe('capabilityThresholds', () => {
    it('resolves the chain client and returns its capability thresholds', async () => {
        const result = [{ capability: 'validate', min_stake: '100', disabled: false }];
        const sdk = { getCapabilityThresholds: vi.fn(async () => result) };
        const sdkRegistry = registryFor(sdk);

        const actual = await capabilityThresholds({ sdkRegistry, chainId: 'chain-c' });

        expect(sdkRegistry.get).toHaveBeenCalledWith('chain-c');
        expect(sdk.getCapabilityThresholds).toHaveBeenCalledWith();
        expect(actual).toBe(result);
    });

    it('returns null when the client predates capability thresholds', async () => {
        const sdkRegistry = registryFor({});

        await expect(capabilityThresholds({
            sdkRegistry, chainId: 'older-chain',
        })).resolves.toBeNull();
        expect(sdkRegistry.get).toHaveBeenCalledWith('older-chain');
    });

    it('rejects when the chain has no client', async () => {
        const sdkRegistry = registryFor(undefined);

        await expect(capabilityThresholds({
            sdkRegistry, chainId: 'missing-chain',
        })).rejects.toBeInstanceOf(TypeError);
        expect(sdkRegistry.get).toHaveBeenCalledWith('missing-chain');
    });
});
