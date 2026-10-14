// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { memoizeRetryablePromise } from '../../../packages/web/src/retryablePromise.js';

describe('web messaging host bridge cache', () => {
    it('retries loading after a transient import failure', async () => {
        const failure = new Error('chunk unavailable');
        const bridge = { sendMessage: vi.fn() };
        const loader = vi.fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(bridge);
        const loadHostBridge = memoizeRetryablePromise(loader);

        await expect(loadHostBridge()).rejects.toBe(failure);
        await expect(loadHostBridge()).resolves.toBe(bridge);
        expect(loader).toHaveBeenCalledTimes(2);
    });
});
