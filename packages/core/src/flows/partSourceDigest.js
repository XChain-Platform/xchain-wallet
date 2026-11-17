// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { assertPartSource } from './filePartSource.js';

export const PART_SOURCE_DIGEST_SLICE = 4_194_304;

function digestError(message) {
    const error = new TypeError(`part source digest: ${message}`);
    error.code = 'PART_SOURCE_DIGEST_INVALID';
    return error;
}

function sliceBytesOf(value, expectedLength) {
    let bytes;
    if (value instanceof Uint8Array) bytes = value;
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
        throw digestError('readSlice must return bytes');
    }
    if (bytes.length !== expectedLength) {
        throw digestError('readSlice returned the wrong number of bytes');
    }
    return bytes;
}

export async function partSourceSha256(source, { sliceBytes = PART_SOURCE_DIGEST_SLICE } = {}) {
    const input = assertPartSource(source);
    if (!Number.isSafeInteger(sliceBytes) || sliceBytes <= 0) {
        throw digestError('sliceBytes must be a positive safe integer');
    }

    const hasher = sha256.create();
    for (let start = 0; start < input.size; start += sliceBytes) {
        const end = Math.min(start + sliceBytes, input.size);
        const bytes = sliceBytesOf(await input.readSlice(start, end), end - start);
        hasher.update(bytes);
    }
    return bytesToHex(hasher.digest());
}
