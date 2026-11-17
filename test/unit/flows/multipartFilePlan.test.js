// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import vectorsFixture from '../../fixtures/multipart_file.json';
import {
    fileHashOf,
    planMultipartFile,
    quoteMultipartFile,
    planMultipartFileBySize,
} from '../../../packages/core/src/flows/multipartFilePlan.js';
import {
    FILE_MULTIPART_ACTIVATION_TIME,
    MULTIPART_ENVELOPE_PART_CAPACITY,
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
    MULTIPART_STANDARD_PART_CAPACITY,
    MAX_COMPILED_ACTION_BYTES,
    fileMultipartActivationTime,
    multipartPartCapacity,
    pushPrefixSize,
} from '../../../packages/core/src/flows/fileSizeLimits.js';

const { vectors } = vectorsFixture;
const partsOf = (vector) => vector.parts.map((part) => hexToBytes(part.hex));

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

function compiledPartSize(plan, part) {
    const action = new TextEncoder().encode(`FILE|2|${plan.fileHash}|${part.partIndex}`).length;
    return action + pushPrefixSize(action) + part.bytes.length + pushPrefixSize(part.bytes.length);
}

describe('multipart FILE protocol constants', () => {
    it('pins caps, capacities, and chain-id activation segments', () => {
        expect(MULTIPART_FILE_MAX_PARTS).toBe(65_535);
        expect(MULTIPART_FILE_MAX_BYTES).toBe(262_140_000_000);
        expect(MULTIPART_ENVELOPE_PART_CAPACITY).toBe(389_920);
        expect(MULTIPART_STANDARD_PART_CAPACITY).toBe(8_114);
        expect([2, 3, 4, 5].map((digits) => multipartPartCapacity('STANDARD', digits)))
            .toEqual([8_114, 8_113, 8_111, 8_110]);
        expect([2, 3, 4, 5].map((digits) => multipartPartCapacity('TAPROOT', digits)))
            .toEqual([389_920, 389_919, 389_917, 389_916]);
        expect(FILE_MULTIPART_ACTIVATION_TIME).toEqual({
            mainnet: null, testnet: 1_794_787_200, regtest: 0,
        });
        expect(fileMultipartActivationTime('bitcoin-testnet')).toBe(1_794_787_200);
        expect(fileMultipartActivationTime('litecoin-regtest')).toBe(0);
        expect(fileMultipartActivationTime('bitcoin-unknown')).toBeUndefined();
    });
});

describe('documentation multipart vectors', () => {
    it('reproduces every part digest and ordered FILE_HASH', () => {
        for (const vector of vectors) {
            const parts = partsOf(vector);
            parts.forEach((bytes, index) => {
                expect(bytesToHex(sha256(bytes))).toBe(vector.parts[index].digest);
            });
            expect(fileHashOf(parts)).toBe(vector.actual_file_hash ?? vector.FILE_HASH);
            expect(fileHashOf(vector.parts)).toBe(vector.actual_file_hash ?? vector.FILE_HASH);
        }
    });

    it('produces the documented deflate-raw stored bytes byte-for-byte', async () => {
        const vector = vectors.find(({ COMPRESSION }) => COMPRESSION === '1');
        const plan = await planMultipartFile(hexToBytes(vector.original_hex));
        expect(plan.compressed).toBe(true);
        expect(plan.compression).toBe('1');
        expect(bytesToHex(plan.storedBytes)).toBe(vector.parts.map((part) => part.hex).join(''));
        expect(plan.totalBytes).toBe(vector.TOTAL_BYTES);
    });

    it('binds slice boundaries as well as assembled bytes', () => {
        const naive = ['31323334', '35363738', '39'].map(hexToBytes);
        const rebalanced = partsOf(vectors.find(({ carrier_ceiling: cap }) => cap === 4));
        expect(bytesToHex(new Uint8Array(naive.flatMap((part) => [...part]))))
            .toBe(bytesToHex(new Uint8Array(rebalanced.flatMap((part) => [...part]))));
        expect(fileHashOf(naive)).not.toBe(fileHashOf(rebalanced));
    });
});

describe('multipart planning', () => {
    it('refuses an original that exceeds the Standard part ceiling before copying it', async () => {
        const capacity = multipartPartCapacity('STANDARD', 5);
        const maxBytes = capacity * MULTIPART_FILE_MAX_PARTS;
        class LengthStub extends Uint8Array {
            get byteLength() { return maxBytes + 1; }
        }
        await expect(planMultipartFile(new LengthStub(1), {}, { carrier: 'standard' }))
            .rejects.toMatchObject({
                code: 'TOO_MANY_PARTS',
                totalParts: MULTIPART_FILE_MAX_PARTS + 1,
                maxParts: MULTIPART_FILE_MAX_PARTS,
                capacity,
            });
    });

    it('uses exact capacities and rebalances a one-byte final slice', async () => {
        const envelope = await planMultipartFile(new Uint8Array(389_921));
        const standard = await planMultipartFile(new Uint8Array(8_115), {}, { carrier: 'STANDARD' });
        expect(envelope.parts.map((part) => part.bytes.length)).toEqual([389_919, 2]);
        expect(standard.parts.map((part) => part.bytes.length)).toEqual([8_113, 2]);
        expect(envelope.partCapacity).toBe(389_920);
        expect(standard.partCapacity).toBe(8_114);
    });

    it('keeps the two-digit Standard capacity for exactly 100 parts', async () => {
        const bytes = deterministicBytes(MULTIPART_STANDARD_PART_CAPACITY * 100);
        const plan = await planMultipartFile(bytes, {}, { carrier: 'STANDARD' });

        expect(plan.parts).toHaveLength(100);
        expect(plan.partCapacity).toBe(MULTIPART_STANDARD_PART_CAPACITY);
        expect(plan.parts.every((part) => part.bytes.length === MULTIPART_STANDARD_PART_CAPACITY))
            .toBe(true);
    });

    it('narrows Standard parts when the real index reaches three digits', async () => {
        const bytes = deterministicBytes(MULTIPART_STANDARD_PART_CAPACITY * 101);
        const plan = await planMultipartFile(bytes, {}, { carrier: 'STANDARD' });

        expect(plan.parts.length).toBeGreaterThan(100);
        expect(plan.partCapacity).toBeLessThan(MULTIPART_STANDARD_PART_CAPACITY);
        expect(plan.parts.every((part) => compiledPartSize(plan, part) <= MAX_COMPILED_ACTION_BYTES))
            .toBe(true);
        expect(compiledPartSize(plan, plan.parts[100])).toBe(MAX_COMPILED_ACTION_BYTES);
    });

    it('keeps a 10 MB ratio-guarded file raw and returns the SDK plan shape', async () => {
        const plan = await planMultipartFile(new Uint8Array(10_000_000), {
            name: 'zeros.bin', type: 'application/octet-stream',
        });
        expect(plan.compressed).toBe(false);
        expect(plan.compression).toBe('');
        expect(plan.parts).toHaveLength(26);
        expect(plan.parts.slice(0, -1).every((part) => part.bytes.length === 389_920)).toBe(true);
        expect(plan.totalBytes).toBe(10_000_000);
        expect(plan.manifestParams).toMatchObject({
            version: 1, fileHash: plan.fileHash, totalParts: 26, totalBytes: 10_000_000,
        });
        expect(fileHashOf(plan.parts)).toBe(plan.fileHash);
    });
});

describe('multipart funding quotes', () => {
    it('quotes the documented 26-part, 55-transaction envelope case', async () => {
        const plan = await planMultipartFile(new Uint8Array(10_000_000));
        const quote = quoteMultipartFile(plan, 2, { type: 'envelope', outputFloor: 546 }, {
            envelopePairVbytes: (partBytes) => partBytes + 100,
            standardPairBytes: () => { throw new Error('wrong lane'); },
        });
        expect(quote).toEqual({
            parts: 26,
            transactions: 55,
            outputs: expect.arrayContaining([expect.any(Number)]),
            fundingTotal: 25_037_076,
            fee: 25_007_592,
        });
        expect(quote.outputs).toHaveLength(27);
        expect(quote.outputs.reduce((sum, value) => sum + value, 0)).toBe(quote.fundingTotal);
    });

    it('floors a small envelope piece at the encoder dust floors, plus the Litecoin pad', () => {
        const plan = { parts: [{ bytes: new Uint8Array(10) }], totalParts: 1 };
        const sizes = { envelopePairVbytes: () => 434, standardPairBytes: () => { throw new Error('wrong lane'); } };
        // The rail refusals: bitcoin needed 1,638 at rate 1, litecoin 21,840 at rate 1.
        const bitcoin = quoteMultipartFile(plan, 1, { type: 'envelope', outputFloor: 546 }, sizes);
        expect(bitcoin.outputs).toEqual([2_184, 2_184]);
        const litecoin = quoteMultipartFile(plan, 1, { type: 'envelope', outputFloor: 5_460, revealPad: true }, sizes);
        expect(litecoin.outputs).toEqual([27_300, 27_300]);
        expect(litecoin.outputs[0]).toBeGreaterThanOrEqual(21_840);
    });

    it('floors a small Standard piece fee at the dust floor', () => {
        const plan = { parts: [{ bytes: new Uint8Array(10) }], totalParts: 1 };
        const quote = quoteMultipartFile(plan, 1, { type: 'standard', outputFloor: 1_000_000 }, {
            envelopePairVbytes: () => { throw new Error('wrong lane'); },
            standardPairBytes: () => 300,
        });
        // fee 1,000,000 (floor) + (chunks + 1) floors: manifest 1 chunk-free piece, part 1 chunk.
        expect(quote.outputs).toEqual([2_000_000, 3_000_000]);
    });

    it('adds one output floor per Standard chunk plus the reveal output', () => {
        const plan = { parts: [{ bytes: new Uint8Array(477) }], totalParts: 1 };
        const quote = quoteMultipartFile(plan, 4, { type: 'standard', outputFloor: 1_000 }, {
            envelopePairVbytes: () => { throw new Error('wrong lane'); },
            standardPairBytes: (partBytes) => partBytes + 10,
        });
        expect(quote.outputs).toEqual([2_000, 5_435]);
        expect(quote.fee).toBe(3_435);
        expect(quote.fundingTotal).toBe(7_435);
        expect(quote.transactions).toBe(5);
    });
});

// A file held by reference is quoted from its size; its part lengths must be
// the split the byte planner makes, at every index width boundary.
describe('planMultipartFileBySize', () => {
    it.each([390_001, 779_841, 779_842, 39_391_920])('matches the byte planner for %i bytes', async (size) => {
        const bytes = new Uint8Array(randomBytes(size));
        const byBytes = await planMultipartFile(bytes, {}, { carrier: 'envelope' });
        expect(byBytes.compressed).toBe(false);
        const bySize = planMultipartFileBySize(size, {}, { carrier: 'envelope' });
        expect(bySize.partCapacity).toBe(byBytes.partCapacity);
        expect(bySize.parts.map((part) => part.byteLength)).toEqual(byBytes.parts.map((part) => part.bytes.length));
    });
});
