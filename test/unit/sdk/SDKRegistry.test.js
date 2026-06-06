// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit tests for SDKRegistry — the per-chain SDK instance cache.

import { describe, it, expect } from 'vitest';
import { SDKRegistry, UnknownChainError } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const chainRegistry = defaultRegistry();
const fakeFactory = (opts) => ({
    network: opts.network,
    explorerUrl: opts.explorerUrl,
    wallet: { deriveAddress: () => 'mock' },
    auth: { signMessage: () => 'sig' },
    getBalances: async () => [],
});

describe('sdk/SDKRegistry', () => {
    describe('get', () => {
        it('lazily instantiates an SDK per chain', () => {
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: fakeFactory });
            const a = reg.get('bitcoin-mainnet');
            const b = reg.get('bitcoin-mainnet');
            expect(a).toBe(b);
            expect(a.network).toBe('bitcoin-mainnet');
        });

        it('returns distinct instances per chain', () => {
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: fakeFactory });
            const btc = reg.get('bitcoin-mainnet');
            const ltc = reg.get('litecoin-mainnet');
            expect(btc).not.toBe(ltc);
            expect(btc.network).toBe('bitcoin-mainnet');
            expect(ltc.network).toBe('litecoin-mainnet');
        });

        it('throws UnknownChainError for an unregistered chain id', () => {
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: fakeFactory });
            expect(() => reg.get('bogus-chain'))
                .toThrow(UnknownChainError);
        });
    });

    describe('underlying chain registry', () => {
        it('honours every chain id the chain registry knows about', () => {
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: fakeFactory });
            const btcChains = chainRegistry.byCoin('bitcoin');
            expect(btcChains.length).toBeGreaterThan(0);
            // Every BTC chain id should resolve to a fresh SDK instance
            // without throwing — proves the registry hands the chainId
            // to the factory, not just a hard-coded subset.
            for (const d of btcChains) {
                const sdk = reg.get(d.id);
                expect(sdk.network).toBe(d.id);
            }
        });
    });
});
