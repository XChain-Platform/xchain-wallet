// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// FileMetaBackend: plaintext JSON slot for data the shell needs
// *before* the vault can be opened (the desktop parallel of
// ChromeMetaBackend from the extension). Today that's just the vault's
// Argon2id `kdfParams`: salt + memory + iterations + parallelism. None
// of those are secret (the salt is public by design, the tuning fields
// are public tuning info), and storing them outside the ciphertext is
// the only way the unlock flow can derive the master key from the
// user's password before touching the encrypted blob.
//
// Separate file from the vault so clearing the vault doesn't wipe the
// meta and vice versa (matches ChromeMetaBackend's separate storage
// key). Atomic writes via tmp+rename so a crash mid-write can't leave
// a half-written meta file.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export class FileMetaBackend {
    /**
     * @param {string} filePath  absolute path.
     *                           typically `path.join(app.getPath('userData'), 'meta.json')`
     */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileMetaBackend: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
    }

    get filePath() { return this._filePath; }

    /** @returns {Promise<unknown | null>} */
    async load() {
        let raw;
        try {
            raw = await fs.readFile(this._filePath, 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') return null;
            throw err;
        }
        return JSON.parse(raw);
    }

    /** @param {unknown} obj */
    async save(obj) {
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, JSON.stringify(obj), { mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    async clear() {
        try {
            await fs.unlink(this._filePath);
        } catch (err) {
            if (err && err.code === 'ENOENT') return;
            throw err;
        }
    }
}

/**
 * @param {string} userDataDir
 */
export function metaPathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('metaPathFor: userDataDir is required');
    }
    return join(userDataDir, 'meta.json');
}
