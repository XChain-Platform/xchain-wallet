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
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import pako from 'pako';
import {
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
    multipartPartCapacity,
} from './fileSizeLimits.js';
import { assertPartSource } from './filePartSource.js';

const COMPRESSION_MAX_RATIO = 150;

function rangeError(code, message, details = {}) {
    const error = new RangeError(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function capacityFor(carrier, indexDigits = 2) {
    return multipartPartCapacity(carrier, indexDigits);
}

function capacityForStoredLength(carrier, storedBytes) {
    let digits = 2;
    for (;;) {
        const capacity = capacityFor(carrier, digits);
        const totalParts = Math.ceil(storedBytes / capacity);
        const needed = Math.max(2, String(totalParts - 1).length);
        if (needed <= digits) return { capacity, totalParts };
        digits = needed;
    }
}

function field(source, camel, wire, fallback = '') {
    if (source?.[camel] !== undefined && source[camel] !== null) return source[camel];
    if (source?.[wire] !== undefined && source[wire] !== null) return source[wire];
    return fallback;
}

function sourceBytes(value, expectedLength) {
    let bytes;
    if (value instanceof Uint8Array) bytes = value;
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
        throw rangeError('PART_SOURCE_READ_INVALID', 'readSlice must return bytes');
    }
    if (bytes.length !== expectedLength) {
        throw rangeError('PART_SOURCE_READ_INVALID', 'readSlice returned the wrong number of bytes', {
            expectedLength,
            actualLength: bytes.length,
        });
    }
    return bytes;
}

class PartCollector {
    constructor(capacity, queueParts = false) {
        this.capacity = capacity;
        this.queueParts = queueParts;
        this.current = new Uint8Array(capacity);
        this.currentLength = 0;
        this.pending = null;
        this.parts = [];
        this.ready = [];
        this.totalBytes = 0;
    }

    write(input) {
        let offset = 0;
        this.totalBytes += input.length;
        while (offset < input.length) {
            const take = Math.min(this.capacity - this.currentLength, input.length - offset);
            this.current.set(input.subarray(offset, offset + take), this.currentLength);
            this.currentLength += take;
            offset += take;
            if (this.pending && this.currentLength >= 2) this.finalize(this.pending);
            if (this.currentLength === this.capacity) {
                this.pending = this.current;
                this.current = new Uint8Array(this.capacity);
                this.currentLength = 0;
            }
        }
    }

    finalize(bytes) {
        const part = this.queueParts ? bytes.slice() : bytes;
        this.parts.push({ digest: bytesToHex(sha256(part)), byteLength: part.length });
        if (this.queueParts) this.ready.push(part);
        this.pending = null;
    }

    takeReady() {
        return this.ready.splice(0);
    }
}

function finishCollector(collector) {
    const pending = collector.pending;
    if (pending && collector.currentLength === 1) {
        collector.finalize(pending.subarray(0, pending.length - 1));
        collector.finalize(concatBytes(
            pending.subarray(-1),
            collector.current.subarray(0, 1),
        ));
    } else {
        if (pending) collector.finalize(pending);
        if (collector.currentLength > 0) {
            collector.finalize(collector.current.subarray(0, collector.currentLength));
        }
    }
    return collector.parts;
}

function deflaterFor(collector) {
    const deflater = new pako.Deflate({ raw: true });
    deflater.onData = (chunk) => collector.write(chunk);
    return deflater;
}

function pushDeflate(deflater, bytes, final = false) {
    deflater.push(bytes, final);
    if (deflater.err) {
        const error = new Error(deflater.msg || 'raw deflate failed');
        error.code = 'DEFLATE_FAILED';
        throw error;
    }
}

function fileHashOfDigests(parts) {
    const hasher = sha256.create();
    for (const part of parts) hasher.update(hexToBytes(part.digest));
    return bytesToHex(hasher.digest());
}

async function collectStoredParts(input, capacity, compressed) {
    const collector = new PartCollector(capacity);
    const deflater = compressed ? deflaterFor(collector) : null;
    for (let start = 0; start < input.size; start += capacity) {
        const end = Math.min(start + capacity, input.size);
        const bytes = sourceBytes(await input.readSlice(start, end), end - start);
        if (deflater) pushDeflate(deflater, bytes);
        else collector.write(bytes);
    }
    if (deflater) pushDeflate(deflater, new Uint8Array(), true);
    finishCollector(collector);
    return collector;
}

function manifestParams(source, meta, plan) {
    return {
        version: 1,
        fileHash: plan.fileHash,
        totalParts: plan.parts.length,
        totalBytes: plan.totalBytes,
        name: field(meta, 'name', 'NAME', source.name),
        type: field(meta, 'type', 'TYPE', source.type),
        title: field(meta, 'title', 'TITLE'),
        memo: field(meta, 'memo', 'MEMO'),
        gateTicker: field(meta, 'gateTicker', 'GATE_TICKER'),
        encryptionMethod: '',
        keyHash: '',
        gateMinAmount: field(meta, 'gateMinAmount', 'GATE_MIN_AMOUNT'),
        compression: plan.compression,
    };
}

function selectedParts(raw, compressed, originalBytes) {
    const smaller = compressed.totalBytes < originalBytes;
    const withinRatio = compressed.totalBytes > 0
        && originalBytes / compressed.totalBytes <= COMPRESSION_MAX_RATIO;
    return smaller && withinRatio
        ? { collector: compressed, compressed: true, compression: '1' }
        : { collector: raw, compressed: false, compression: '' };
}

function partDescriptors(parts, fileHash) {
    return parts.map((part, partIndex) => ({
        partIndex,
        digest: part.digest,
        byteLength: part.byteLength,
        length: part.byteLength,
        params: { version: 2, fileHash, partIndex },
    }));
}

export async function planMultipartStream(source, meta = {}, options = {}) {
    const input = assertPartSource(source);
    if (options.gate !== undefined && options.gate !== null) {
        throw rangeError('STREAM_GATED_UNSUPPORTED', 'streaming multipart planning is non-gated only');
    }
    if (input.size === 0) throw rangeError('EMPTY_FILE', 'multipart files must not be empty');
    if (input.size > MULTIPART_FILE_MAX_BYTES) {
        throw rangeError('ORIGINAL_BYTES_TOO_LARGE', 'original bytes exceed the multipart limit', {
            originalBytes: input.size, maxBytes: MULTIPART_FILE_MAX_BYTES,
        });
    }

    const initialCapacity = capacityFor(options.carrier);
    const raw = new PartCollector(initialCapacity);
    const compressed = new PartCollector(initialCapacity);
    const originalHasher = sha256.create();
    const deflater = deflaterFor(compressed);

    for (let start = 0; start < input.size; start += initialCapacity) {
        const end = Math.min(start + initialCapacity, input.size);
        const bytes = sourceBytes(await input.readSlice(start, end), end - start);
        originalHasher.update(bytes);
        raw.write(bytes);
        pushDeflate(deflater, bytes);
    }
    pushDeflate(deflater, new Uint8Array(), true);
    finishCollector(raw);
    finishCollector(compressed);

    const selected = selectedParts(raw, compressed, input.size);
    if (selected.collector.totalBytes > MULTIPART_FILE_MAX_BYTES) {
        throw rangeError('STORED_BYTES_TOO_LARGE', 'stored bytes exceed the multipart limit', {
            storedBytes: selected.collector.totalBytes, maxBytes: MULTIPART_FILE_MAX_BYTES,
        });
    }
    const sized = capacityForStoredLength(options.carrier, selected.collector.totalBytes);
    if (sized.totalParts > MULTIPART_FILE_MAX_PARTS) {
        throw rangeError('TOO_MANY_PARTS', 'stored bytes require too many multipart pieces', {
            totalParts: sized.totalParts,
            maxParts: MULTIPART_FILE_MAX_PARTS,
            capacity: sized.capacity,
        });
    }

    const stored = sized.capacity === initialCapacity
        ? selected.collector
        : await collectStoredParts(input, sized.capacity, selected.compressed);

    const fileHash = fileHashOfDigests(stored.parts);
    const parts = partDescriptors(stored.parts, fileHash);
    const plan = {
        parts,
        partDigests: parts.map((part) => part.digest),
        fileHash,
        FILE_HASH: fileHash,
        originalSha256: bytesToHex(originalHasher.digest()),
        originalBytes: input.size,
        totalBytes: selected.collector.totalBytes,
        TOTAL_BYTES: selected.collector.totalBytes,
        totalParts: parts.length,
        TOTAL_PARTS: parts.length,
        partCapacity: sized.capacity,
        compression: selected.compression,
        compressionField: selected.compression,
        compressed: selected.compressed,
        encryptionMethod: '',
        key: null,
        keyHash: '',
        gateIv: null,
    };
    const manifest = manifestParams(input, meta, plan);
    plan.manifestParams = manifest;
    plan.manifest = { params: manifest };
    return plan;
}

function digestChanged(partIndex, expected, actual) {
    const error = new Error(`multipart part ${partIndex} changed between planning and reading`);
    error.code = 'PART_DIGEST_CHANGED';
    error.partIndex = partIndex;
    error.expectedDigest = expected;
    error.actualDigest = actual;
    return error;
}

function assertReadPlan(plan, source, fromPart) {
    const input = assertPartSource(source);
    if (!plan || !Array.isArray(plan.parts) || !Number.isSafeInteger(plan.partCapacity)
        || plan.partCapacity <= 0) {
        throw new TypeError('readPlannedParts: plan is invalid');
    }
    if (!Number.isSafeInteger(fromPart) || fromPart < 0 || fromPart > plan.parts.length) {
        throw new RangeError('readPlannedParts: fromPart is out of range');
    }
    if (input.size !== plan.originalBytes) {
        throw digestChanged(0, plan.parts[0]?.digest, null);
    }
    return input;
}

function verifyPart(plan, bytes, partIndex) {
    const expected = plan.parts[partIndex];
    const actual = bytesToHex(sha256(bytes));
    if (!expected || expected.digest !== actual || expected.byteLength !== bytes.length) {
        throw digestChanged(partIndex, expected?.digest, actual);
    }
    return {
        ...expected,
        bytes,
        rawData: bytes,
    };
}

export async function* readPlannedParts(plan, source, fromPart = 0) {
    const input = assertReadPlan(plan, source, fromPart);
    const collector = new PartCollector(plan.partCapacity, true);
    const deflater = plan.compressed ? deflaterFor(collector) : null;
    let partIndex = 0;

    const readyParts = function* () {
        for (const bytes of collector.takeReady()) {
            const part = verifyPart(plan, bytes, partIndex);
            partIndex += 1;
            if (part.partIndex >= fromPart) yield part;
        }
    };

    for (let start = 0; start < input.size; start += plan.partCapacity) {
        const end = Math.min(start + plan.partCapacity, input.size);
        const bytes = sourceBytes(await input.readSlice(start, end), end - start);
        if (deflater) pushDeflate(deflater, bytes);
        else collector.write(bytes);
        yield* readyParts();
    }
    if (deflater) pushDeflate(deflater, new Uint8Array(), true);
    finishCollector(collector);
    yield* readyParts();
    if (partIndex !== plan.parts.length) {
        throw digestChanged(partIndex, plan.parts[partIndex]?.digest, null);
    }
}
