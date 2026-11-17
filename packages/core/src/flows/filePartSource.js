// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

function sourceError(message) {
    const error = new TypeError(`part source: ${message}`);
    error.code = 'PART_SOURCE_INVALID';
    return error;
}

function bytesOf(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
        );
    }
    throw sourceError('bytes must be a Uint8Array, ArrayBuffer, or ArrayBuffer view');
}

function assertRange(start, end, size) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || end > size) {
        throw sourceError('readSlice range is invalid');
    }
}

function readBlobSlice(slice) {
    if (typeof slice?.arrayBuffer === 'function') return slice.arrayBuffer();
    if (typeof FileReader !== 'function') {
        throw sourceError('blob slices must provide arrayBuffer or FileReader support');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || sourceError('blob slice read failed'));
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(slice);
    });
}

export function assertPartSource(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw sourceError('must be an object');
    }
    if (!Number.isSafeInteger(source.size) || source.size < 0) {
        throw sourceError('size must be a non-negative safe integer');
    }
    if (typeof source.name !== 'string') throw sourceError('name must be a string');
    if (typeof source.type !== 'string') throw sourceError('type must be a string');
    if (typeof source.readSlice !== 'function') throw sourceError('readSlice must be a function');
    return source;
}

export function bytesPartSource(bytes) {
    const stored = bytesOf(bytes);
    return assertPartSource({
        size: stored.length,
        name: '',
        type: '',
        async readSlice(start, end) {
            assertRange(start, end, stored.length);
            return new Uint8Array(stored.subarray(start, end));
        },
    });
}

export function blobPartSource(blob) {
    if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0
        || typeof blob.slice !== 'function') {
        throw sourceError('blob must provide size and slice');
    }
    const size = blob.size;
    return assertPartSource({
        size,
        name: typeof blob.name === 'string' ? blob.name : '',
        type: typeof blob.type === 'string' ? blob.type : '',
        async readSlice(start, end) {
            assertRange(start, end, size);
            const slice = blob.slice(start, end);
            const result = new Uint8Array(await readBlobSlice(slice));
            if (result.length !== end - start) {
                throw sourceError('blob slice returned the wrong number of bytes');
            }
            return result;
        },
    });
}
