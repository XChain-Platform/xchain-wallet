// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    BUNDLED_DESCRIPTORS,
    defaultRegistry,
} from '../../../packages/core/src/registry/index.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';
import {
    endpointOverridesFromSettings,
    SDKRegistry,
} from '../../../packages/core/src/sdk/SDKRegistry.js';

describe('testnet hub defaults', () => {
    const testnetDescriptors = BUNDLED_DESCRIPTORS.filter((d) => d.networkKind === 'testnet');

    it('ships testnet descriptors without a default hub', () => {
        expect(testnetDescriptors.map((d) => d.id)).toEqual([
            'bitcoin-testnet',
            'dogecoin-testnet',
            'litecoin-testnet',
        ]);
        for (const descriptor of testnetDescriptors) {
            expect(descriptor.hub).toBeUndefined();
            expect(validateChainDescriptor(descriptor)).toEqual({ ok: true, errors: [] });
        }
    });

    it('passes a custom hubUrl through for a descriptor without a hub', () => {
        const chainRegistry = defaultRegistry();
        const hubUrl = 'https://hub.operator.example/TBTC';
        const endpointOverrides = endpointOverridesFromSettings({
            sdkEndpoints: {
                'bitcoin-testnet': {
                    explorerUrl: '',
                    encoderUrl: '',
                    hubUrl,
                    custom: true,
                },
            },
        }, chainRegistry);
        expect(endpointOverrides['bitcoin-testnet']).toEqual({ hubUrl });

        const calls = [];
        const sdkRegistry = new SDKRegistry({
            chainRegistry,
            endpointOverrides,
            rateLimiter: null,
            sdkFactory: (opts) => {
                calls.push(opts);
                return { wallet: {}, auth: {} };
            },
        });
        sdkRegistry.get('bitcoin-testnet');
        expect(calls[0].hubUrl).toBe(hubUrl);
    });

    it('omits hubUrl from SDK options when no default or override exists', () => {
        const calls = [];
        const sdkRegistry = new SDKRegistry({
            chainRegistry: defaultRegistry(),
            rateLimiter: null,
            sdkFactory: (opts) => {
                calls.push(opts);
                return { wallet: {}, auth: {} };
            },
        });
        sdkRegistry.get('bitcoin-testnet');
        expect(calls[0]).not.toHaveProperty('hubUrl');
    });
});
