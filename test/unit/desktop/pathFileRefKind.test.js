// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @vitest-environment node */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPathFileRefKind } from '../../../packages/desktop/main/pathFileRefKind.js';

const tempDirs = [];

async function tempFile(name, bytes) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xchain-path-ref-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    await fs.promises.writeFile(filePath, bytes);
    return filePath;
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('desktop path file reference kind', () => {
    it('opens a real file and returns its bytes and modification time', async () => {
        const bytes = Buffer.from('path-backed multipart bytes');
        const filePath = await tempFile('picked.bin', bytes);
        const fileStat = await fs.promises.stat(filePath);

        const source = await createPathFileRefKind()({
            kind: 'path',
            path: filePath,
            size: fileStat.size,
            name: 'picked.bin',
            type: 'application/octet-stream',
        });

        expect(source).toMatchObject({
            size: bytes.length,
            name: 'picked.bin',
            type: 'application/octet-stream',
            mtimeMs: fileStat.mtimeMs,
        });
        expect(await source.readSlice(0, bytes.length)).toEqual(bytes);
    });

    it('refuses stale size or modification time before opening the source', async () => {
        const filePath = await tempFile('stale.bin', Buffer.from('original'));
        const fileStat = await fs.promises.stat(filePath);
        const openSpy = vi.spyOn(fs.promises, 'open');
        const pick = createPathFileRefKind();

        await expect(pick({ kind: 'path', path: filePath, size: fileStat.size + 1 }))
            .rejects.toMatchObject({ code: 'FILE_CHANGED' });
        await expect(pick({
            kind: 'path',
            path: filePath,
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs + 1,
        })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
        expect(openSpy).not.toHaveBeenCalled();
    });

    it.each([
        { kind: 'blob', path: '/tmp/file.bin', size: 1 },
        { kind: 'path', path: '', size: 1 },
        { kind: 'path', path: '/tmp/file.bin', size: -1 },
    ])('refuses an invalid file reference %#', async (ref) => {
        const stat = vi.fn();

        await expect(createPathFileRefKind({ stat })(ref))
            .rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        expect(stat).not.toHaveBeenCalled();
    });

    it('passes computed fallback metadata to injected dependencies', async () => {
        const stat = vi.fn().mockResolvedValue({ size: 7, mtimeMs: 1234 });
        const opened = { size: 7, readSlice: vi.fn() };
        const open = vi.fn().mockResolvedValue(opened);
        const pick = createPathFileRefKind({ stat, open });

        const source = await pick({ kind: 'path', path: '/picked/fallback.bin', size: 7 });

        expect(stat).toHaveBeenCalledWith('/picked/fallback.bin');
        expect(open).toHaveBeenCalledWith({
            path: '/picked/fallback.bin',
            size: 7,
            mtimeMs: 1234,
            name: 'fallback.bin',
            type: '',
        });
        expect(source).toEqual({ ...opened, mtimeMs: 1234 });
    });

    it('passes supplied metadata to the injected opener', async () => {
        const stat = vi.fn().mockResolvedValue({ size: 9, mtimeMs: 5678 });
        const open = vi.fn().mockResolvedValue({ size: 9 });
        const pick = createPathFileRefKind({ stat, open });

        await pick({
            kind: 'path',
            path: '/picked/named.bin',
            size: 9,
            mtimeMs: 5678,
            name: 'display.bin',
            type: 'application/custom',
        });

        expect(open).toHaveBeenCalledWith({
            path: '/picked/named.bin',
            size: 9,
            mtimeMs: 5678,
            name: 'display.bin',
            type: 'application/custom',
        });
    });
});
