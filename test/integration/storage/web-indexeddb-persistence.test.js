// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Storage integration: web-shell persistence across a reload (G164 / ).
//
// The web shell splits one wallet across two stores: the encrypted vault blob
// in IndexedDB (`IndexedDBStorageBackend`) and the plaintext kdfParams in
// localStorage (`WebMetaBackend`). Unlock needs BOTH, and neither survives on
// hope: a tab reload throws away the in-memory host entirely (§9.3.3), so the
// only thing standing between a user and a wallet they can no longer open is
// that these two round-trip.
//
// `backend-contract.test.js` next door covers the abstract contract against the
// in-memory backend. Nothing covered the real IndexedDB path, which is where
// the interesting behaviour lives: lazy open, the object-store upgrade, base64
// at the wire boundary, and the `versionchange` close that keeps the Locked
// screen's forgot-password wipe from deadlocking against our own connection.
//
// jsdom ships no IndexedDB, and adding a fake-indexeddb dependency for one
// suite is a poor trade, so the tests below drive the production code against
// a small IDBFactory double implementing exactly the surface the backend uses
// (open + upgradeneeded/success/error/blocked, versionchange, transactions,
// get/put/delete). Assertions are deliberately anchored on things that stay
// true regardless of the double's fidelity: the RAW record is inspected from
// the store's own map and decoded with Buffer, not with the same helper the
// backend encoded it with, and connection/upgrade counts are observed rather
// than assumed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    IndexedDBStorageBackend,
    DEFAULT_DB_NAME,
    DEFAULT_STORE_NAME,
    DEFAULT_STORAGE_KEY,
} from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';
import {
    WebMetaBackend,
    DEFAULT_META_KEY,
} from '../../../packages/web/src/storage/WebMetaBackend.js';

/**
 * Minimal IDBFactory double.
 *
 * Databases outlive connections (that is the whole point of the exercise: a
 * "reload" is a new connection over the same bytes), so records live on the
 * factory and a connection is just a view onto them.
 */
function createFakeIndexedDB({ blockOpen = false, failOpen = false } = {}) {
    /** @type {Map<string, { version: number, stores: Map<string, Map<string, unknown>>, connections: Set<any> }>} */
    const databases = new Map();
    const stats = { opens: 0, upgrades: 0, closes: 0 };

    function settle(fn, req, tx) {
        queueMicrotask(() => {
            try {
                req.result = fn();
                req.onsuccess?.();
            } catch (err) {
                req.error = err;
                req.onerror?.();
                tx?.onerror?.();
            }
        });
        return req;
    }

    function connect(dbState) {
        const conn = {
            closed: false,
            onversionchange: null,
            objectStoreNames: { contains: (name) => dbState.stores.has(name) },
            createObjectStore(name) {
                dbState.stores.set(name, new Map());
            },
            transaction(name, _mode) {
                // Real IndexedDB throws InvalidStateError here once the
                // connection is closed, and NotFoundError for an absent store.
                if (conn.closed) throw new Error('InvalidStateError: database is closed');
                const records = dbState.stores.get(name);
                if (!records) throw new Error(`NotFoundError: no object store "${name}"`);
                const tx = { onabort: null, onerror: null, error: null };
                tx.objectStore = () => ({
                    get: (k) => settle(() => records.get(k), {}, tx),
                    put: (v, k) => settle(() => { records.set(k, v); }, {}, tx),
                    delete: (k) => settle(() => { records.delete(k); }, {}, tx),
                });
                return tx;
            },
            close() {
                if (!conn.closed) stats.closes += 1;
                conn.closed = true;
                dbState.connections.delete(conn);
            },
        };
        dbState.connections.add(conn);
        return conn;
    }

    return {
        stats,
        open(name, version) {
            stats.opens += 1;
            const req = {
                result: null,
                error: null,
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null,
                onblocked: null,
            };
            queueMicrotask(() => {
                if (blockOpen) { req.onblocked?.(); return; }
                if (failOpen) {
                    req.error = new Error('open failed');
                    req.onerror?.();
                    return;
                }
                let dbState = databases.get(name);
                if (!dbState) {
                    dbState = { version: 0, stores: new Map(), connections: new Set() };
                    databases.set(name, dbState);
                }
                req.result = connect(dbState);
                if (dbState.version < version) {
                    dbState.version = version;
                    stats.upgrades += 1;
                    req.onupgradeneeded?.();
                }
                req.onsuccess?.();
            });
            return req;
        },
        /** Another realm (or the wipe path) bumping/deleting the database. */
        fireVersionChange(name = DEFAULT_DB_NAME) {
            for (const conn of [...(databases.get(name)?.connections ?? [])]) {
                conn.onversionchange?.();
            }
        },
        /** Read a record without going through the backend. */
        rawRecord(key = DEFAULT_STORAGE_KEY, name = DEFAULT_DB_NAME, store = DEFAULT_STORE_NAME) {
            return databases.get(name)?.stores.get(store)?.get(key);
        },
        openConnections(name = DEFAULT_DB_NAME) {
            return databases.get(name)?.connections.size ?? 0;
        },
        hasStore(name = DEFAULT_DB_NAME, store = DEFAULT_STORE_NAME) {
            return Boolean(databases.get(name)?.stores.has(store));
        },
    };
}

/** A stand-in for the encrypted vault blob: bytes that are not valid UTF-8. */
const VAULT_BYTES = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x80, 0x7f, 0xc3, 0x28]);

let fakeIdb = null;

beforeEach(() => {
    fakeIdb = createFakeIndexedDB();
    globalThis.indexedDB = fakeIdb;
    globalThis.localStorage?.clear?.();
});

afterEach(() => {
    delete globalThis.indexedDB;
    globalThis.localStorage?.clear?.();
});

describe('web vault persistence: IndexedDB across a tab reload', () => {
    it('round-trips the vault blob through a brand-new backend instance', async () => {
        // "Save, close the tab, come back": the module-scoped host is gone, so
        // the second backend shares nothing with the first but the database.
        await new IndexedDBStorageBackend().save(VAULT_BYTES);

        const afterReload = await new IndexedDBStorageBackend().load();

        expect(afterReload).toBeInstanceOf(Uint8Array);
        expect(Array.from(afterReload)).toEqual(Array.from(VAULT_BYTES));
    });

    it('stores base64 text, not a typed array, so the record survives clone-flavour drift', async () => {
        await new IndexedDBStorageBackend().save(VAULT_BYTES);

        const raw = fakeIdb.rawRecord();
        expect(typeof raw).toBe('string');
        // Decoded independently of the backend's own encoder.
        expect(Array.from(Buffer.from(raw, 'base64'))).toEqual(Array.from(VAULT_BYTES));
    });

    it('reports "no wallet yet" as null rather than an error on a first visit', async () => {
        expect(await new IndexedDBStorageBackend().load()).toBeNull();
    });

    it('overwrites in place, so a re-encrypted vault never coexists with the old one', async () => {
        const backend = new IndexedDBStorageBackend();
        await backend.save(VAULT_BYTES);
        await backend.save(new Uint8Array([9, 9, 9]));

        expect(Array.from(await backend.load())).toEqual([9, 9, 9]);
        expect(Array.from(Buffer.from(fakeIdb.rawRecord(), 'base64'))).toEqual([9, 9, 9]);
    });

    it('refuses to persist anything but bytes', async () => {
        const backend = new IndexedDBStorageBackend();
        await expect(backend.save('already base64')).rejects.toThrow(/Uint8Array/);
        await expect(backend.save({ blob: [1, 2] })).rejects.toThrow(/Uint8Array/);
        expect(fakeIdb.rawRecord()).toBeUndefined();
    });

    it('surfaces a non-string record loudly instead of handing back garbage bytes', async () => {
        // What an older build (or a hand-edited DevTools entry) could leave.
        await new IndexedDBStorageBackend({
            store: {
                get: async () => VAULT_BYTES,
                set: async () => {},
                delete: async () => {},
            },
        }).load().then(
            () => { throw new Error('expected load() to reject'); },
            (err) => { expect(err.message).toMatch(/unexpected value type "object"/); },
        );
    });

    it('clears the vault so the next load lands on onboarding, not a phantom unlock', async () => {
        const backend = new IndexedDBStorageBackend();
        await backend.save(VAULT_BYTES);

        await backend.clear();

        expect(await backend.load()).toBeNull();
        expect(fakeIdb.rawRecord()).toBeUndefined();
    });

    it('keeps separate keys apart, so a second store in the same database is untouched', async () => {
        const vault = new IndexedDBStorageBackend();
        const other = new IndexedDBStorageBackend({ key: 'wallet-vault-backup' });
        await vault.save(VAULT_BYTES);
        await other.save(new Uint8Array([1, 2, 3]));

        await vault.clear();

        expect(await vault.load()).toBeNull();
        expect(Array.from(await other.load())).toEqual([1, 2, 3]);
    });
});

describe('web vault persistence: the IndexedDB connection itself', () => {
    it('opens the database once and reuses it across many calls', async () => {
        const backend = new IndexedDBStorageBackend();
        // Concurrent first calls too: the open is memoised on a promise, so a
        // burst at boot must not open a connection per call.
        await Promise.all([backend.load(), backend.load(), backend.save(VAULT_BYTES)]);
        await backend.load();

        expect(fakeIdb.stats.opens).toBe(1);
        expect(fakeIdb.openConnections()).toBe(1);
    });

    it('creates the object store on first open and does not re-upgrade later', async () => {
        await new IndexedDBStorageBackend().save(VAULT_BYTES);
        expect(fakeIdb.hasStore()).toBe(true);
        expect(fakeIdb.stats.upgrades).toBe(1);

        await new IndexedDBStorageBackend().load();

        expect(fakeIdb.stats.opens).toBe(2);
        expect(fakeIdb.stats.upgrades).toBe(1);
    });

    it('closes on versionchange so the forgot-password wipe is not blocked by our own handle', async () => {
        // The Locked screen deletes the whole database. With a long-lived
        // connection still open, the delete fires onblocked, the page reloads
        // first, and the wallet survives a wipe the user was told happened.
        const backend = new IndexedDBStorageBackend();
        await backend.save(VAULT_BYTES);
        expect(fakeIdb.openConnections()).toBe(1);

        fakeIdb.fireVersionChange();

        expect(fakeIdb.openConnections()).toBe(0);
        expect(fakeIdb.stats.closes).toBe(1);
    });

    it('fails writes loudly on the closed connection rather than dropping them silently', async () => {
        const backend = new IndexedDBStorageBackend();
        await backend.save(VAULT_BYTES);
        fakeIdb.fireVersionChange();

        await expect(backend.save(new Uint8Array([7]))).rejects.toThrow(/closed/);
    });

    it('rejects when the open is blocked', async () => {
        globalThis.indexedDB = createFakeIndexedDB({ blockOpen: true });
        await expect(new IndexedDBStorageBackend().load()).rejects.toThrow(/blocked/);
    });

    it('rejects when the open errors', async () => {
        globalThis.indexedDB = createFakeIndexedDB({ failOpen: true });
        await expect(new IndexedDBStorageBackend().load()).rejects.toThrow(/open failed/);
    });

    it('explains itself when there is no IndexedDB at all (SSR / Node)', async () => {
        delete globalThis.indexedDB;
        await expect(new IndexedDBStorageBackend().load()).rejects.toThrow(
            /indexedDB is not available.*pass \{ store \}/s,
        );
    });

    it('never touches IndexedDB when a store is injected', async () => {
        const records = new Map();
        const backend = new IndexedDBStorageBackend({
            store: {
                get: async (k) => records.get(k),
                set: async (k, v) => { records.set(k, v); },
                delete: async (k) => { records.delete(k); },
            },
        });

        await backend.save(VAULT_BYTES);

        expect(fakeIdb.stats.opens).toBe(0);
        expect(Array.from(await backend.load())).toEqual(Array.from(VAULT_BYTES));
    });
});

describe('web vault persistence: kdfParams in localStorage', () => {
    it('round-trips the unlock metadata across a reload', async () => {
        const kdfParams = {
            algorithm: 'argon2id',
            salt: 'ZGVhZGJlZWY=',
            memoryKiB: 65536,
            iterations: 3,
            parallelism: 1,
        };
        await new WebMetaBackend().save({ kdfParams });

        const afterReload = await new WebMetaBackend().load();

        expect(afterReload).toEqual({ kdfParams });
        // Plaintext JSON by design (salt + tuning are not secret), and pinned
        // to the key the wipe path deletes.
        expect(JSON.parse(globalThis.localStorage.getItem(DEFAULT_META_KEY))).toEqual({ kdfParams });
    });

    it('returns null before onboarding has written anything', async () => {
        expect(await new WebMetaBackend().load()).toBeNull();
    });

    it('names the key when the stored JSON is corrupt, instead of throwing a bare SyntaxError', async () => {
        globalThis.localStorage.setItem(DEFAULT_META_KEY, '{not json');
        await expect(new WebMetaBackend().load()).rejects.toThrow(
            new RegExp(`invalid JSON at key "${DEFAULT_META_KEY}"`),
        );
    });

    it('clears the metadata', async () => {
        const meta = new WebMetaBackend();
        await meta.save({ kdfParams: { salt: 'x' } });
        await meta.clear();
        expect(await meta.load()).toBeNull();
    });

    it('explains itself when there is no localStorage (private-mode / SSR)', () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', {
            value: undefined,
            configurable: true,
        });
        try {
            expect(() => new WebMetaBackend()).toThrow(/localStorage is not available/);
        } finally {
            if (original) Object.defineProperty(globalThis, 'localStorage', original);
            else delete globalThis.localStorage;
        }
    });

    it('accepts an injected Storage-shaped stand-in', async () => {
        const map = new Map();
        const meta = new WebMetaBackend({
            storage: {
                getItem: (k) => (map.has(k) ? map.get(k) : null),
                setItem: (k, v) => { map.set(k, v); },
                removeItem: (k) => { map.delete(k); },
            },
        });

        await meta.save({ kdfParams: { salt: 'y' } });

        expect(await meta.load()).toEqual({ kdfParams: { salt: 'y' } });
        expect(globalThis.localStorage.getItem(DEFAULT_META_KEY)).toBeNull();
    });
});

describe('web vault persistence: the two halves unlock needs', () => {
    it('restores ciphertext and kdfParams together after a reload', async () => {
        await new IndexedDBStorageBackend().save(VAULT_BYTES);
        await new WebMetaBackend().save({ kdfParams: { salt: 'ZGVhZGJlZWY=' } });

        // Fresh instances: nothing carried over from before the "reload".
        const blob = await new IndexedDBStorageBackend().load();
        const meta = await new WebMetaBackend().load();

        expect(Array.from(blob)).toEqual(Array.from(VAULT_BYTES));
        expect(meta.kdfParams.salt).toBe('ZGVhZGJlZWY=');
    });

    it('leaves no half-wallet behind: clearing one store does not clear the other', async () => {
        // Both stores are wiped together by wipeWalletStorage. Each backend
        // owning only its own store is what makes that helper the single place
        // the wipe is coordinated, rather than a side effect of either class.
        const vault = new IndexedDBStorageBackend();
        const meta = new WebMetaBackend();
        await vault.save(VAULT_BYTES);
        await meta.save({ kdfParams: { salt: 'x' } });

        await vault.clear();

        expect(await vault.load()).toBeNull();
        expect(await meta.load()).toEqual({ kdfParams: { salt: 'x' } });
    });
});
