// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
    blobPartSource,
    bytesPartSource,
} from '../../../packages/core/src/flows/filePartSource.js';
import { planMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';
import {
    planMultipartStream,
    readPlannedParts,
} from '../../../packages/core/src/flows/multipartStreamPlan.js';
import { MULTIPART_ENVELOPE_PART_CAPACITY } from '../../../packages/core/src/flows/fileSizeLimits.js';

function deterministicBytes(length, seed = 0x13579bdf) {
    const bytes = new Uint8Array(length);
    let state = seed >>> 0;
    for (let index = 0; index < length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[index] = state & 0xff;
    }
    return bytes;
}

function moderatelyCompressibleBytes(length) {
    const block = deterministicBytes(8_192, 0x2468ace0);
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += block.length) {
        bytes.set(block.subarray(0, Math.min(block.length, length - offset)), offset);
    }
    return bytes;
}

function trackedSource(bytes, reads = []) {
    return {
        size: bytes.length,
        name: 'sample.bin',
        type: 'application/octet-stream',
        async readSlice(start, end) {
            reads.push([start, end]);
            return bytes.slice(start, end);
        },
    };
}

function expectPlanParity(streamed, inMemory) {
    expect(streamed.FILE_HASH).toBe(inMemory.FILE_HASH);
    expect(streamed.parts.map((part) => part.digest))
        .toEqual(inMemory.parts.map((part) => part.digest));
    expect(streamed.parts.map((part) => part.byteLength))
        .toEqual(inMemory.parts.map((part) => part.bytes.length));
    expect(streamed.TOTAL_BYTES).toBe(inMemory.TOTAL_BYTES);
    expect(streamed.compression).toBe(inMemory.compression);
    expect(streamed.compressed).toBe(inMemory.compressed);
}

describe('multipart part sources', () => {
    it('reads isolated byte and Blob slices', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const byteSource = bytesPartSource(bytes);
        bytes[1] = 9;
        expect(await byteSource.readSlice(1, 3)).toEqual(new Uint8Array([9, 3]));

        const blobSource = blobPartSource(new Blob([bytes], {
            type: 'application/octet-stream',
        }));
        expect(blobSource.type).toBe('application/octet-stream');
        expect(await blobSource.readSlice(1, 3)).toEqual(new Uint8Array([9, 3]));
    });
});

describe('streaming multipart planning', () => {
    it.each([
        ['random', deterministicBytes(3_000_000), ''],
        ['compressible', moderatelyCompressibleBytes(3_000_000), '1'],
    ])('matches the in-memory plan for %s input', async (_label, bytes, compression) => {
        const reads = [];
        const meta = { name: 'sample.bin', type: 'application/octet-stream' };
        const source = trackedSource(bytes, reads);
        const streamed = await planMultipartStream(source, meta, {
            carrier: 'TAPROOT',
        });
        const planningReads = reads.slice();
        const inMemory = await planMultipartFile(bytes, meta, { carrier: 'TAPROOT' });
        const regenerated = [];
        for await (const part of readPlannedParts(streamed, source)) regenerated.push(part);

        expectPlanParity(streamed, inMemory);
        expect(streamed.compression).toBe(compression);
        expect(regenerated.map((part) => bytesToHex(part.bytes)))
            .toEqual(inMemory.parts.map((part) => bytesToHex(part.bytes)));
        expect(planningReads.reduce((total, [start, end]) => total + end - start, 0))
            .toBe(bytes.length);
        expect(reads.every(([start, end]) => end - start <= streamed.partCapacity)).toBe(true);
        expect(streamed.parts.every((part) => part.bytes === undefined)).toBe(true);
    });

    it('rebalances a one-byte final part without reading beyond lane capacity', async () => {
        const bytes = deterministicBytes(MULTIPART_ENVELOPE_PART_CAPACITY + 1);
        const reads = [];
        const streamed = await planMultipartStream(trackedSource(bytes, reads));
        const inMemory = await planMultipartFile(bytes);

        expectPlanParity(streamed, inMemory);
        expect(streamed.parts.map((part) => part.byteLength))
            .toEqual([MULTIPART_ENVELOPE_PART_CAPACITY - 1, 2]);
        expect(Math.max(...reads.map(([start, end]) => end - start)))
            .toBe(MULTIPART_ENVELOPE_PART_CAPACITY);
    });

    it('keeps an over-150-to-1 compression result raw', async () => {
        const bytes = new Uint8Array(1_000_000);
        const streamed = await planMultipartStream(bytesPartSource(bytes));
        const inMemory = await planMultipartFile(bytes);

        expectPlanParity(streamed, inMemory);
        expect(streamed.compression).toBe('');
        expect(streamed.totalBytes).toBe(bytes.length);
    });

    it('regenerates part 5 onward byte-identically', async () => {
        const bytes = deterministicBytes(3_000_000);
        const source = trackedSource(bytes);
        const streamed = await planMultipartStream(source);
        const inMemory = await planMultipartFile(bytes);
        const regenerated = [];

        for await (const part of readPlannedParts(streamed, source, 5)) regenerated.push(part);

        expect(regenerated.map((part) => part.partIndex))
            .toEqual(inMemory.parts.slice(5).map((part) => part.partIndex));
        expect(regenerated.map((part) => bytesToHex(part.bytes)))
            .toEqual(inMemory.parts.slice(5).map((part) => bytesToHex(part.bytes)));
    });

    it('detects bytes that change between planning and reading', async () => {
        const bytes = deterministicBytes(1_000_000);
        const source = bytesPartSource(bytes);
        const plan = await planMultipartStream(source);
        bytes[0] ^= 0xff;

        const consume = async () => {
            for await (const part of readPlannedParts(plan, source, 0)) void part;
        };
        await expect(consume()).rejects.toMatchObject({
            code: 'PART_DIGEST_CHANGED',
            partIndex: 0,
        });
    });
});
