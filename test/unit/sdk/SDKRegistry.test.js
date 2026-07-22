// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for SDKRegistry: the per-chain SDK instance cache.

import { describe, it, expect } from 'vitest';
import { SDKRegistry, UnknownChainError, DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
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

    // : the wallet froze for minutes when its backend was
    // unreachable because SDK instances were built with xchain-sdk's
    // server-tuned defaults (30s timeout x 4 attempts, per call). The
    // registry now hands every factory call a bounded timeout + retry
    // policy so an offline backend surfaces as a fast, loud error.
    describe('network patience ', () => {
        const captureFactory = () => {
            const calls = [];
            return { calls, factory: (opts) => { calls.push(opts); return fakeFactory(opts); } };
        };

        it('passes bounded default timeout + retry to the factory', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            reg.get('bitcoin-mainnet');
            expect(calls).toHaveLength(1);
            expect(calls[0].timeout).toBe(DEFAULT_SDK_NETWORK_OPTIONS.timeout);
            expect(calls[0].retry).toEqual(DEFAULT_SDK_NETWORK_OPTIONS.retry);
        });

        it('defaults stay interactive-grade: worst case under 30s per call', () => {
            const { timeout, retry } = DEFAULT_SDK_NETWORK_OPTIONS;
            // 1 try + maxRetries retries, each up to `timeout`, plus
            // backoff delays capped at maxDelay between attempts.
            const worstCase =
                (1 + retry.maxRetries) * timeout + retry.maxRetries * retry.maxDelay;
            expect(worstCase).toBeLessThan(30_000);
        });

        it('honours networkOptions overrides, merged over the defaults', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({
                chainRegistry,
                sdkFactory: factory,
                networkOptions: { timeout: 3_000, retry: { maxRetries: 0 } },
            });
            reg.get('litecoin-mainnet');
            expect(calls[0].timeout).toBe(3_000);
            expect(calls[0].retry).toEqual({
                ...DEFAULT_SDK_NETWORK_OPTIONS.retry,
                maxRetries: 0,
            });
        });
    });

    describe('underlying chain registry', () => {
        it('honours every chain id the chain registry knows about', () => {
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: fakeFactory });
            const btcChains = chainRegistry.byCoin('bitcoin');
            expect(btcChains.length).toBeGreaterThan(0);
            // Every BTC chain id should resolve to a fresh SDK instance
            // without throwing. Proves the registry hands the chainId
            // to the factory, not just a hard-coded subset.
            for (const d of btcChains) {
                const sdk = reg.get(d.id);
                expect(sdk.network).toBe(d.id);
            }
        });
    });
});
