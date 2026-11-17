// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    createPendingFileBlobs,
    PENDING_FILE_BLOBS_STORE_NAME,
} from '../../../packages/extension/src/storage/pendingFileBlobs.js';

function createIdbFactory({ blockOpen = false, failOpen = false } = {}) {
    const stores = new Map();

    function requestFor(operation, transaction) {
        const request = { result: undefined, error: null };
        queueMicrotask(() => {
            try {
                request.result = operation();
                request.onsuccess?.();
                transaction.oncomplete?.();
            } catch (error) {
                request.error = error;
                request.onerror?.();
            }
        });
        return request;
    }

    const database = {
        onversionchange: null,
        objectStoreNames: { contains: (name) => stores.has(name) },
        createObjectStore(name) {
            stores.set(name, new Map());
        },
        transaction(name) {
            const records = stores.get(name);
            const transaction = { error: null };
            transaction.objectStore = () => ({
                get: (id) => requestFor(() => records.get(id), transaction),
                put: (blob, id) => requestFor(() => records.set(id, blob), transaction),
                delete: (id) => requestFor(() => records.delete(id), transaction),
            });
            return transaction;
        },
        close: vi.fn(),
    };

    return {
        open: vi.fn(() => {
            const request = { result: database, error: null };
            queueMicrotask(() => {
                if (blockOpen) {
                    request.onblocked?.();
                    return;
                }
                if (failOpen) {
                    request.error = new Error('open failed');
                    request.onerror?.();
                    return;
                }
                request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request;
        }),
        hasStore: (name) => stores.has(name),
    };
}

describe('PendingFileBlobs', () => {
    it('stores, reads, and removes blobs by upload id', async () => {
        const idbFactory = createIdbFactory();
        const blobs = createPendingFileBlobs(idbFactory, { persist: vi.fn() });
        const blob = new Blob(['multipart bytes'], { type: 'application/octet-stream' });

        expect(await blobs.get('missing')).toBeNull();
        await blobs.put('upload-1', blob);

        const stored = await blobs.get('upload-1');
        expect(stored).toBe(blob);
        expect(stored).toBeInstanceOf(Blob);
        expect(stored.size).toBe(15);
        expect(stored.type).toBe('application/octet-stream');
        expect(idbFactory.hasStore(PENDING_FILE_BLOBS_STORE_NAME)).toBe(true);

        await blobs.remove('upload-1');
        expect(await blobs.get('upload-1')).toBeNull();
    });

    it('requests persistent storage once across concurrent and later puts', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        const blobs = createPendingFileBlobs(createIdbFactory(), { persist });

        await Promise.all([
            blobs.put('upload-1', new Blob(['one'])),
            blobs.put('upload-2', new Blob(['two'])),
        ]);
        await blobs.put('upload-3', new Blob(['three']));

        expect(persist).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['blocked', { blockOpen: true }, /blocked/],
        ['failed', { failOpen: true }, /open failed/],
    ])('rejects when opening IndexedDB is %s', async (_name, options, message) => {
        const blobs = createPendingFileBlobs(createIdbFactory(options), null);

        await expect(blobs.get('upload-1')).rejects.toThrow(message);
    });
});
