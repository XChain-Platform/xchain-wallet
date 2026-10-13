// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WebMetaBackend: plaintext JSON metadata for the web shell,
// mirroring `ChromeMetaBackend`'s role in the extension.
//
// Holds vault-level kdfParams so the unlock flow can derive the master
// key from the user's password before touching the encrypted blob in
// IndexedDB. kdfParams are not secret by design: Argon2id salt is
// public and memory/iterations are tuning info.
//
// Backed by `localStorage` (survives tab close / reload) rather than
// `sessionStorage` (cleared on tab close). The vault itself lives in
// IndexedDB, which also survives reload; keeping meta in the same
// durability tier means unlock works across restarts without any
// cross-surface sync.
//
// The injectable `storage` parameter takes any `Storage`-shaped
// key/value store so tests can run against an in-memory stand-in.

export const DEFAULT_META_KEY = 'xchain-wallet:vault-meta';

function defaultStorage() {
    try {
        return /** @type {StorageLike | null} */ (globalThis.localStorage ?? null);
    } catch (_err) {
        return null;
    }
}

/**
 * @typedef {Object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

export class WebMetaBackend {
    /**
     * @param {{ key?: string, storage?: StorageLike }} [opts]
     */
    constructor(opts = {}) {
        this._key = opts.key ?? DEFAULT_META_KEY;
        this._storage = opts.storage ?? defaultStorage();
    }

    /** @returns {Promise<unknown | null>} */
    async load() {
        try {
            const raw = this._storage?.getItem(this._key);
            if (raw == null) return null;
            return JSON.parse(raw);
        } catch (_err) {
            return null;
        }
    }

    /** @param {unknown} obj */
    async save(obj) {
        try {
            if (!this._storage) throw new Error('localStorage is not available');
            this._storage.setItem(this._key, JSON.stringify(obj));
        } catch (err) {
            throw new Error(`WebMetaBackend.save: metadata could not be persisted: ${err?.message || err}`);
        }
    }

    async clear() {
        try {
            if (!this._storage) return;
            this._storage.removeItem(this._key);
        } catch (_err) {
            // A failed cleanup leaves the existing wallet metadata intact.
        }
    }
}
