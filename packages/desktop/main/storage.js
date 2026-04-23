// File-backed StorageBackend for the desktop shell.
//
// Writes the opaque ciphertext blob to a single file under Electron's
// `app.getPath('userData')` directory. The file contains only
// already-encrypted-under-master-key bytes — see Vault's codec for
// the plaintext document shape. Losing this file is equivalent to
// losing an extension's chrome.storage.local or a web app's
// IndexedDB blob; recovery runs through the seed phrase.
//
// Atomic writes: we write to `vault.bin.tmp` and rename into place so
// a crash mid-write never leaves a half-written vault. OS rename is
// atomic on all three target platforms (POSIX `rename` + Windows
// `MoveFileEx` with MOVEFILE_REPLACE_EXISTING via fs.rename).

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
// Cross-package relative path so Node resolves this without the
// pnpm workspace symlink (smoke tests run directly against Node);
// Vite + electron-builder follow symlinks fine at build time.
import { StorageBackend } from '../../core/src/storage/backend.js';

export class FileStorageBackend extends StorageBackend {
    /**
     * @param {string} filePath   absolute path — typically
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

    /** @param {Uint8Array} blob */
    async save(blob) {
        if (!(blob instanceof Uint8Array)) {
            throw new Error('FileStorageBackend.save: blob must be a Uint8Array');
        }
        // Ensure the parent dir exists (first-run case).
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, blob, { mode: 0o600 });
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
