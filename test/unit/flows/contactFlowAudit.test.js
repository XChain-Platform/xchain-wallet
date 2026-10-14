// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { currentAddressPreferences } from '../../../packages/core/src/flows/addressPreferences.js';
import { addBlockedOrigin, listBlockedOrigins } from '../../../packages/core/src/flows/blocklist.js';
import {
    addCustomChain,
    listCustomChains,
    removeCustomChain,
} from '../../../packages/core/src/flows/customChains.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

describe('settings-backed contact flows', () => {
    it('propagates settings read failures instead of returning empty state', async () => {
        const vault = { settings: { get: vi.fn().mockRejectedValue(new Error('vault locked')) } };

        await expect(listCustomChains({ vault })).rejects.toThrow('vault locked');
        await expect(listBlockedOrigins({ vault })).rejects.toThrow('vault locked');
    });

    it('does not report a stored custom chain as restored when registration fails', async () => {
        const descriptor = BUNDLED_DESCRIPTORS[0];
        const vault = {
            settings: { get: vi.fn(async () => ({ customChains: [descriptor] })) },
        };
        const chainRegistry = {
            has: vi.fn(() => false),
            addCustom: vi.fn(() => { throw new Error('registry refused'); }),
        };

        await expect(addCustomChain({ vault, chainRegistry, descriptor }))
            .rejects.toThrow('registry refused');
    });

    it('restores settings when a persisted row collides with a bundled chain', async () => {
        const chainId = BUNDLED_DESCRIPTORS[0].id;
        const original = {
            customChains: [{ id: chainId }],
            sdkEndpoints: { [chainId]: { explorerUrl: 'https://node.example' } },
        };
        const put = vi.fn(async () => {});
        const vault = { settings: { get: vi.fn(async () => original), put } };
        const chainRegistry = {
            get: vi.fn(() => ({ id: chainId, isUserAdded: false })),
            removeCustom: vi.fn(() => { throw new Error('bundled chain'); }),
        };

        await expect(removeCustomChain({
            vault, chainRegistry, chainId,
        })).rejects.toThrow('is a bundled chain and cannot be removed');
        expect(put).toHaveBeenCalledTimes(2);
        expect(put).toHaveBeenLastCalledWith(original);
    });

    it('persists a new block before deleting matching site approvals', async () => {
        const order = [];
        const vault = {
            settings: {
                get: vi.fn(async () => ({ blockedOrigins: [] })),
                put: vi.fn(async () => { order.push('settings'); }),
            },
            connectedSites: {
                findBy: vi.fn(async () => [{ id: 'site-1', origin: 'https://example.com' }]),
                delete: vi.fn(async () => { order.push('site'); }),
            },
        };

        await addBlockedOrigin({ vault, origin: 'https://example.com' });
        expect(order).toEqual(['settings', 'site']);
    });

    it('keeps approvals when persisting a new block fails', async () => {
        const remove = vi.fn(async () => {});
        const vault = {
            settings: {
                get: vi.fn(async () => ({ blockedOrigins: [] })),
                put: vi.fn().mockRejectedValue(new Error('disk full')),
            },
            connectedSites: {
                findBy: vi.fn(async () => [{ id: 'site-1', origin: 'https://example.com' }]),
                delete: remove,
            },
        };

        await expect(addBlockedOrigin({ vault, origin: 'https://example.com' }))
            .rejects.toThrow('disk full');
        expect(remove).not.toHaveBeenCalled();
    });
});

describe('address preference reads', () => {
    it('rejects a malformed explorer envelope instead of returning defaults', async () => {
        const sdkRegistry = {
            get: vi.fn(() => ({ getAddresses: vi.fn(async () => ({ error: 'unavailable' })) })),
        };

        await expect(currentAddressPreferences({
            sdkRegistry, chainId: 'bitcoin-mainnet', address: 'bc1qexample',
        })).rejects.toThrow('explorer returned a malformed response');
    });
});
