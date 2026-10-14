// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBStorageBackend } from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

function transactionFactory(outcome, { storeExists = true } = {}) {
    const createObjectStore = vi.fn();
    const open = vi.fn(() => {
        const openRequest = {};
        const db = {
            objectStoreNames: { contains: () => storeExists },
            createObjectStore,
            close: vi.fn(),
            transaction: vi.fn(() => {
                const tx = {
                    error: outcome === 'transaction-error' ? new Error('transaction failed') : null,
                };
                tx.objectStore = () => ({
                    get: () => requestFor(tx, outcome, 'encoded'),
                    put: () => requestFor(tx, outcome),
                    delete: () => requestFor(tx, outcome),
                });
                return tx;
            }),
        };
        queueMicrotask(() => {
            openRequest.result = db;
            openRequest.onupgradeneeded?.();
            openRequest.onsuccess?.();
        });
        return openRequest;
    });
    return { indexedDB: { open }, createObjectStore, open };
}

function requestFor(tx, outcome, result) {
    const request = { result };
    queueMicrotask(() => {
        if (outcome === 'abort') tx.onabort?.();
        else if (outcome === 'transaction-error') tx.onerror?.();
        else if (outcome === 'request-error') {
            request.error = new Error('request failed');
            request.onerror?.();
        } else {
            request.onsuccess?.();
            tx.oncomplete?.();
        }
    });
    return request;
}

afterEach(() => {
    delete globalThis.indexedDB;
});

describe('IndexedDBStorageBackend transaction edges', () => {
    it('uses a safe fallback error when a transaction aborts without one', async () => {
        globalThis.indexedDB = transactionFactory('abort').indexedDB;
        await expect(new IndexedDBStorageBackend().load()).rejects.toThrow('tx aborted');
    });

    it('surfaces transaction and request errors', async () => {
        globalThis.indexedDB = transactionFactory('transaction-error').indexedDB;
        await expect(new IndexedDBStorageBackend().save(new Uint8Array([1])))
            .rejects.toThrow('transaction failed');

        globalThis.indexedDB = transactionFactory('request-error').indexedDB;
        await expect(new IndexedDBStorageBackend().clear()).rejects.toThrow('request failed');
    });

    it('does not recreate an object store that already exists', async () => {
        const fake = transactionFactory('success', { storeExists: true });
        globalThis.indexedDB = fake.indexedDB;

        await new IndexedDBStorageBackend().load();
        expect(fake.createObjectStore).not.toHaveBeenCalled();
    });

    it('preserves empty-string overrides because only nullish options default', async () => {
        const fake = transactionFactory('success');
        globalThis.indexedDB = fake.indexedDB;

        const backend = new IndexedDBStorageBackend({ dbName: '', storeName: '', key: '' });
        await backend.load();

        expect(fake.open).toHaveBeenCalledWith('', 1);
    });

    it('retries opening after a transient open failure', async () => {
        let calls = 0;
        const healthy = transactionFactory('success').indexedDB;
        globalThis.indexedDB = {
            open(...args) {
                calls += 1;
                if (calls > 1) return healthy.open(...args);
                const request = {};
                queueMicrotask(() => {
                    request.error = new Error('temporarily blocked');
                    request.onerror?.();
                });
                return request;
            },
        };
        const backend = new IndexedDBStorageBackend();

        await expect(backend.load()).rejects.toThrow('temporarily blocked');
        await expect(backend.load()).resolves.toBeInstanceOf(Uint8Array);
        expect(calls).toBe(2);
    });
});
