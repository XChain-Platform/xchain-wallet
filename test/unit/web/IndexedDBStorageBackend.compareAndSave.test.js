// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBStorageBackend } from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

function indexedDbWithValue(initialValue) {
    let value = initialValue;
    const stores = [];
    const db = {
        objectStoreNames: { contains: () => true },
        close: vi.fn(),
        transaction: vi.fn((_storeName, mode) => {
            const tx = { error: null };
            let putStarted = false;
            const store = {
                get: vi.fn(() => {
                    const request = { result: value, error: null };
                    queueMicrotask(() => {
                        request.onsuccess?.();
                        queueMicrotask(() => {
                            if (!putStarted) tx.oncomplete?.();
                        });
                    });
                    return request;
                }),
                put: vi.fn((nextValue) => {
                    putStarted = true;
                    const request = { error: null };
                    queueMicrotask(() => {
                        value = nextValue;
                        tx.oncomplete?.();
                    });
                    return request;
                }),
            };
            stores.push({ mode, store });
            tx.objectStore = () => store;
            return tx;
        }),
    };
    const indexedDB = {
        open: () => {
            const request = { result: db };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    };
    return { indexedDB, stores, value: () => value };
}

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDBStorageBackend compare-and-save', () => {
    it('reads the expected blob and writes the replacement in one readwrite transaction', async () => {
        const fake = indexedDbWithValue('AQI=');
        vi.stubGlobal('indexedDB', fake.indexedDB);
        const backend = new IndexedDBStorageBackend();

        await backend.save(new Uint8Array([3, 4]), { expected: new Uint8Array([1, 2]) });

        expect(fake.stores).toHaveLength(1);
        expect(fake.stores[0].mode).toBe('readwrite');
        expect(fake.stores[0].store.get).toHaveBeenCalledWith('wallet-vault');
        expect(fake.stores[0].store.put).toHaveBeenCalledWith('AwQ=', 'wallet-vault');
        expect(fake.value()).toBe('AwQ=');
    });

    it('writes the first blob into an empty store when null was expected', async () => {
        const fake = indexedDbWithValue(undefined);
        vi.stubGlobal('indexedDB', fake.indexedDB);
        const backend = new IndexedDBStorageBackend();

        await backend.save(new Uint8Array([5]), { expected: null });

        expect(fake.stores).toHaveLength(1);
        expect(fake.stores[0].store.get).toHaveBeenCalledWith('wallet-vault');
        expect(fake.value()).toBe('BQ==');
    });

    it('keeps an unconditional put for a caller that passes no expected blob', async () => {
        const fake = indexedDbWithValue('AQI=');
        vi.stubGlobal('indexedDB', fake.indexedDB);
        const backend = new IndexedDBStorageBackend();

        await backend.save(new Uint8Array([6]));

        expect(fake.stores[0].store.get).not.toHaveBeenCalled();
        expect(fake.value()).toBe('Bg==');
    });

    it('writes nothing and reports a conflict when expected differs or storage was wiped', async () => {
        const fake = indexedDbWithValue('AQI=');
        vi.stubGlobal('indexedDB', fake.indexedDB);
        const backend = new IndexedDBStorageBackend();

        await expect(backend.save(new Uint8Array([3]), { expected: new Uint8Array([9]) }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });
        await expect(backend.save(new Uint8Array([3]), { expected: null }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        expect(fake.stores.every(({ store }) => store.put.mock.calls.length === 0)).toBe(true);
        expect(fake.value()).toBe('AQI=');
    });
});
