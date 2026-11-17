// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';

function fileChangedError() {
    const error = new Error('The selected file changed after it was picked');
    error.code = 'FILE_CHANGED';
    return error;
}

function assertPickedFile(stat, size, mtimeMs) {
    if (stat.size !== size || stat.mtimeMs !== mtimeMs) throw fileChangedError();
}

async function withPickedFile(path, size, mtimeMs, callback) {
    const handle = await fs.promises.open(path, 'r');
    try {
        assertPickedFile(await handle.stat(), size, mtimeMs);
        return await callback(handle);
    } finally {
        await handle.close();
    }
}

function assertSliceRange(start, end, size) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > size) {
        throw new RangeError('Slice range must be within the selected file');
    }
}

/**
 * @param {{ path: string, size: number, mtimeMs: number, name: string, type: string }} picked
 * @returns {Promise<{ size: number, name: string, type: string, readSlice: Function }>}
 */
export async function openPathPartSource({ path, size, mtimeMs, name, type }) {
    await withPickedFile(path, size, mtimeMs, async () => {});

    return {
        size,
        name,
        type,
        async readSlice(start, end) {
            assertSliceRange(start, end, size);
            return withPickedFile(path, size, mtimeMs, async (handle) => {
                const bytes = Buffer.alloc(end - start);
                let offset = 0;
                while (offset < bytes.length) {
                    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, start + offset);
                    if (bytesRead === 0) throw fileChangedError();
                    offset += bytesRead;
                }
                return bytes;
            });
        },
    };
}
