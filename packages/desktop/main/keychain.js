// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// KeychainSessionBackend (§40.12): OS-keychain-backed session cache for
// the desktop shell. Parallel to ChromeSessionBackend on the extension
// side: stores the unlocked master key so subsequent app launches skip
// the password prompt until the user either explicitly locks or the
// OS-level keychain becomes unavailable (logout, keychain locked, etc.).
//
// The plaintext never touches disk. Electron's `safeStorage` wraps
// the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret) and
// returns an opaque ciphertext that only a process running under the
// same OS-user session can decrypt. We write that ciphertext to a file
// so it survives app restarts; the actual key material stays inside
// the OS keychain.
//
// If the OS keychain isn't available (headless Linux with no gnome-
// keyring / kwallet, or Electron falling back to the deterministic
// `basic_text` backend) we refuse to persist to disk. Storing the key
// there would offer no confidentiality against anyone with read access.
// The session still works for the current process: `save` holds the
// key in a module-private in-memory slot, so subsequent `load` calls
// in the same process return it, but a restart loses it and the user
// re-enters their password. Same behavior as the extension's
// chrome.storage.session on a browser restart.
//
// Same {load, save, clear} contract as ChromeSessionBackend so the
// shared pre-host handlers (wallet.unlock / wallet.lock / wallet.create
// / wallet.import) don't branch on shell.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Subset of Electron's `safeStorage` API that we actually use. Typed as
 * a duck so tests can inject a mock without importing Electron.
 *
 * @typedef {Object} SafeStorageLike
 * @property {() => boolean} isEncryptionAvailable
 * @property {(plain: string) => Buffer | Uint8Array} encryptString
 * @property {(cipher: Buffer | Uint8Array) => string} decryptString
 * @property {() => string} [getSelectedStorageBackend]
 */

export class KeychainSessionBackend {
    /**
     * @param {{ safeStorage: SafeStorageLike, filePath: string }} opts
     */
    constructor({ safeStorage, filePath }) {
        if (!safeStorage) {
            throw new Error('KeychainSessionBackend: safeStorage is required');
        }
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('KeychainSessionBackend: filePath is required');
        }
        this._safeStorage = safeStorage;
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
        /** @type {Uint8Array | null} */
        this._inMemory = null;
    }

    get filePath() { return this._filePath; }

    /**
     * True iff the OS keychain is usable for confidentiality. False
     * forces the shell back into per-launch unlock, which is the safe
     * default when no real keychain is wired up (e.g. headless Linux
     * with no gnome-keyring / kwallet).
     *
     * @returns {boolean}
     */
    isAvailable() {
        if (typeof this._safeStorage.isEncryptionAvailable !== 'function') {
            return false;
        }
        if (!this._safeStorage.isEncryptionAvailable()) return false;
        if (typeof this._safeStorage.getSelectedStorageBackend === 'function') {
            // `basic_text` means Electron fell back to a deterministic
            // scheme (no keychain-level protection, so we'd leak the
            // master key to anyone with read access to session.bin.
            // Refuse to persist in that case.
            const backend = this._safeStorage.getSelectedStorageBackend();
            if (backend === 'basic_text') return false;
        }
        return true;
    }

    /**
     * Read the cached master key. Precedence:
     *   1. In-memory slot (set by a prior `save` in this process). The
     *      shell keeps the current-session key here even when the
     *      keychain isn't available, so unlock-then-query works.
     *   2. Encrypted file on disk, decrypted via safeStorage.
     *
     * Returns null when no cache exists, the keychain is unavailable
     * and no in-memory copy is present, or the ciphertext can't be
     * decrypted (e.g. user logged in under a different OS account,
     * keychain was reset). Never throws on "no session"; callers treat
     * null as "prompt for password".
     *
     * @returns {Promise<Uint8Array | null>}
     */
    async load() {
        if (this._inMemory) return new Uint8Array(this._inMemory);
        if (!this.isAvailable()) return null;
        /** @type {Buffer | null} */
        let cipher;
        try {
            cipher = await fs.readFile(this._filePath);
        } catch (err) {
            if (err && err.code === 'ENOENT') return null;
            throw err;
        }
        try {
            const hex = this._safeStorage.decryptString(cipher);
            return hexToBytes(hex);
        } catch (_err) {
            // Corrupt ciphertext or keychain-scope mismatch. Fall back
            // to "no session"; the user can re-unlock and a fresh blob
            // will overwrite this one.
            return null;
        }
    }

    /**
     * Cache the master key. Always populates the in-memory slot so the
     * current process can round-trip load/save without a keychain. When
     * the keychain IS available, also encrypts + persists to disk so a
     * later launch in the same OS-user session can auto-unlock.
     *
     * @param {Uint8Array} blob
     */
    async save(blob) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error('KeychainSessionBackend.save: blob must be a Uint8Array');
        }
        // In-memory copy always. This is what load() checks first so
        // the current process stays unlocked even on platforms without
        // a real OS keychain.
        if (this._inMemory) this._inMemory.fill(0);
        this._inMemory = new Uint8Array(blob);

        if (!this.isAvailable()) return;
        const hex = bytesToHex(blob);
        const cipher = this._safeStorage.encryptString(hex);
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, cipher, { mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    async clear() {
        if (this._inMemory) {
            this._inMemory.fill(0);
            this._inMemory = null;
        }
        // Remove both the live ciphertext and any half-written .tmp sibling
        // a crash mid-save may have left. clear() runs on Lock/Reset, so a
        // stray session.bin.tmp holding the encrypted master key must not
        // survive the lock the user believes purged it.
        for (const p of [this._filePath, this._tmpPath]) {
            try {
                await fs.unlink(p);
            } catch (err) {
                if (err && err.code === 'ENOENT') continue;
                throw err;
            }
        }
    }
}

/**
 * Convenience path helper. Kept pure (no `electron` import) so it can
 * be used by non-Electron harnesses (tests, CLI inspection tools).
 *
 * @param {string} userDataDir
 */
export function sessionKeyPathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('sessionKeyPathFor: userDataDir is required');
    }
    return join(userDataDir, 'session.bin');
}

function bytesToHex(bytes) {
    // Single allocation via Buffer rather than `s += ...` concatenation:
    // safeStorage's encryptString takes only a string, so the master key
    // must transit one immutable (un-zeroable) hex string here. Building it
    // incrementally would additionally leave a chain of partial-prefix key
    // strings resident in the heap until GC; one allocation minimizes that
    // residue. This is the one place the key exists un-scrubbed.
    return Buffer.from(bytes).toString('hex');
}

function hexToBytes(s) {
    if (typeof s !== 'string' || s.length % 2 !== 0) {
        throw new Error('KeychainSessionBackend: invalid hex payload');
    }
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
        if (!Number.isFinite(byte)) {
            throw new Error('KeychainSessionBackend: invalid hex payload');
        }
        out[i] = byte;
    }
    return out;
}
