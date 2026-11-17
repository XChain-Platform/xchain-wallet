// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { blobPartSource } from './filePartSource.js';

function fileRefError(message, code) {
    const error = new TypeError(`file ref: ${message}`);
    error.code = code;
    return error;
}

function invalidFileRef(message) {
    throw fileRefError(message, 'FILE_REF_INVALID');
}

export function assertFileRef(ref) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        invalidFileRef('must be an object');
    }
    if (typeof ref.kind !== 'string') invalidFileRef('kind must be a string');

    if (ref.kind === 'blob') {
        if (typeof ref.key !== 'string' || ref.key.length === 0) {
            invalidFileRef('blob key must be a non-empty string');
        }
    } else if (ref.kind === 'inline') {
        const { blob } = ref;
        if (!blob || (typeof blob !== 'object' && typeof blob !== 'function')
            || !('size' in blob) || typeof blob.slice !== 'function') {
            invalidFileRef('inline blob must provide size and slice');
        }
    } else if (ref.kind === 'path') {
        if (typeof ref.path !== 'string' || ref.path.length === 0) {
            invalidFileRef('path must be a non-empty string');
        }
        if (!Number.isSafeInteger(ref.size) || ref.size < 0) {
            invalidFileRef('path size must be a non-negative safe integer');
        }
    }

    return ref;
}

export function createFileRefResolver({ blobStore, kinds } = {}) {
    return async function resolveFileRef(ref) {
        assertFileRef(ref);

        if (ref.kind === 'blob' && blobStore) {
            const blob = await blobStore.get(ref.key);
            return blob == null ? null : blobPartSource(blob);
        }
        if (ref.kind === 'inline') return blobPartSource(ref.blob);

        const kindResolver = kinds && Object.prototype.hasOwnProperty.call(kinds, ref.kind)
            ? kinds[ref.kind]
            : null;
        if (typeof kindResolver === 'function') return kindResolver(ref);

        throw fileRefError(`unsupported kind: ${ref.kind}`, 'FILE_REF_UNSUPPORTED');
    };
}
