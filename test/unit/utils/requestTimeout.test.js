// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SCREEN_REQUEST_TIMEOUT_MS,
    withRequestTimeout,
} from '../../../packages/core/src/shared/utils/requestTimeout.js';

describe('withRequestTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('resolves with the request value and clears its timeout', async () => {
        await expect(withRequestTimeout(Promise.resolve({ ok: true }), 50))
            .resolves.toEqual({ ok: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves a request rejection and clears its timeout', async () => {
        const failure = new Error('transport failed');
        await expect(withRequestTimeout(Promise.reject(failure), 50)).rejects.toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects when a pending request exceeds the requested timeout', async () => {
        const bounded = withRequestTimeout(new Promise(() => {}), 25);
        const rejection = expect(bounded).rejects.toThrow('Request timed out');

        await vi.advanceTimersByTimeAsync(24);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);

        await rejection;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the screen timeout by default', async () => {
        const bounded = withRequestTimeout(new Promise(() => {}));
        const rejection = expect(bounded).rejects.toThrow('Request timed out');

        await vi.advanceTimersByTimeAsync(SCREEN_REQUEST_TIMEOUT_MS - 1);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);

        await rejection;
    });
});
