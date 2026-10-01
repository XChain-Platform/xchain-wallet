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
import { listTickCoinSupport } from '../../../packages/core/src/flows/listTickCoinSupport.js';

const registryOf = (sdk) => ({ get: () => sdk });

describe('listTickCoinSupport', () => {
    it('is true when the SDK answers true', async () => {
        const sdk = {
            enabled: true,
            isListTickCoinActive: vi.fn(function isListTickCoinActive() {
                return Promise.resolve(this.enabled);
            }),
        };
        const sdkRegistry = { get: vi.fn(() => sdk) };

        await expect(listTickCoinSupport({ sdkRegistry, chainId: 'bitcoin-regtest' }))
            .resolves.toBe(true);
        expect(sdkRegistry.get).toHaveBeenCalledWith('bitcoin-regtest');
        expect(sdk.isListTickCoinActive).toHaveBeenCalledOnce();
    });

    it('is false when the SDK answers false', async () => {
        const sdk = { isListTickCoinActive: async () => false };
        await expect(listTickCoinSupport({ sdkRegistry: registryOf(sdk), chainId: 'bitcoin-regtest' }))
            .resolves.toBe(false);
    });

    it('is false for an SDK without isListTickCoinActive', async () => {
        const sdk = { getActions: () => [], getActionFormats: () => ({}) };
        await expect(listTickCoinSupport({
            sdkRegistry: registryOf(sdk),
            chainId: 'bitcoin-regtest',
        }))
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
