// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @vitest-environment node */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openPathPartSource } from '../../../packages/desktop/main/filePartPathSource.js';

const MIB = 1024 * 1024;
const LARGE_FILE_SIZE = 50 * MIB;
const tempDirs = [];

async function tempFile(name, bytes) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xchain-path-source-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    await fs.promises.writeFile(filePath, bytes);
    return filePath;
}

async function largeTempFile() {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xchain-path-source-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'large.bin');
    const handle = await fs.promises.open(filePath, 'w');
    const chunk = Buffer.allocUnsafe(MIB);
    for (let index = 0; index < chunk.length; index += 1) chunk[index] = index % 251;
    try {
        for (let offset = 0; offset < LARGE_FILE_SIZE; offset += chunk.length) await handle.write(chunk);
    } finally {
        await handle.close();
    }
    return filePath;
}

function expectedBytes(start, end) {
    const bytes = Buffer.allocUnsafe(end - start);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = ((start + index) % MIB) % 251;
    return bytes;
}

async function sourceFor(filePath) {
    const stat = await fs.promises.stat(filePath);
    return openPathPartSource({
        path: filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        name: path.basename(filePath),
        type: 'application/octet-stream',
    });
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('desktop path part source', () => {
    it('refuses stale size or mtime metadata at open', async () => {
        const filePath = await tempFile('stale.bin', Buffer.from('original'));
        const stat = await fs.promises.stat(filePath);
        const picked = {
            path: filePath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            name: 'stale.bin',
            type: 'application/octet-stream',
        };

        await expect(openPathPartSource({ ...picked, size: stat.size + 1 }))
            .rejects.toMatchObject({ code: 'FILE_CHANGED' });
        await expect(openPathPartSource({ ...picked, mtimeMs: stat.mtimeMs + 1 }))
            .rejects.toMatchObject({ code: 'FILE_CHANGED' });
    });

    it('reads a 50 MiB file only through byte-identical requested slices', async () => {
        const filePath = await largeTempFile();
        const realOpen = fs.promises.open.bind(fs.promises);
        const reads = [];
        const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
            const handle = await realOpen(...args);
            const realRead = handle.read.bind(handle);
            vi.spyOn(handle, 'read').mockImplementation(async (buffer, offset, length, position) => {
                reads.push({ length, position });
                return realRead(buffer, offset, length, position);
            });
            return handle;
        });
        const readFileSpy = vi.spyOn(fs.promises, 'readFile');
        const slices = [
            [0, 4096],
            [MIB - 17, MIB + 31],
            [LARGE_FILE_SIZE - 8192, LARGE_FILE_SIZE],
        ];

        const source = await sourceFor(filePath);
        expect(source).toMatchObject({ size: LARGE_FILE_SIZE, name: 'large.bin', type: 'application/octet-stream' });
        for (const [start, end] of slices) {
            expect(await source.readSlice(start, end)).toEqual(expectedBytes(start, end));
        }

        expect(readFileSpy).not.toHaveBeenCalled();
        expect(openSpy).toHaveBeenCalledTimes(1 + slices.length);
        expect(reads.reduce((total, read) => total + read.length, 0))
            .toBe(slices.reduce((total, [start, end]) => total + end - start, 0));
        for (const read of reads) {
            const slice = slices.find(([start, end]) => read.position >= start && read.position < end);
            expect(slice).toBeDefined();
            expect(read.length).toBeLessThanOrEqual(slice[1] - read.position);
        }
    });

    it('refuses a slice when the file size changed after opening', async () => {
        const filePath = await tempFile('size.bin', Buffer.from('original'));
        const source = await sourceFor(filePath);

        await fs.promises.appendFile(filePath, '!');

        await expect(source.readSlice(0, 1)).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    });

    it('refuses a slice when the file mtime changed after opening', async () => {
        const filePath = await tempFile('mtime.bin', Buffer.from('original'));
        const source = await sourceFor(filePath);
        const stat = await fs.promises.stat(filePath);
        const changedTime = new Date(stat.mtimeMs + 10_000);

        await fs.promises.utimes(filePath, changedTime, changedTime);

        await expect(source.readSlice(0, 1)).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    });
});
