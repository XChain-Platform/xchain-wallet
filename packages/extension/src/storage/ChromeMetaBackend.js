// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ChromeMetaBackend — plaintext JSON slot in `chrome.storage.local`.
//
// Holds data the shell needs *before* the vault can be opened:
//   - `kdfParams` for the vault-level Argon2id master-key derivation.
//     The salt is public by design (Argon2id spec); memory/iterations are
//     tuning info, not secret. Storing them outside the encrypted blob is
//     the only way the unlock flow can derive the master key from the
//     user's password before touching the ciphertext.
//
// Keyed separately from `ChromeStorageBackend` so clearing the vault
// doesn't wipe the bootstrap meta and vice versa. A future piece may
// extend this to carry UI-preference defaults that should survive lock.

export const DEFAULT_META_KEY = 'xchain-wallet:vault-meta';

/**
 * @typedef {Object} ChromeStorageLike
 * @property {(keys?: string | string[] | null) => Promise<Record<string, unknown>>} get
 * @property {(items: Record<string, unknown>) => Promise<void>} set
 * @property {(keys: string | string[]) => Promise<void>} remove
 */

export class ChromeMetaBackend {
    /**
     * @param {{ key?: string, chromeStorage?: ChromeStorageLike }} [opts]
     */
    constructor(opts = {}) {
        this._key = opts.key ?? DEFAULT_META_KEY;
        this._storage =
            opts.chromeStorage ??
            /** @type {ChromeStorageLike | undefined} */ (
                globalThis.chrome?.storage?.local
            );
        if (!this._storage) {
            throw new Error(
                'ChromeMetaBackend: chrome.storage.local is not available; pass { chromeStorage } for non-extension contexts',
            );
        }
    }

    /**
     * @returns {Promise<unknown | null>}
     */
    async load() {
        const result = await this._storage.get(this._key);
        const raw = result?.[this._key];
        if (raw == null) return null;
        if (typeof raw !== 'string') {
            throw new Error(
                `ChromeMetaBackend.load: unexpected value type "${typeof raw}" at key "${this._key}"`,
            );
        }
        return JSON.parse(raw);
    }

    /**
     * @param {unknown} obj
     */
    async save(obj) {
        await this._storage.set({ [this._key]: JSON.stringify(obj) });
    }

    async clear() {
        await this._storage.remove(this._key);
    }
}
