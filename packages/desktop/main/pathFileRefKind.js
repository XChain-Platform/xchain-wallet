// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';

import { openPathPartSource } from './filePartPathSource.js';

function fileRefInvalidError() {
    const error = new Error('The selected file reference is invalid');
    error.code = 'FILE_REF_INVALID';
    return error;
}

function fileChangedError() {
    const error = new Error('The selected file changed after it was picked');
    error.code = 'FILE_CHANGED';
    return error;
}

function assertPathFileRef(ref) {
    if (
        !ref
        || ref.kind !== 'path'
        || typeof ref.path !== 'string'
        || ref.path.length === 0
        || !Number.isSafeInteger(ref.size)
        || ref.size < 0
    ) {
        throw fileRefInvalidError();
    }
}

export function createPathFileRefKind({ stat = fs.promises.stat, open = openPathPartSource } = {}) {
    return async (ref) => {
        assertPathFileRef(ref);

        const fileStat = await stat(ref.path);
        if (fileStat.size !== ref.size || (ref.mtimeMs !== undefined && fileStat.mtimeMs !== ref.mtimeMs)) {
            throw fileChangedError();
        }

        const mtimeMs = ref.mtimeMs ?? fileStat.mtimeMs;
        const source = await open({
            path: ref.path,
            size: ref.size,
            mtimeMs,
            name: ref.name || path.basename(ref.path),
            type: ref.type || '',
        });
        return { ...source, mtimeMs };
    };
}
