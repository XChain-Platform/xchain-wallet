// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import {
    blobPartSource,
    bytesPartSource,
} from '../../../packages/core/src/flows/filePartSource.js';
import {
    PART_SOURCE_DIGEST_SLICE,
    partSourceSha256,
} from '../../../packages/core/src/flows/partSourceDigest.js';

const MEBIBYTE = 1_048_576;

function expectedDigest(bytes) {
    return bytesToHex(sha256(bytes));
}

function trackedSource(bytes, reads) {
    return {
        size: bytes.length,
        name: 'tracked.bin',
        type: 'application/octet-stream',
        async readSlice(start, end) {
            reads.push([start, end]);
            return bytes.slice(start, end);
        },
    };
}

describe('part source digest', () => {
    it.each([
        ['empty', 0],
        ['one byte', 1],
        ['one digest slice', PART_SOURCE_DIGEST_SLICE],
        ['one digest slice plus one byte', PART_SOURCE_DIGEST_SLICE + 1],
        ['nine mebibytes', 9 * MEBIBYTE],
    ])('matches the in-memory digest for %s', async (_label, length) => {
        const bytes = new Uint8Array(randomBytes(length));

        await expect(partSourceSha256(bytesPartSource(bytes)))
            .resolves.toBe(expectedDigest(bytes));
    });

    it('reads nine consecutive one-mebibyte slices in order', async () => {
        const bytes = new Uint8Array(randomBytes(9 * MEBIBYTE));
        const reads = [];

        await expect(partSourceSha256(trackedSource(bytes, reads), {
            sliceBytes: MEBIBYTE,
        })).resolves.toBe(expectedDigest(bytes));
        expect(reads).toEqual(Array.from({ length: 9 }, (_unused, index) => [
            index * MEBIBYTE,
            (index + 1) * MEBIBYTE,
        ]));
        expect(reads.every(([start, end]) => end - start <= MEBIBYTE)).toBe(true);
    });

    it('digests a Blob part source', async () => {
        const bytes = new Uint8Array(randomBytes(257));
        const source = blobPartSource(new Blob([bytes]));

        await expect(partSourceSha256(source)).resolves.toBe(expectedDigest(bytes));
    });

    it.each([0, 1.5, '4'])('refuses invalid sliceBytes %j', async (sliceBytes) => {
        await expect(partSourceSha256(bytesPartSource(new Uint8Array()), { sliceBytes }))
            .rejects.toMatchObject({ code: 'PART_SOURCE_DIGEST_INVALID' });
    });

    it('refuses a short slice', async () => {
        const source = {
            size: 3,
            name: '',
            type: '',
            async readSlice() {
                return new Uint8Array(2);
            },
        };

        await expect(partSourceSha256(source))
            .rejects.toMatchObject({ code: 'PART_SOURCE_DIGEST_INVALID' });
    });

    it('preserves part-source validation', async () => {
        await expect(partSourceSha256(null))
            .rejects.toMatchObject({ code: 'PART_SOURCE_INVALID' });
    });
});
