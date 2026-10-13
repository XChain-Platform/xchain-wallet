// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../../../packages/core/src/shared/utils/fetchWithRetry.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('fetchWithRetry', () => {
    it('retries a transient GET with exponential backoff', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, status: 200 });
        const sleeps = [];

        const response = await fetchWithRetry(fetchImpl, 'https://service.test/data', {}, {
            maxRetries: 2,
            baseDelayMs: 20,
            random: () => 0.5,
            sleep: async (ms) => { sleeps.push(ms); },
        });

        expect(response.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleeps).toEqual([20]);
    });

    it('never retries a non-GET request', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('socket closed'); });

        await expect(fetchWithRetry(fetchImpl, 'https://service.test/write', { method: 'POST' }, {
            maxRetries: 3,
            sleep: async () => {},
        })).rejects.toMatchObject({
            name: 'NetworkRequestError',
            message: 'The network request failed. Please try again.',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('surfaces one plain error after the final GET attempt', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 }));

        await expect(fetchWithRetry(fetchImpl, 'https://service.test/data', {}, {
            maxRetries: 2,
            sleep: async () => {},
        })).rejects.toMatchObject({
            name: 'NetworkResponseError',
            message: 'The network service is temporarily unavailable. Please try again.',
            status: 502,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('honors Retry-After, then applies jittered exponential spacing', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ status: 429, headers: { 'Retry-After': '3' } })
            .mockResolvedValueOnce({ status: 503 })
            .mockResolvedValueOnce({ ok: true, status: 200 });
        const pending = fetchWithRetry(fetchImpl, 'https://service.test/prices', {}, {
            maxRetries: 2,
            baseDelayMs: 200,
            random: () => 0.5,
        });

        await vi.advanceTimersByTimeAsync(2_999);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(399);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);

        await expect(pending).resolves.toMatchObject({ status: 200 });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('caps the retry budget even when a caller asks for more', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async () => ({ status: 503 }));
        const pending = fetchWithRetry(fetchImpl, 'https://service.test/prices', {}, {
            maxRetries: 99,
            baseDelayMs: 100,
            random: () => 0.5,
        });
        const rejected = expect(pending).rejects.toMatchObject({
            name: 'NetworkResponseError',
            status: 503,
        });

        await vi.runAllTimersAsync();
        await rejected;
        expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it('does not retry a CORS-shaped rejection or an opaque response', async () => {
        const corsFetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        await expect(fetchWithRetry(corsFetch, 'https://service.test/cors', {}, {
            maxRetries: 3,
        })).rejects.toMatchObject({ name: 'NetworkRequestError' });
        expect(corsFetch).toHaveBeenCalledTimes(1);

        const opaque = { ok: false, status: 0, type: 'opaque' };
        const opaqueFetch = vi.fn(async () => opaque);
        await expect(fetchWithRetry(opaqueFetch, 'https://service.test/opaque', {}, {
            maxRetries: 3,
        })).resolves.toBe(opaque);
        expect(opaqueFetch).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight GET per URL', async () => {
        let release;
        const fetchImpl = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const first = fetchWithRetry(fetchImpl, 'https://service.test/prices');
        const second = fetchWithRetry(fetchImpl, 'https://service.test/prices');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        release({ ok: true, status: 200 });
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('times out an attempt and reports a plain timeout error', async () => {
        const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(
                Object.assign(new Error('internal abort detail'), { name: 'AbortError' }),
            ));
        }));

        await expect(fetchWithRetry(fetchImpl, 'https://service.test/data', {}, {
            timeoutMs: 5,
            maxRetries: 0,
        })).rejects.toMatchObject({
            name: 'NetworkTimeoutError',
            message: 'The network request timed out. Please try again.',
        });
    });

    it('stops during backoff when the caller aborts', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
        const pending = fetchWithRetry(fetchImpl, 'https://service.test/data', {
            signal: controller.signal,
        }, { baseDelayMs: 60_000 });

        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
