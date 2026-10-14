// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    HostRateLimiter,
    installExplorerRateLimit,
    parseRateLimitResetMs,
    parseRetryAfterMs,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';

describe('explorer rate limiter edge branches', () => {
    it('handles elapsed dates, decimal resets, and invalid reset values', () => {
        const now = Date.parse('2026-01-01T00:00:10Z');
        expect(parseRetryAfterMs('Wed, 01 Jan 2025 00:00:00 GMT', now)).toBe(0);
        expect(parseRateLimitResetMs('1.25', now)).toBe(1_250);
        expect(parseRateLimitResetMs('', now)).toBeNull();
        expect(parseRateLimitResetMs('-1', now)).toBeNull();
    });

    it('ignores incomplete window headers and clears an expired pacing window', () => {
        let now = 1_000;
        const limiter = new HostRateLimiter({ now: () => now, lowWater: 5 });

        limiter.observe('host', { 'ratelimit-remaining': 'not-a-number', 'ratelimit-reset': '10' });
        expect(limiter.state('host').remaining).toBeNull();

        limiter.observe('host', { 'ratelimit-remaining': '2' });
        expect(limiter.state('host').remaining).toBeNull();

        limiter.observe('host', { 'ratelimit-remaining': '2', 'ratelimit-reset': '1' });
        now = 2_001;
        expect(limiter.pace('host')).toBe(now);
        expect(limiter.state('host')).toMatchObject({ remaining: null, resetAt: null });
    });

    it('prunes expired reuse entries once the cache reaches its maintenance threshold', () => {
        const limiter = new HostRateLimiter({ now: () => 10_000, reuseMs: 2_000 });
        for (let i = 0; i < 63; i += 1) limiter.recent.set(`fresh-${i}`, { at: 9_000, res: i });
        limiter.recent.set('expired', { at: 7_999, res: null });

        limiter.pruneRecent();

        expect(limiter.recent.has('expired')).toBe(false);
        expect(limiter.recent.size).toBe(63);
    });

    it('keeps signalled requests independent instead of coalescing them', async () => {
        const limiter = new HostRateLimiter();
        const send = vi.fn(async () => ({ data: 'ok' }));
        const a = new AbortController();
        const b = new AbortController();

        await Promise.all([
            limiter.request('host', 'GET /same', send, () => null, undefined, a.signal),
            limiter.request('host', 'GET /same', send, () => null, undefined, b.signal),
        ]);

        expect(send).toHaveBeenCalledTimes(2);
    });

    it('rejects the old client error when the explorer changes during the request', async () => {
        let rejectOld;
        const oldClient = {
            defaults: { baseURL: 'https://old.example' },
            get: () => new Promise((_resolve, reject) => { rejectOld = reject; }),
        };
        const explorer = {
            client: oldClient,
            buildClient() {
                this.client = {
                    defaults: { baseURL: 'https://new.example' },
                    get: async () => ({ data: 'new' }),
                };
            },
        };
        const sdk = { explorer };
        installExplorerRateLimit(sdk, new HostRateLimiter());

        const pending = sdk.explorer.client.get('/status');
        await Promise.resolve();
        sdk.explorer.buildClient();
        rejectOld(new Error('old client failed'));

        await expect(pending).rejects.toMatchObject({
            name: 'NetworkChangedError',
            code: 'EXPLORER_NETWORK_CHANGED',
        });
    });

    it('leaves non-writable explorer properties and repeated installs untouched', () => {
        const explorer = { client: { get: async () => ({ data: 1 }) } };
        const sdk = {};
        Object.defineProperty(sdk, 'explorer', { value: explorer, configurable: false });

        expect(installExplorerRateLimit(sdk)).toBe(sdk);
        expect(sdk.explorer.client.__xcRateLimited).toBeUndefined();

        const writable = { explorer: { client: { get: async () => ({ data: 1 }) } } };
        installExplorerRateLimit(writable);
        const wrapped = writable.explorer.client.get;
        installExplorerRateLimit(writable);
        expect(writable.explorer.client.get).toBe(wrapped);
    });
});
