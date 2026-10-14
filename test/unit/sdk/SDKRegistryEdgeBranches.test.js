// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    endpointOverridesFromSettings,
    joinEndpoint,
    SDKRegistry,
} from '../../../packages/core/src/sdk/SDKRegistry.js';

const descriptor = {
    id: 'coin-regtest',
    explorer: { defaultUrl: 'http://explorer.local', defaultPort: 1234 },
    encoder: { defaultUrl: 'http://encoder.local', defaultPort: 80 },
    hub: { defaultUrl: 'https://hub.local', defaultPort: 443 },
};

const chainRegistry = {
    has: (id) => id === descriptor.id,
    get: (id) => (id === descriptor.id ? descriptor : null),
};

describe('SDKRegistry edge branches', () => {
    it('rejects missing constructor dependencies', () => {
        expect(() => new SDKRegistry({ sdkFactory: () => ({}) })).toThrow(/chainRegistry is required/);
        expect(() => new SDKRegistry({ chainRegistry, sdkFactory: {} })).toThrow(/must be a function/);
    });

    it('initializes optional SDK hooks and reports active chains', async () => {
        const init = vi.fn(async () => {});
        const factory = vi.fn(({ network }) => (network === descriptor.id ? { init } : {}));
        const registry = new SDKRegistry({ chainRegistry, sdkFactory: factory, rateLimiter: null });

        expect(registry.has(descriptor.id)).toBe(true);
        expect(registry.activeChainIds()).toEqual([]);
        await registry.initActive([descriptor.id]);
        expect(init).toHaveBeenCalledOnce();
        expect(registry.activeChainIds()).toEqual([descriptor.id]);
    });

    it('invalidates instances even when close throws', () => {
        const close = vi.fn(() => { throw new Error('close failed'); });
        const registry = new SDKRegistry({
            chainRegistry, sdkFactory: () => ({ close }), rateLimiter: null,
        });
        const first = registry.get(descriptor.id);

        expect(() => registry.invalidate(descriptor.id)).not.toThrow();
        expect(close).toHaveBeenCalledOnce();
        expect(registry.get(descriptor.id)).not.toBe(first);
    });

    it('merges endpoint overrides without rebuilding a live instance', () => {
        const factory = vi.fn((opts) => ({ opts }));
        const registry = new SDKRegistry({ chainRegistry, sdkFactory: factory, rateLimiter: null });
        const first = registry.get(descriptor.id);

        registry.setEndpointOverrides({
            [descriptor.id]: { explorerUrl: '  https://custom.example/path  ' },
        });
        expect(registry.get(descriptor.id)).toBe(first);

        registry.invalidateAll();
        const second = registry.get(descriptor.id);
        expect(second.opts.explorerUrl).toBe('https://custom.example/path');
        expect(second.opts.encoderUrl).toBe('http://encoder.local');
    });

    it('rebuilds with a connection pool and omits a subsequently cleared pool', () => {
        const calls = [];
        const registry = new SDKRegistry({
            chainRegistry,
            sdkFactory: (opts) => { calls.push(opts); return {}; },
            rateLimiter: null,
        });
        registry.get(descriptor.id);
        registry.setPool({ httpAgent: 'agent' });
        registry.get(descriptor.id);
        registry.setPool(null);
        registry.get(descriptor.id);

        expect(calls[1].pool).toEqual({ httpAgent: 'agent' });
        expect(calls[2]).not.toHaveProperty('pool');
    });

    it('joins only explicit non-standard ports', () => {
        expect(joinEndpoint(null)).toBe('');
        expect(joinEndpoint({ defaultUrl: 'https://x', defaultPort: undefined })).toBe('https://x');
        expect(joinEndpoint({ defaultUrl: 'http://x', defaultPort: 80 })).toBe('http://x');
        expect(joinEndpoint({ defaultUrl: 'https://x', defaultPort: 443 })).toBe('https://x');
        expect(joinEndpoint({ defaultUrl: 'https://x', defaultPort: 8443 })).toBe('https://x:8443');
    });

    it('drops settings entries when registry lookup throws or an endpoint is absent', () => {
        const throwingRegistry = {
            has: () => true,
            get: () => { throw new Error('registry unavailable'); },
        };
        expect(endpointOverridesFromSettings({
            sdkEndpoints: { [descriptor.id]: { custom: true, explorerUrl: 'https://custom' } },
        }, throwingRegistry)).toEqual({});

        const withoutHub = { ...descriptor, hub: null };
        expect(endpointOverridesFromSettings({
            sdkEndpoints: {
                [descriptor.id]: {
                    custom: true,
                    explorerUrl: 'https://custom',
                    hubUrl: 'https://ignored',
                },
            },
        }, { has: () => true, get: () => withoutHub })).toEqual({
            [descriptor.id]: { explorerUrl: 'https://custom' },
        });
    });
});
