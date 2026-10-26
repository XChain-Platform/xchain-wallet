// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ChromeMetaBackend,
    DEFAULT_META_KEY,
} from '../../../packages/extension/src/storage/ChromeMetaBackend.js';

function storageWith(value, key = DEFAULT_META_KEY) {
    return {
        get: vi.fn(async () => (value === undefined ? {} : { [key]: value })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ChromeMetaBackend', () => {
    it('uses chrome.storage.local and the default key when no options are passed', async () => {
        const local = storageWith(JSON.stringify({ kdf: 'argon2id' }));
        vi.stubGlobal('chrome', { storage: { local } });

        const backend = new ChromeMetaBackend();

        await expect(backend.load()).resolves.toEqual({ kdf: 'argon2id' });
        expect(local.get).toHaveBeenCalledWith(DEFAULT_META_KEY);
    });

    it('returns null for absent and explicit null values', async () => {
        await expect(new ChromeMetaBackend({ chromeStorage: storageWith(undefined) }).load())
            .resolves.toBeNull();
        await expect(new ChromeMetaBackend({ chromeStorage: storageWith(null) }).load())
            .resolves.toBeNull();
    });

    it('rejects non-string and malformed stored metadata', async () => {
        await expect(new ChromeMetaBackend({ chromeStorage: storageWith({}) }).load())
            .rejects.toMatchObject({ name: 'VaultCorruptError', message: expect.stringContaining('unexpected value type "object"') });
        await expect(new ChromeMetaBackend({ chromeStorage: storageWith('{broken') }).load())
            .rejects.toMatchObject({ name: 'VaultCorruptError' });
    });

    it('serializes writes and clears only its configured key', async () => {
        const chromeStorage = storageWith(undefined, 'custom-meta');
        const backend = new ChromeMetaBackend({ key: 'custom-meta', chromeStorage });

        await backend.save({ memory: 65536 });
        await backend.clear();

        expect(chromeStorage.set).toHaveBeenCalledWith({
            'custom-meta': JSON.stringify({ memory: 65536 }),
        });
        expect(chromeStorage.remove).toHaveBeenCalledWith('custom-meta');
    });

    it('requires an injected or global storage area', () => {
        expect(() => new ChromeMetaBackend()).toThrow('chrome.storage.local is not available');
    });
});
