// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_STORAGE_KEY,
    IndexedDBStorageBackend,
} from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

function openingRequest({ db, error, blocked = false }) {
    const request = { result: db, error };
    queueMicrotask(() => {
        if (blocked) request.onblocked();
        else if (error) request.onerror();
        else {
            request.onupgradeneeded();
            request.onsuccess();
        }
    });
    return request;
}

function databaseForRead({ result, requestError, transactionError, abort = false } = {}) {
    const close = vi.fn();
    const createObjectStore = vi.fn();
    const db = {
        close,
        createObjectStore,
        objectStoreNames: { contains: vi.fn(() => false) },
        transaction: vi.fn(() => {
            const request = { result, error: requestError };
            const transaction = {
                error: transactionError,
                objectStore: () => ({ get: () => request }),
            };
            queueMicrotask(() => {
                if (requestError) request.onerror();
                else request.onsuccess();
                if (abort) transaction.onabort();
                else if (transactionError) transaction.onerror();
                else transaction.oncomplete();
            });
            return transaction;
        }),
    };
    return db;
}

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDBStorageBackend edge paths', () => {
    it('fails clearly when IndexedDB is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined);

        await expect(new IndexedDBStorageBackend().load())
            .rejects.toThrow(/indexedDB is not available/);
    });

    it('reports blocked and failed database opens', async () => {
        vi.stubGlobal('indexedDB', {
            open: () => openingRequest({ blocked: true }),
        });
        await expect(new IndexedDBStorageBackend({ dbName: 'blocked-db' }).load())
            .rejects.toThrow('open("blocked-db") blocked');

        const failure = new Error('connection lost');
        vi.stubGlobal('indexedDB', {
            open: () => openingRequest({ error: failure }),
        });
        await expect(new IndexedDBStorageBackend().load()).rejects.toBe(failure);
    });

    it('creates a missing store, resolves reads on commit, and closes on version changes', async () => {
        const db = databaseForRead({ result: null });
        const open = vi.fn(() => openingRequest({ db }));
        vi.stubGlobal('indexedDB', { open });

        const backend = new IndexedDBStorageBackend({ dbName: 'wallet-db', storeName: 'wallet-store' });
        await expect(Promise.all([backend.load(), backend.load()])).resolves.toEqual([null, null]);

        expect(open).toHaveBeenCalledTimes(1);
        expect(db.createObjectStore).toHaveBeenCalledWith('wallet-store');
        db.onversionchange();
        expect(db.close).toHaveBeenCalledTimes(1);
    });

    it('rejects request, transaction, and abort failures', async () => {
        const requestFailure = new Error('read failed');
        let db = databaseForRead({ requestError: requestFailure });
        vi.stubGlobal('indexedDB', { open: () => openingRequest({ db }) });
        await expect(new IndexedDBStorageBackend().load()).rejects.toBe(requestFailure);

        const transactionFailure = new Error('connection closed');
        db = databaseForRead({ transactionError: transactionFailure });
        vi.stubGlobal('indexedDB', { open: () => openingRequest({ db }) });
        await expect(new IndexedDBStorageBackend().load()).rejects.toBe(transactionFailure);

        db = databaseForRead({ abort: true });
        vi.stubGlobal('indexedDB', { open: () => openingRequest({ db }) });
        await expect(new IndexedDBStorageBackend().load()).rejects.toThrow('tx aborted');
    });

    it('refuses invalid writes and unexpected stored value types', async () => {
        const store = {
            get: vi.fn(async () => ({ encoded: 'not base64' })),
            set: vi.fn(),
            delete: vi.fn(),
        };
        const backend = new IndexedDBStorageBackend({ store });

        await expect(backend.save('ciphertext')).rejects.toThrow(/Uint8Array/);
        expect(store.set).not.toHaveBeenCalled();
        await expect(backend.load()).rejects.toThrow(/unexpected value type "object"/);
        expect(store.get).toHaveBeenCalledWith(DEFAULT_STORAGE_KEY);
    });
});
