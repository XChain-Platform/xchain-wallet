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
    FileMetaBackend,
    metaPathFor,
} from '../../../packages/desktop/main/meta.js';

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-meta-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('FileMetaBackend', () => {
    it('round-trips JSON through an atomic file and replaces earlier data', async () => {
        const path = metaPathFor(join(dir, 'profile'));
        const backend = new FileMetaBackend(path);

        expect(await backend.load()).toBe(null);
        await backend.save({ kdfParams: { salt: 'first', iterations: 3 } });
        await backend.save({ kdfParams: { salt: 'second', iterations: 4 } });

        expect(backend.filePath).toBe(path);
        expect(await backend.load()).toEqual({
            kdfParams: { salt: 'second', iterations: 4 },
        });
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
            kdfParams: { salt: 'second', iterations: 4 },
        });
        expect(existsSync(`${path}.tmp`)).toBe(false);
    });

    it('clears both the durable file and a crash-left temporary sibling', async () => {
        const path = metaPathFor(dir);
        const backend = new FileMetaBackend(path);
        await backend.save({ kdfParams: { salt: 'public' } });
        writeFileSync(`${path}.tmp`, 'partial', 'utf8');

        await backend.clear();
        await backend.clear();

        expect(existsSync(path)).toBe(false);
        expect(existsSync(`${path}.tmp`)).toBe(false);
        expect(await backend.load()).toBe(null);
    });

    it('surfaces malformed JSON rather than treating it as missing metadata', async () => {
        const path = metaPathFor(dir);
        writeFileSync(path, '{broken', 'utf8');

        await expect(new FileMetaBackend(path).load()).rejects.toBeInstanceOf(SyntaxError);
    });

    it.each([undefined, null, '', 0, {}])('rejects an invalid backend path %j', (path) => {
        expect(() => new FileMetaBackend(path)).toThrow(/filePath is required/);
    });

    it.each([undefined, null, '', 0, {}])('rejects an invalid user-data path %j', (path) => {
        expect(() => metaPathFor(path)).toThrow(/userDataDir is required/);
    });
});
