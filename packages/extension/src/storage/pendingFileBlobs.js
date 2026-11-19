// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

export const DEFAULT_PENDING_FILE_BLOBS_DB_NAME = 'xchain-wallet-pending-files';
export const PENDING_FILE_BLOBS_STORE_NAME = 'pendingFileBlobs';

export class PendingFileBlobs {
    constructor(
        idbFactory = globalThis.indexedDB,
        storageManager = globalThis.navigator?.storage,
    ) {
        this._idbFactory = idbFactory;
        this._storageManager = storageManager;
        this._opening = null;
        this._persisting = null;
    }

    async put(id, blob) {
        await this._requestPersistence();
        const db = await this._database();
        await runRequest(db, 'readwrite', (store) => store.put(blob, id));
    }

    async get(id) {
        const db = await this._database();
        const value = await runRequest(db, 'readonly', (store) => store.get(id));
        return value ?? null;
    }

    async remove(id) {
        const db = await this._database();
        await runRequest(db, 'readwrite', (store) => store.delete(id));
    }

    async _database() {
        if (!this._idbFactory) {
            throw new Error('PendingFileBlobs: indexedDB is not available');
        }
        if (!this._opening) {
            this._opening = openDatabase(this._idbFactory).catch((error) => {
                this._opening = null;
                throw error;
            });
        }
        return this._opening;
    }

    _requestPersistence() {
        if (!this._persisting) {
            this._persisting = Promise.resolve()
                .then(() => this._storageManager?.persist?.())
                .catch(() => null);
        }
        return this._persisting;
    }
}

export function createPendingFileBlobs(
    idbFactory = globalThis.indexedDB,
    storageManager = globalThis.navigator?.storage,
) {
    return new PendingFileBlobs(idbFactory, storageManager);
}

function openDatabase(idbFactory) {
    return new Promise((resolve, reject) => {
        const request = idbFactory.open(DEFAULT_PENDING_FILE_BLOBS_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PENDING_FILE_BLOBS_STORE_NAME)) {
                db.createObjectStore(PENDING_FILE_BLOBS_STORE_NAME);
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(
            request.error ?? new Error('PendingFileBlobs: IndexedDB open failed'),
        );
        request.onblocked = () => reject(
            new Error('PendingFileBlobs: IndexedDB open blocked'),
        );
    });
}

function runRequest(db, mode, operation) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PENDING_FILE_BLOBS_STORE_NAME, mode);
        const request = operation(transaction.objectStore(PENDING_FILE_BLOBS_STORE_NAME));
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(
            request.error ?? new Error('PendingFileBlobs: IndexedDB request failed'),
        );
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(
            transaction.error ?? new Error('PendingFileBlobs: IndexedDB transaction failed'),
        );
        transaction.onabort = () => reject(
            transaction.error ?? new Error('PendingFileBlobs: IndexedDB transaction aborted'),
        );
    });
}
