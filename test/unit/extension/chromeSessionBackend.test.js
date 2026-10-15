// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ChromeSessionBackend,
    DEFAULT_SESSION_STORAGE_KEY,
} from '../../../packages/extension/src/storage/ChromeSessionBackend.js';

function memoryStorage() {
    const values = {};
    return {
        values,
        get: vi.fn(async (key) => (key in values ? { [key]: values[key] } : {})),
        set: vi.fn(async (items) => { Object.assign(values, items); }),
        remove: vi.fn(async (key) => { delete values[key]; }),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ChromeSessionBackend', () => {
    it('uses chrome.storage.session and round-trips bytes through the default key', async () => {
        const session = memoryStorage();
        vi.stubGlobal('chrome', { storage: { session } });
        const backend = new ChromeSessionBackend();

        await backend.save(Uint8Array.of(0, 1, 255));

        expect(session.set).toHaveBeenCalledWith({
            [DEFAULT_SESSION_STORAGE_KEY]: 'AAH/',
        });
        await expect(backend.load()).resolves.toEqual(Uint8Array.of(0, 1, 255));
    });

    it('honors an injected storage area and custom key', async () => {
        const chromeStorage = memoryStorage();
        const backend = new ChromeSessionBackend({ key: 'signing-secret', chromeStorage });

        await backend.save(Uint8Array.of(7));
        await backend.clear();

        expect(chromeStorage.set).toHaveBeenCalledWith({ 'signing-secret': 'Bw==' });
        expect(chromeStorage.remove).toHaveBeenCalledWith('signing-secret');
    });

    it('requires session storage even when local storage exists', () => {
        vi.stubGlobal('chrome', { storage: { local: memoryStorage() } });

        expect(() => new ChromeSessionBackend()).toThrow(
            'chrome.storage.session is not available',
        );
    });
});
