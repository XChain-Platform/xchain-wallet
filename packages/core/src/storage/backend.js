// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Storage backend contract — §11.2. Targets implement this in their own
// shell packages:
//   - Web:       IndexedDB (via `idb` or raw IDB)
//   - Extension: chrome.storage.local
//   - Desktop:   encrypted file under app data dir
// `core` ships only the abstract contract + an in-memory implementation
// used for tests, demo mode, and the "no-wallet-yet" empty state.

export class AbstractBackendMethodError extends Error {
    constructor(method) {
        super(`StorageBackend: abstract method "${method}" not implemented`);
        this.name = 'AbstractBackendMethodError';
    }
}

/**
 * A backend stores a single opaque ciphertext blob. All record-level
 * structure lives inside the Vault document, encrypted under the master
 * key. The backend never sees plaintext.
 */
export class StorageBackend {
    /** @returns {Promise<Uint8Array | null>} null = no blob persisted yet */
    async load() {
        throw new AbstractBackendMethodError('load');
    }

    /** @param {Uint8Array} _blob */
    async save(_blob) {
        throw new AbstractBackendMethodError('save');
    }

    /** Remove the persisted blob. */
    async clear() {
        throw new AbstractBackendMethodError('clear');
    }
}

/**
 * In-process backend. Contents vanish on process exit — use only for
 * tests and transient demo-mode wallets.
 */
export class InMemoryBackend extends StorageBackend {
    constructor(initialBlob = null) {
        super();
        /** @type {Uint8Array | null} */
        this._blob = initialBlob ? new Uint8Array(initialBlob) : null;
    }

    async load() {
        return this._blob ? new Uint8Array(this._blob) : null;
    }

    async save(blob) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error('InMemoryBackend.save: blob must be a Uint8Array');
        }
        this._blob = new Uint8Array(blob);
    }

    async clear() {
        this._blob = null;
    }
}
