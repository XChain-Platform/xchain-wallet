// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogConsoleStorage } from '../../../packages/extension/src/background/logConsoleStorage.js';

const STORAGE_KEY = 'xchain.logConsole';
const validEntry = {
    id: 1,
    timestamp: 123,
    level: 'warn',
    source: 'bridge',
    message: 'request rejected',
};

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('log console storage', () => {
    it('loads only canonical entries from chrome.storage.local', async () => {
        const { local } = stubChromeStorage({
            entries: [
                validEntry,
                { ...validEntry, id: Number.NaN },
                { ...validEntry, level: 'debug' },
                { ...validEntry, source: '' },
                null,
            ],
        });

        const storage = createLogConsoleStorage();

        await expect(storage.load()).resolves.toEqual([validEntry]);
        expect(local.get).toHaveBeenCalledWith(STORAGE_KEY, expect.any(Function));
    });

    it('sanitizes writes and clears the Chrome key', async () => {
        const { local, values } = stubChromeStorage();
        const storage = createLogConsoleStorage();

        await storage.save([validEntry, { ...validEntry, message: 42 }]);
        expect(values[STORAGE_KEY]).toEqual({ entries: [validEntry] });

        await storage.clear();
        expect(local.remove).toHaveBeenCalledWith(STORAGE_KEY, expect.any(Function));
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
        const storage = createLogConsoleStorage();

        await expect(storage.load()).resolves.toEqual([]);
        await expect(storage.save([validEntry])).resolves.toBeUndefined();
        await expect(storage.clear()).resolves.toBeUndefined();
    });

    it('uses localStorage when Chrome storage is unavailable', async () => {
        const storage = createLogConsoleStorage();

        await storage.save([validEntry]);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ entries: [validEntry] });
        await expect(storage.load()).resolves.toEqual([validEntry]);

        await storage.clear();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
