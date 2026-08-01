// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Storage backend contract: §11.2. Targets implement this in their own
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

// The three ways a load can fail to produce a blob that ISN'T "there is no
// wallet here". `load()` returning null is a factual claim about the device -
// the shells turn it straight into the create-a-wallet screen - so a backend
// that cannot answer the question must throw one of these instead of
// answering "no".
//
// This is not defensive typing for its own sake. On a native shell the blob
// sits behind an OS keystore, and a keystore is a thing that can be
// temporarily unavailable (device locked), permanently invalidated (lock
// screen removed, biometrics re-enrolled) or intact-but-unreadable (a
// truncated write). A user who is shown "create a new wallet" for a vault
// that is merely locked will do exactly what the screen tells them to, and
// the wallet they had is then one careless confirmation from being
// overwritten. Every failure mode below exists to keep that screen from
// appearing on a device that has a vault.
export class VaultUnavailableError extends Error {
    /** @param {string} [detail] */
    constructor(detail = 'storage backend is unavailable') {
        super(`vault storage unavailable: ${detail}`);
        this.name = 'VaultUnavailableError';
    }
}

/** The blob exists but cannot be read until the user authenticates. */
export class VaultLockedError extends VaultUnavailableError {
    constructor(detail = 'the device keystore is locked') {
        super(detail);
        this.name = 'VaultLockedError';
    }
}

/** The blob exists and is unreadable: bad AEAD tag, short read, bad header. */
export class VaultCorruptError extends VaultUnavailableError {
    constructor(detail = 'the stored vault failed its integrity check') {
        super(detail);
        this.name = 'VaultCorruptError';
    }
}

/**
 * Which of the three this error is, or null when it is not one of them.
 *
 * The shells catch a boot failure and keep only `err.message`, which throws
 * the type away exactly where it is needed: the screen a user sees for a
 * LOCKED keystore ("unlock your phone") is not the screen for a CORRUPT blob
 * ("your recovery phrase still holds everything"). This narrows the error
 * once, at the boundary, so all three shells branch on the same word.
 *
 * Matched on `name` BEFORE `instanceof`, and that is deliberate: an error
 * raised in another realm - a native plugin reply decoded in a different
 * bundle, a worker, an iframe - fails `instanceof` against these exact class
 * objects while still being the very error meant. That is not hypothetical
 * here; the same trap already produced a real bug in this shell's native
 * seam, where `instanceof Uint8Array` was false for a `TextEncoder` result
 * from another realm. `instanceof` stays as the fallback so a subclass that
 * sets its own `name` is still classified.
 *
 * @param {unknown} err
 * @returns {'corrupt' | 'locked' | 'unavailable' | null}
 */
export function vaultErrorKind(err) {
    const name = /** @type {any} */ (err)?.name;
    if (name === 'VaultCorruptError') return 'corrupt';
    if (name === 'VaultLockedError') return 'locked';
    if (name === 'VaultUnavailableError') return 'unavailable';
    if (err instanceof VaultCorruptError) return 'corrupt';
    if (err instanceof VaultLockedError) return 'locked';
    if (err instanceof VaultUnavailableError) return 'unavailable';
    return null;
}

/**
 * A backend stores a single opaque ciphertext blob. All record-level
 * structure lives inside the Vault document, encrypted under the master
 * key. The backend never sees plaintext.
 */
export class StorageBackend {
    /**
     * @returns {Promise<Uint8Array | null>} null = no blob persisted yet.
     *   null means ABSENT and nothing else. Implementations that can fail to
     *   READ an existing blob throw VaultLockedError / VaultCorruptError /
     *   VaultUnavailableError; returning null there would tell the shell that
     *   this device has no wallet.
     * @throws {VaultUnavailableError}
     */
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
 * In-process backend. Contents vanish on process exit; use only for
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
