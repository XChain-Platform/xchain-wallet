/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    FileStorageBackend,
    vaultPathFor,
} from '../../../packages/desktop/main/storage.js';

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-storage-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('FileStorageBackend', () => {
    it('round-trips opaque bytes through an atomic file', async () => {
        const path = vaultPathFor(join(dir, 'profile'));
        const backend = new FileStorageBackend(path);
        const ciphertext = new Uint8Array([0, 1, 127, 128, 255]);

        expect(await backend.load()).toBe(null);
        await backend.save(ciphertext);

        expect(backend.filePath).toBe(path);
        expect(await backend.load()).toEqual(ciphertext);
        expect([...await readFile(path)]).toEqual([...ciphertext]);
        expect(existsSync(`${path}.tmp`)).toBe(false);
    });

    it('refuses values that are not byte arrays', async () => {
        const backend = new FileStorageBackend(vaultPathFor(dir));

        await expect(backend.save([1, 2, 3])).rejects.toThrow(/Uint8Array/);
        await expect(backend.save('ciphertext')).rejects.toThrow(/Uint8Array/);
        expect(await backend.load()).toBe(null);
    });

    it('clears both the vault and a crash-left temporary sibling', async () => {
        const path = vaultPathFor(dir);
        const backend = new FileStorageBackend(path);
        await backend.save(new Uint8Array([4, 5, 6]));
        writeFileSync(`${path}.tmp`, Buffer.from([7, 8]));

        await backend.clear();
        await backend.clear();

        expect(existsSync(path)).toBe(false);
        expect(existsSync(`${path}.tmp`)).toBe(false);
        expect(await backend.load()).toBe(null);
    });

    it.each([undefined, null, '', 0, {}])('rejects an invalid backend path %j', (path) => {
        expect(() => new FileStorageBackend(path)).toThrow(/filePath is required/);
    });

    it.each([undefined, null, '', 0, {}])('rejects an invalid user-data path %j', (path) => {
        expect(() => vaultPathFor(path)).toThrow(/userDataDir is required/);
    });
});
