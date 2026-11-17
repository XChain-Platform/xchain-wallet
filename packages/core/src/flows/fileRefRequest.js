// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

function requestError(message) {
    const error = new TypeError(`file ref request: ${message}`);
    error.code = 'FILE_REF_REQUEST_INVALID';
    return error;
}

function assertFile(file) {
    if (!file || typeof file !== 'object') {
        throw requestError('file must be an object');
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw requestError('file size must be a non-negative safe integer');
    }
    if (typeof file.slice !== 'function') {
        throw requestError('file slice must be a function');
    }
}

export async function fileRefFor(file, { blobStore, key } = {}) {
    assertFile(file);
    if (blobStore == null) return { kind: 'inline', blob: file };
    if (typeof blobStore.put !== 'function') {
        throw requestError('blobStore put must be a function');
    }
    if (typeof key !== 'string' || key.length === 0) {
        throw requestError('key must be a non-empty string');
    }
    await blobStore.put(key, file);
    return { kind: 'blob', key };
}
