// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignThrottleStorage } from '../../../packages/extension/src/background/signThrottleStorage.js';

const STORAGE_KEY = 'xchain.signThrottle';

function stubChromeStorage(initialValue) {
    const values = { [STORAGE_KEY]: initialValue };
    const local = {
        get: vi.fn((key, callback) => callback({ [key]: values[key] })),
        set: vi.fn((items, callback) => {
            Object.assign(values, items);
            callback();
        }),
        remove: vi.fn((key, callback) => {
            delete values[key];
            callback();
        }),
    };
    vi.stubGlobal('chrome', { storage: { local } });
    return { local, values };
}

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('sign throttle storage', () => {
    it('filters malformed Chrome storage buckets while preserving finite timestamps', async () => {
        stubChromeStorage({
            buckets: {
                'https://good.example': [1, Number.NaN, 3],
                'https://empty.example': [Number.POSITIVE_INFINITY],
                'https://wrong.example': 'not-an-array',
            },
        });

        await expect(createSignThrottleStorage().load()).resolves.toEqual({
            buckets: { 'https://good.example': [1, 3] },
        });
    });

    it('saves and clears snapshots through chrome.storage.local', async () => {
        const { local, values } = stubChromeStorage();
        const storage = createSignThrottleStorage();
        const snapshot = { buckets: { 'https://dapp.example': [10, 20] } };

        await storage.save(snapshot);
        expect(local.set).toHaveBeenCalledWith(
            { [STORAGE_KEY]: snapshot },
            expect.any(Function),
        );
        expect(values[STORAGE_KEY]).toBe(snapshot);

        await storage.clear();
        expect(values).not.toHaveProperty(STORAGE_KEY);
    });

    it('tolerates synchronous Chrome API failures', async () => {
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: () => { throw new Error('read failed'); },
                    set: () => { throw new Error('write failed'); },
                    remove: () => { throw new Error('remove failed'); },
                },
            },
        });
        const storage = createSignThrottleStorage();

        await expect(storage.load()).resolves.toEqual({ buckets: {} });
        await expect(storage.save({ buckets: {} })).resolves.toBeUndefined();
        await expect(storage.clear()).resolves.toBeUndefined();
    });

    it('falls back to localStorage and handles corrupt JSON', async () => {
        const storage = createSignThrottleStorage();
        const snapshot = { buckets: { 'https://dapp.example': [100] } };

        await storage.save(snapshot);
        await expect(storage.load()).resolves.toEqual(snapshot);

        localStorage.setItem(STORAGE_KEY, '{');
        await expect(storage.load()).resolves.toEqual({ buckets: {} });
        await storage.clear();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
