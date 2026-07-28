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
import {
    SDKRegistry,
    UnknownChainError,
    DEFAULT_SDK_NETWORK_OPTIONS,
    endpointOverridesFromSettings,
    joinEndpoint,
} from '../../../packages/core/src/sdk/SDKRegistry.js';
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

    // : Settings -> Network & Endpoints persisted an override that
    // nothing ever consumed - `setEndpointOverrides` had no callers, so
    // `_endpointOverrides` stayed `{}` for the process lifetime and an
    // operator pointing the wallet at their own node was silently ignored.
    describe('endpoint overrides ', () => {
        const captureFactory = () => {
            const calls = [];
            return { calls, factory: (opts) => { calls.push(opts); return fakeFactory(opts); } };
        };
        const regtest = chainRegistry.get('litecoin-regtest');
        const settingsWith = (chainId, entry) => ({ sdkEndpoints: { [chainId]: entry } });

        it('joins the default port into the endpoint the factory receives', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            reg.get('litecoin-regtest');
            expect(calls[0].encoderUrl).toBe(joinEndpoint(regtest.encoder));
            expect(calls[0].encoderUrl).toContain(`:${regtest.encoder.defaultPort}`);
        });

        it('applies a saved custom endpoint to the next SDK instance', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            reg.get('litecoin-regtest');
            expect(calls[0].explorerUrl).toBe(joinEndpoint(regtest.explorer));

            const { changed } = reg.applyEndpointOverridesFromSettings(
                settingsWith('litecoin-regtest', {
                    explorerUrl: 'https://explorer.my-node.example:8443',
                    encoderUrl: joinEndpoint(regtest.encoder),
                    hubUrl: joinEndpoint(regtest.hub),
                    custom: true,
                }),
            );
            expect(changed).toEqual(['litecoin-regtest']);

            reg.get('litecoin-regtest');
            expect(calls).toHaveLength(2);
            expect(calls[1].explorerUrl).toBe('https://explorer.my-node.example:8443');
            // Untouched siblings keep their ports.
            expect(calls[1].encoderUrl).toBe(joinEndpoint(regtest.encoder));
            expect(calls[1].hubUrl).toBe(joinEndpoint(regtest.hub));
        });

        it('leaves other chains and their live instances alone', () => {
            const { factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            const btc = reg.get('bitcoin-mainnet');
            const ltc = reg.get('litecoin-regtest');
            reg.applyEndpointOverridesFromSettings(
                settingsWith('litecoin-regtest', {
                    explorerUrl: 'https://explorer.my-node.example:8443',
                    encoderUrl: joinEndpoint(regtest.encoder),
                    hubUrl: joinEndpoint(regtest.hub),
                    custom: true,
                }),
            );
            expect(reg.get('bitcoin-mainnet')).toBe(btc);
            expect(reg.get('litecoin-regtest')).not.toBe(ltc);
        });

        it('is a no-op when the effective endpoints did not move', () => {
            const { factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            const settings = settingsWith('litecoin-regtest', {
                explorerUrl: 'https://explorer.my-node.example:8443',
                encoderUrl: joinEndpoint(regtest.encoder),
                hubUrl: joinEndpoint(regtest.hub),
                custom: true,
            });
            reg.applyEndpointOverridesFromSettings(settings);
            const sdk = reg.get('litecoin-regtest');
            const second = reg.applyEndpointOverridesFromSettings(settings);
            expect(second.changed).toEqual([]);
            expect(reg.get('litecoin-regtest')).toBe(sdk);
        });

        it('reverts to the descriptor default when the override is reset', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            reg.applyEndpointOverridesFromSettings(
                settingsWith('litecoin-regtest', {
                    explorerUrl: 'https://explorer.my-node.example:8443',
                    encoderUrl: joinEndpoint(regtest.encoder),
                    hubUrl: joinEndpoint(regtest.hub),
                    custom: true,
                }),
            );
            reg.get('litecoin-regtest');
            reg.applyEndpointOverridesFromSettings(
                settingsWith('litecoin-regtest', {
                    explorerUrl: joinEndpoint(regtest.explorer),
                    encoderUrl: joinEndpoint(regtest.encoder),
                    hubUrl: joinEndpoint(regtest.hub),
                    custom: false,
                }),
            );
            reg.get('litecoin-regtest');
            expect(calls[calls.length - 1].explorerUrl).toBe(joinEndpoint(regtest.explorer));
        });

        // The latent half of : the pre-fix editor seeded its draft
        // from `defaultUrl` alone and then wrote all three fields, so a
        // record saved before this fix carries port-stripped siblings.
        // Consuming those verbatim would kill the two endpoints the
        // operator never touched.
        it('ignores port-stripped values left behind by the old editor', () => {
            const { calls, factory } = captureFactory();
            const reg = new SDKRegistry({ chainRegistry, sdkFactory: factory });
            reg.applyEndpointOverridesFromSettings(
                settingsWith('litecoin-regtest', {
                    explorerUrl: 'https://explorer.my-node.example:8443',
                    encoderUrl: regtest.encoder.defaultUrl,   // ':3223' dropped
                    hubUrl: regtest.hub.defaultUrl,           // ':10000' dropped
                    custom: true,
                }),
            );
            reg.get('litecoin-regtest');
            expect(calls[0].explorerUrl).toBe('https://explorer.my-node.example:8443');
            expect(calls[0].encoderUrl).toBe(joinEndpoint(regtest.encoder));
            expect(calls[0].hubUrl).toBe(joinEndpoint(regtest.hub));
        });

        it('drops blank fields, non-custom entries and unknown chains', () => {
            const overrides = endpointOverridesFromSettings({
                sdkEndpoints: {
                    'litecoin-regtest': {
                        explorerUrl: '  https://explorer.my-node.example  ',
                        encoderUrl: '   ',
                        hubUrl: joinEndpoint(regtest.hub),
                        custom: true,
                    },
                    'bitcoin-mainnet': {
                        explorerUrl: 'https://ignored.example',
                        encoderUrl: '',
                        hubUrl: '',
                        custom: false,
                    },
                    'ethereum-mainnet': {
                        explorerUrl: 'https://not-a-chain.example',
                        encoderUrl: '',
                        hubUrl: '',
                        custom: true,
                    },
                },
            }, chainRegistry);
            expect(Object.keys(overrides)).toEqual(['litecoin-regtest']);
            expect(overrides['litecoin-regtest']).toEqual({
                explorerUrl: 'https://explorer.my-node.example',
            });
        });

        it('tolerates a settings record with no sdkEndpoints at all', () => {
            expect(endpointOverridesFromSettings({}, chainRegistry)).toEqual({});
            expect(endpointOverridesFromSettings(null, chainRegistry)).toEqual({});
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
