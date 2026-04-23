// IndexedDBStorageBackend — §11.2 primary store for the web-app target.
// IndexedDB is the only persistent storage available to browser SPAs
// that survives tab close (barring user-cleared site data); the
// encrypted wallet blob lives here, keyed by origin (scoped to
// wallet.xchain.io or the local dev origin in development).
//
// Bytes ↔ base64 at the wire boundary — IndexedDB supports storing
// Uint8Array via structured clone, but round-trip bytes can surface
// as slightly different typed-array flavors across browsers; base64
// keeps the encoding explicit and debuggable in DevTools storage
// inspectors.
//
// The `store` parameter is an injectable key-value adapter so tests
// can run against a Map-backed mock without fake-indexeddb. In
// production we lazy-open a real IndexedDB database + object store.

import { storage as coreStorage, crypto as coreCrypto } from '@xchain-wallet/core';

const { StorageBackend } = coreStorage;
const { bytesToBase64, base64ToBytes } = coreCrypto;

export const DEFAULT_DB_NAME = 'xchain-wallet';
export const DEFAULT_STORE_NAME = 'vault';
export const DEFAULT_STORAGE_KEY = 'wallet-vault';

/**
 * @typedef {Object} KeyValStore                   injectable minimal interface
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: unknown) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * @typedef {Object} IndexedDBStorageBackendOpts
 * @property {string} [dbName]
 * @property {string} [storeName]
 * @property {string} [key]                        record key within the store
 * @property {KeyValStore} [store]                 injected adapter; lazy-opens IDB if omitted
 */

export class IndexedDBStorageBackend extends StorageBackend {
    /** @param {IndexedDBStorageBackendOpts} [opts] */
    constructor(opts = {}) {
        super();
        this._dbName = opts.dbName ?? DEFAULT_DB_NAME;
        this._storeName = opts.storeName ?? DEFAULT_STORE_NAME;
        this._key = opts.key ?? DEFAULT_STORAGE_KEY;
        /** @type {KeyValStore | null} */
        this._store = opts.store ?? null;
        /** @type {Promise<KeyValStore> | null} */
        this._opening = null;
    }

    /** @returns {Promise<KeyValStore>} */
    async _getStore() {
        if (this._store) return this._store;
        if (!this._opening) this._opening = this._openStore();
        return this._opening;
    }

    /** @returns {Promise<KeyValStore>} */
    async _openStore() {
        const idb =
            /** @type {IDBFactory | undefined} */ (globalThis.indexedDB);
        if (!idb) {
            throw new Error(
                'IndexedDBStorageBackend: indexedDB is not available; pass { store } for non-browser contexts',
            );
        }
        const db = await openIdbDatabase(idb, this._dbName, this._storeName);
        const storeName = this._storeName;
        return {
            get: (k) => idbRequest(db, storeName, 'readonly', (s) => s.get(k)),
            set: (k, v) => idbRequest(db, storeName, 'readwrite', (s) => s.put(v, k)),
            delete: (k) => idbRequest(db, storeName, 'readwrite', (s) => s.delete(k)),
        };
    }

    async load() {
        const store = await this._getStore();
        const value = await store.get(this._key);
        if (value == null) return null;
        if (typeof value !== 'string') {
            throw new Error(
                `IndexedDBStorageBackend.load: unexpected value type "${typeof value}" at key "${this._key}"`,
            );
        }
        return base64ToBytes(value);
    }

    async save(blob) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error('IndexedDBStorageBackend.save: blob must be a Uint8Array');
        }
        const store = await this._getStore();
        await store.set(this._key, bytesToBase64(blob));
    }

    async clear() {
        const store = await this._getStore();
        await store.delete(this._key);
    }
}

// --- Private IDB plumbing ---------------------------------------------------

/**
 * @param {IDBFactory} idb
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<IDBDatabase>}
 */
function openIdbDatabase(idb, dbName, storeName) {
    return new Promise((resolve, reject) => {
        const req = idb.open(dbName, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () =>
            reject(new Error(`IndexedDBStorageBackend: open("${dbName}") blocked`));
    });
}

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 * @returns {Promise<any>}
 */
function idbRequest(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
        tx.onerror = () => reject(tx.error);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
    });
}
