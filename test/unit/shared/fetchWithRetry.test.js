// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../../../packages/core/src/shared/utils/fetchWithRetry.js';

describe('fetchWithRetry', () => {
    it('retries a transient GET with exponential backoff', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, status: 200 });
        const sleeps = [];

        const response = await fetchWithRetry(fetchImpl, 'https://service.test/data', {}, {
            maxRetries: 2,
            baseDelayMs: 20,
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
