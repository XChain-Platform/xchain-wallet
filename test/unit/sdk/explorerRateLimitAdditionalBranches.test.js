// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    explorerPausedSeconds,
    HostRateLimiter,
    installExplorerRateLimit,
    parseRateLimitResetMs,
    parseRetryAfterMs,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';

describe('explorer limiter additional defensive branches', () => {
    it('handles null Retry-After values, absent resets, and elapsed epoch resets', () => {
        const now = Date.parse('2026-01-01T00:00:10Z');

        expect(parseRetryAfterMs(null, now)).toBeNull();
        expect(parseRateLimitResetMs(undefined, now)).toBeNull();
        expect(parseRateLimitResetMs(String((now - 1_000) / 1000), now)).toBe(0);
    });

    it('returns an Error fallback when DOMException is unavailable', async () => {
        vi.stubGlobal('DOMException', undefined);
        try {
            const controller = new AbortController();
            controller.abort();
            const limiter = new HostRateLimiter();

            await expect(limiter.request(
                'host', null, async () => ({ data: 'unused' }), () => null,
                undefined, controller.signal,
            )).rejects.toMatchObject({ name: 'AbortError', message: 'The request was cancelled.' });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not turn a negative block into a pause', () => {
        const limiter = new HostRateLimiter({ now: () => 1_000 });

        limiter.block('host', -100);

        expect(limiter.pausedSeconds('host')).toBe(0);
        expect(explorerPausedSeconds({})).toBe(0);
    });

    it('reuses an uncloneable response body without retaining response mutations', async () => {
        let now = 1_000;
        const limiter = new HostRateLimiter({ now: () => now, reuseMs: 2_000 });
        const data = { callback() {} };
        const send = vi.fn(async () => ({ status: 200, data }));

        const first = await limiter.request('host', 'GET /uncloneable', send, () => null);
        now += 10;
        const second = await limiter.request('host', 'GET /uncloneable', send, () => null);

        expect(send).toHaveBeenCalledOnce();
        expect(second).not.toBe(first);
        expect(second.data).toBe(data);
    });

    it('uses stable query keys while keeping binary reads independent', async () => {
        const get = vi.fn(async (_url, config) => ({ status: 200, data: config.params || null }));
        const client = { defaults: { baseURL: 'not a valid URL' }, get };
        const limiter = new HostRateLimiter();
        const sdk = { explorer: { client } };
        installExplorerRateLimit(sdk, limiter);

        await client.get('/rows', { params: { b: 2, omitted: undefined, a: 1 } });
        await client.get('/rows', { params: { a: 1, b: 2 } });
        expect(get).toHaveBeenCalledTimes(1);

        await client.get('/raw', { responseType: 'arraybuffer' });
        await client.get('/raw', { responseType: 'arraybuffer' });
        expect(get).toHaveBeenCalledTimes(3);

        limiter.block('not a valid URL', 2_100);
        expect(explorerPausedSeconds(sdk)).toBe(3);
    });

    it('preserves a rate-limit error whose message cannot be rewritten', async () => {
        const error = { code: 'RATE_LIMITED', service: 'custom' };
        Object.defineProperty(error, 'message', {
            value: 'immutable rate-limit detail',
            writable: false,
            enumerable: true,
        });
        const explorer = {
            client: {
                defaults: { baseURL: 'https://explorer.example' },
                get: async () => ({ data: null }),
            },
            get: async () => { throw error; },
        };
        const sdk = { explorer };
        installExplorerRateLimit(sdk, new HostRateLimiter());

        await expect(sdk.explorer.get('/status')).rejects.toBe(error);
        expect(error).toMatchObject({
            detail: 'immutable rate-limit detail',
            service: 'custom',
        });
    });
});
