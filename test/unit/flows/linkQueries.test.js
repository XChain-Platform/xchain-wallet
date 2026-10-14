// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { linksForAddress } from '../../../packages/core/src/flows/linkQueries.js';

function mockRegistry(sdk) {
    return { get: vi.fn(() => sdk) };
}

describe('linksForAddress', () => {
    it('returns the SDK response for an address-scoped link query', async () => {
        const response = { data: [{ coin1: 'BTC', coin1_action_index: 41 }] };
        const sdk = { getLinks: vi.fn(async () => response) };
        const sdkRegistry = mockRegistry(sdk);
        const opts = { limit: 25, offset: 50 };

        const result = await linksForAddress({
            sdkRegistry,
            chainId: 'bitcoin-regtest',
            address: 'source-address',
            opts,
        });

        expect(result).toBe(response);
        expect(sdkRegistry.get).toHaveBeenCalledOnce();
        expect(sdkRegistry.get).toHaveBeenCalledWith('bitcoin-regtest');
        expect(sdk.getLinks).toHaveBeenCalledOnce();
        expect(sdk.getLinks).toHaveBeenCalledWith('source-address', 'address', opts);
    });

    it('forwards an omitted pagination object as undefined', async () => {
        const sdk = { getLinks: vi.fn(async () => ({ data: [] })) };

        await linksForAddress({
            sdkRegistry: mockRegistry(sdk),
            chainId: 'litecoin-regtest',
            address: 'source-address',
        });

        expect(sdk.getLinks).toHaveBeenCalledWith('source-address', 'address', undefined);
    });

    it.each([
        { params: { chainId: 'bitcoin-regtest', address: 'source-address' }, field: 'sdkRegistry' },
        { params: { sdkRegistry: mockRegistry({}), address: 'source-address' }, field: 'chainId' },
        { params: { sdkRegistry: mockRegistry({}), chainId: 'bitcoin-regtest' }, field: 'address' },
    ])('requires $field', async ({ params, field }) => {
        await expect(linksForAddress(params)).rejects.toThrow(`linksForAddress: ${field} is required`);
    });

    it('propagates SDK query failures', async () => {
        const failure = new Error('explorer unavailable');
        const sdk = { getLinks: vi.fn(async () => { throw failure; }) };

        await expect(linksForAddress({
            sdkRegistry: mockRegistry(sdk),
            chainId: 'dogecoin-regtest',
            address: 'source-address',
        })).rejects.toBe(failure);
    });
});
