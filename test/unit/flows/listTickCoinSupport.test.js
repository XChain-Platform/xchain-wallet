// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listActions } from '../../../packages/core/src/flows/sdkIntrospection.js';
import { listTickCoinSupport } from '../../../packages/core/src/flows/listTickCoinSupport.js';

vi.mock('../../../packages/core/src/flows/sdkIntrospection.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, listActions: vi.fn(actual.listActions) };
});

const registryOf = (sdk) => ({ get: () => sdk });

describe('listTickCoinSupport', () => {
    beforeEach(() => {
        vi.mocked(listActions).mockClear();
    });

    it('routes the probe through SDK introspection', async () => {
        const sdkRegistry = { get: vi.fn(() => { throw new Error('direct registry access'); }) };
        vi.mocked(listActions).mockResolvedValueOnce(true);

        await expect(listTickCoinSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toBe(true);
        expect(listActions).toHaveBeenCalledOnce();
        expect(listActions).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-regtest',
        }));
        expect(sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('is true when the SDK answers true', async () => {
        const sdk = { isListTickCoinActive: async () => true };
        await expect(listTickCoinSupport({ sdkRegistry: registryOf(sdk), chainId: 'bitcoin-regtest' }))
            .resolves.toBe(true);
    });

    it('is false when the SDK answers false', async () => {
        const sdk = { isListTickCoinActive: async () => false };
        await expect(listTickCoinSupport({ sdkRegistry: registryOf(sdk), chainId: 'bitcoin-regtest' }))
            .resolves.toBe(false);
    });

    it('is false for an SDK surface without the method', async () => {
        const sdk = { getActions: () => [], getActionFormats: () => ({}) };
        await expect(listTickCoinSupport({ sdkRegistry: registryOf(sdk), chainId: 'bitcoin-regtest' }))
            .resolves.toBe(false);
    });

    it('is false when the method throws', async () => {
        const sdk = { isListTickCoinActive: async () => { throw new Error('boom'); } };
        await expect(listTickCoinSupport({ sdkRegistry: registryOf(sdk), chainId: 'bitcoin-regtest' }))
            .resolves.toBe(false);
    });

    it('is false when the registry throws', async () => {
        const sdkRegistry = { get: () => { throw new Error('no sdk'); } };
        await expect(listTickCoinSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toBe(false);
    });
});
