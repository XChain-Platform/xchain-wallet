// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// File-backed StorageBackend for the desktop shell.
//
// Writes the opaque ciphertext blob to a single file under Electron's
// `app.getPath('userData')` directory. The file contains only
// already-encrypted-under-master-key bytes; see Vault's codec for
// the plaintext document shape. Losing this file is equivalent to
// losing an extension's chrome.storage.local or a web app's
// IndexedDB blob; recovery runs through the seed phrase.
//
// Atomic writes: we write to `vault.bin.tmp` and rename into place so
// a crash mid-write never leaves a half-written vault. OS rename is
// atomic on all three target platforms (POSIX `rename` + Windows
// `MoveFileEx` with MOVEFILE_REPLACE_EXISTING via fs.rename).
//
// Compare-and-swap: a save that carries `expected` lands only while the file
// still holds those bytes (null = no file), as the extension and in-memory
// backends do. Every save and clear on one path runs in order, so two
// windows that onboard at once cannot both write over an empty vault, and
// two writes never share the `.tmp` sibling.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
    StorageBackend,
    VaultConflictError,
    vaultBlobsEqual,
} from '@xchain-wallet/core/storage/backend.js';

/** Tail of the write queue per vault path, shared by every backend on that path. */
const writeQueues = new Map();

function enqueueWrite(path, run) {
    const prior = writeQueues.get(path) ?? Promise.resolve();
    const next = prior.then(run, run);
    const tail = next.then(() => {}, () => {});
    writeQueues.set(path, tail);
    tail.then(() => {
        if (writeQueues.get(path) === tail) writeQueues.delete(path);
    });
    return next;
}

export class FileStorageBackend extends StorageBackend {
    /**
     * @param {string} filePath   absolute path, typically
     *                            `path.join(app.getPath('userData'), 'vault.bin')`
     */
    constructor(filePath) {
        super();
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileStorageBackend: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
    }

    get filePath() { return this._filePath; }

    async load() {
        try {
            const buf = await fs.readFile(this._filePath);
            return new Uint8Array(buf);
        } catch (err) {
            if (err && err.code === 'ENOENT') return null;
            throw err;
        }
    }

    /**
     * @param {Uint8Array} blob
     * @param {{ expected?: Uint8Array | null }} [options]   when present, the
     *   save lands only while the file holds exactly these bytes (null = no file)
     * @throws {VaultConflictError} the file no longer holds `expected`
     */
    async save(blob, options = {}) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error('FileStorageBackend.save: blob must be a Uint8Array');
        }
        const compare = options != null && Object.hasOwn(options, 'expected');
        const expected = compare ? (options.expected ?? null) : null;
        if (compare && expected !== null && !(expected instanceof Uint8Array)) {
            throw new TypeError('FileStorageBackend.save: expected must be a Uint8Array or null');
        }
        return enqueueWrite(this._filePath, async () => {
            if (compare && !vaultBlobsEqual(await this.load(), expected)) {
                throw new VaultConflictError();
            }
            // Ensure the parent dir exists (first-run case).
            await fs.mkdir(dirname(this._filePath), { recursive: true });
            await fs.writeFile(this._tmpPath, blob, { mode: 0o600 });
            await fs.rename(this._tmpPath, this._filePath);
        });
    }

    async clear() {
        return enqueueWrite(this._filePath, () => this._clearNow());
    }

    async _clearNow() {
        // Remove both the vault ciphertext and any half-written .tmp sibling
        // a crash mid-save may have left. clear() runs on Reset, so a stray
        // vault.bin.tmp holding the encrypted vault document must not outlive
        // the reset (the durable case: a user who resets then decommissions
        // the machine).
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
 * Convenience path helper that Electron main uses directly:
 *
 *     import { app } from 'electron';
 *     const backend = new FileStorageBackend(vaultPathFor(app.getPath('userData')));
 *
 * Kept pure (takes the userData dir as an argument rather than
 * importing from `electron`) so it can be unit-tested and reused by
 * non-Electron harnesses (e.g. a CLI tool that inspects a desktop
 * vault from the same machine).
 *
 * @param {string} userDataDir
 */
export function vaultPathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('vaultPathFor: userDataDir is required');
    }
    return join(userDataDir, 'vault.bin');
}
