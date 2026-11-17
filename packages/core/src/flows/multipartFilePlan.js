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
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import pako from 'pako';
import {
    GATED_MULTIPART_MAX_BYTES,
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
    multipartPartCapacity,
} from './fileSizeLimits.js';
import {
    GATED_IV_BYTES,
    encryptGatedStoredBytes,
    freshGatedIv,
} from './gatedStoredBytes.js';
import { multipartTransactionCount, multipartWaveRanges } from './multipartWaves.js';

const { deflateRaw } = pako;
const COMPRESSION_MAX_RATIO = 150;

function asBytes(value, label = 'bytes') {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (typeof value === 'string') return utf8ToBytes(value);
    throw new TypeError(`${label} must be a Uint8Array, ArrayBuffer, or string`);
}

function field(source, camel, wire, fallback = '') {
    if (source?.[camel] !== undefined && source[camel] !== null) return source[camel];
    if (source?.[wire] !== undefined && source[wire] !== null) return source[wire];
    return fallback;
}

function rangeError(code, message, details = {}) {
    const error = new RangeError(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function storedPlaintext(original) {
    const compressed = deflateRaw(original);
    const smaller = compressed.length < original.length;
    const withinRatio = compressed.length > 0
        && original.length / compressed.length <= COMPRESSION_MAX_RATIO;
    if (smaller && withinRatio) {
        return { bytes: compressed, compressed: true, compressionField: '1' };
    }
    return { bytes: original, compressed: false, compressionField: '' };
}

function gatedIv(value) {
    if (value === undefined) return freshGatedIv();
    if (value instanceof Uint8Array && value.length === GATED_IV_BYTES) {
        return new Uint8Array(value);
    }
    if (typeof value === 'string' && /^[0-9a-f]{24}$/.test(value)) return hexToBytes(value);
    throw rangeError('GATE_IV_INVALID', 'gate.iv must be 24 lowercase hex characters or 12 bytes');
}

function prepareStoredBytes(original, gate) {
    const plain = storedPlaintext(original);
    if (gate?.key === undefined || gate.key === null) {
        return { ...plain, key: null, keyHash: '', encryptionMethod: '' };
    }
    const key = asBytes(gate.key, 'gate.key');
    if (key.length !== 32) throw new TypeError('gate.key must be 32 bytes');
    const iv = gatedIv(gate.iv);
    return {
        ...plain,
        bytes: encryptGatedStoredBytes({ stored: plain.bytes, key, iv }),
        key,
        keyHash: bytesToHex(sha256(key)),
        gateIv: bytesToHex(iv),
        encryptionMethod: field(gate, 'encryptionMethod', 'ENCRYPTION_METHOD', 1),
    };
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

function assertOriginalBounds(length, gate, carrier) {
    if (!Number.isSafeInteger(length)) return;
    if (gate && length > GATED_MULTIPART_MAX_BYTES) {
        throw rangeError('GATED_BYTES_TOO_LARGE', 'original bytes exceed the gated multipart limit', {
            originalBytes: length, maxBytes: GATED_MULTIPART_MAX_BYTES,
        });
    }
    if (length > MULTIPART_FILE_MAX_BYTES) {
        throw rangeError('ORIGINAL_BYTES_TOO_LARGE', 'original bytes exceed the multipart limit', {
            originalBytes: length, maxBytes: MULTIPART_FILE_MAX_BYTES,
        });
    }
    const { capacity, totalParts } = capacityForStoredLength(carrier, length);
    if (totalParts > MULTIPART_FILE_MAX_PARTS) {
        throw rangeError('TOO_MANY_PARTS', 'original bytes require too many multipart pieces', {
            totalParts, maxParts: MULTIPART_FILE_MAX_PARTS, capacity,
        });
    }
}

function splitStoredBytes(stored, capacity) {
    const parts = [];
    for (let offset = 0; offset < stored.length; offset += capacity) {
        parts.push(stored.slice(offset, Math.min(offset + capacity, stored.length)));
    }
    if (parts.length > 1 && parts.at(-1).length === 1) {
        const previous = parts.at(-2);
        parts[parts.length - 2] = previous.slice(0, -1);
        parts[parts.length - 1] = concatBytes(previous.slice(-1), parts.at(-1));
    }
    return parts;
}

function splitForIndexWidth(stored, carrier) {
    let digits = 2;
    for (;;) {
        const partCapacity = capacityFor(carrier, digits);
        const buffers = splitStoredBytes(stored, partCapacity);
        const needed = Math.max(2, String(buffers.length - 1).length);
        if (needed <= digits) return { partCapacity, buffers };
        digits = needed;
    }
}

function bytesOfPart(part) {
    if (part instanceof Uint8Array || part instanceof ArrayBuffer || typeof part === 'string') {
        return asBytes(part, 'part');
    }
    if (!part || typeof part !== 'object') throw new TypeError('each part must carry bytes');
    if (part.bytes !== undefined) return asBytes(part.bytes, 'part.bytes');
    if (part.rawData !== undefined) return asBytes(part.rawData, 'part.rawData');
    if (part.data !== undefined) return asBytes(part.data, 'part.data');
    if (typeof part.hex === 'string') return hexToBytes(part.hex);
    throw new TypeError('each part must carry bytes');
}

export function fileHashOf(parts) {
    if (!Array.isArray(parts) || parts.length === 0) {
        throw new TypeError('parts must be a non-empty array');
    }
    return bytesToHex(sha256(concatBytes(...parts.map((part) => sha256(bytesOfPart(part))))));
}

function buildParts(stored, carrier) {
    const { partCapacity, buffers } = splitForIndexWidth(stored, carrier);
    if (buffers.length > MULTIPART_FILE_MAX_PARTS) {
        throw rangeError('TOO_MANY_PARTS', 'stored bytes require too many multipart pieces', {
            totalParts: buffers.length, maxParts: MULTIPART_FILE_MAX_PARTS, capacity: partCapacity,
        });
    }
    const fileHash = fileHashOf(buffers);
    const parts = buffers.map((bytes, partIndex) => ({
        partIndex,
        bytes,
        rawData: bytes,
        digest: bytesToHex(sha256(bytes)),
        params: { version: 2, fileHash, partIndex },
    }));
    return { fileHash, partCapacity, parts };
}

function manifestParams(meta, gate, stored, prepared, partPlan) {
    return {
        version: 1,
        fileHash: partPlan.fileHash,
        totalParts: partPlan.parts.length,
        totalBytes: stored.length,
        name: field(meta, 'name', 'NAME'),
        type: field(meta, 'type', 'TYPE'),
        title: field(meta, 'title', 'TITLE'),
        memo: field(meta, 'memo', 'MEMO'),
        gateTicker: field(meta, 'gateTicker', 'GATE_TICKER', field(gate, 'ticker', 'GATE_TICKER')),
        encryptionMethod: prepared.encryptionMethod,
        keyHash: prepared.keyHash,
        gateMinAmount: field(meta, 'gateMinAmount', 'GATE_MIN_AMOUNT', field(gate, 'minAmount', 'GATE_MIN_AMOUNT')),
        compression: prepared.compressionField,
    };
}

export async function planMultipartFile(bytes, meta = {}, options = {}) {
    const gate = options.gate || null;
    const suppliedLength = bytes?.byteLength ?? bytes?.length;
    assertOriginalBounds(suppliedLength, gate, options.carrier);
    const original = asBytes(bytes);
    if (original.length === 0) throw rangeError('EMPTY_FILE', 'multipart files must not be empty');
    if (original.length > MULTIPART_FILE_MAX_BYTES) {
        throw rangeError('ORIGINAL_BYTES_TOO_LARGE', 'original bytes exceed the multipart limit', {
            originalBytes: original.length, maxBytes: MULTIPART_FILE_MAX_BYTES,
        });
    }
    const prepared = prepareStoredBytes(original, gate);
    if (prepared.bytes.length > MULTIPART_FILE_MAX_BYTES) {
        throw rangeError('STORED_BYTES_TOO_LARGE', 'stored bytes exceed the multipart limit', {
            storedBytes: prepared.bytes.length, maxBytes: MULTIPART_FILE_MAX_BYTES,
        });
    }
    const partPlan = buildParts(prepared.bytes, options.carrier);
    const manifest = manifestParams(meta, gate, prepared.bytes, prepared, partPlan);
    return {
        parts: partPlan.parts,
        fileHash: partPlan.fileHash,
        FILE_HASH: partPlan.fileHash,
        totalBytes: prepared.bytes.length,
        TOTAL_BYTES: prepared.bytes.length,
        totalParts: partPlan.parts.length,
        TOTAL_PARTS: partPlan.parts.length,
        partCapacity: partPlan.partCapacity,
        compression: prepared.compressionField,
        compressionField: prepared.compressionField,
        compressed: prepared.compressed,
        encryptionMethod: prepared.encryptionMethod,
        key: prepared.key,
        keyHash: prepared.keyHash,
        gateIv: prepared.gateIv ?? null,
        storedBytes: prepared.bytes,
        manifestParams: manifest,
        manifest: { params: manifest },
    };
}

/**
 * The part lengths of a file held by reference, from its size alone, so a
 * quote never reads a file the form keeps as a File. They are the split of
 * the file stored uncompressed; a file that compresses splits into fewer
 * parts, so the quote is the most the upload can cost.
 */
export function planMultipartFileBySize(size, meta = {}, options = {}) {
    if (!Number.isSafeInteger(size) || size <= 0) {
        throw rangeError('EMPTY_FILE', 'multipart files must not be empty');
    }
    assertOriginalBounds(size, options.gate || null, options.carrier);
    const { capacity, totalParts } = capacityForStoredLength(options.carrier, size);
    const lengths = Array.from({ length: totalParts }, (_, partIndex) => (
        partIndex < totalParts - 1 ? capacity : size - capacity * (totalParts - 1)
    ));
    // splitStoredBytes never leaves a one-byte last part.
    if (lengths.length > 1 && lengths.at(-1) === 1) {
        lengths[lengths.length - 2] -= 1;
        lengths[lengths.length - 1] += 1;
    }
    return {
        parts: lengths.map((byteLength, partIndex) => ({ partIndex, byteLength })),
        totalParts,
        partCapacity: capacity,
        sizeOnly: true,
    };
}

function quoteLane(lane, sizes) {
    const value = typeof lane === 'string' ? lane : lane?.type ?? lane?.kind ?? lane?.encoding;
    const normalized = String(value || '').trim().toUpperCase();
    const type = normalized === 'STANDARD' || normalized === 'P2SH' ? 'standard' : 'envelope';
    const outputFloor = Number(lane?.outputFloor ?? lane?.dustThreshold ?? sizes?.outputFloor);
    if (!Number.isSafeInteger(outputFloor) || outputFloor <= 0) {
        throw new TypeError('quoteMultipartFile: lane.outputFloor must be a positive integer');
    }
    return { type, outputFloor, revealPad: lane?.revealPad === true };
}

function pieceLengths(plan) {
    if (!plan || !Array.isArray(plan.parts) || plan.parts.length === 0) {
        throw new TypeError('quoteMultipartFile: plan.parts must be a non-empty array');
    }
    return [0, ...plan.parts.map((part) => (
        Number.isSafeInteger(part?.byteLength) && part.byteLength > 0
            ? part.byteLength
            : bytesOfPart(part).length
    ))];
}

export function quoteMultipartFile(plan, rate, lane, sizes = {}) {
    const feeRate = Number(rate);
    if (!Number.isFinite(feeRate) || feeRate <= 0) {
        throw new TypeError('quoteMultipartFile: rate must be positive');
    }
    const selected = quoteLane(lane, sizes);
    const sizeFn = selected.type === 'standard'
        ? sizes.standardPairBytes
        : sizes.envelopePairVbytes;
    if (typeof sizeFn !== 'function') {
        throw new TypeError(`quoteMultipartFile: ${selected.type} pair-size estimator is required`);
    }
    let fee = 0;
    const outputs = pieceLengths(plan).map((partBytes) => {
        const pairBytes = Number(sizeFn(partBytes));
        if (!Number.isFinite(pairBytes) || pairBytes < 0) {
            throw new TypeError('quoteMultipartFile: pair-size estimator returned an invalid size');
        }
        // The encoder floors an envelope commit fee and its reveal fee at the dust
        // floor each, and Litecoin adds a stripped-size pad output to the reveal.
        const pairFee = Math.ceil(1.25 * feeRate * pairBytes);
        // A Standard commit fee is floored at dust beside its P2SH legs.
        const pieceFee = selected.type === 'standard'
            ? Math.max(pairFee, selected.outputFloor) : Math.max(pairFee, 2 * selected.outputFloor);
        const floorCount = selected.type === 'standard'
            ? Math.ceil(partBytes / 476) + 1
            : 2 + (selected.revealPad ? 1 : 0);
        fee += pieceFee;
        return pieceFee + floorCount * selected.outputFloor;
    });
    const fundingTotal = outputs.reduce((sum, value) => sum + value, 0);
    const result = {
        parts: plan.totalParts ?? plan.parts.length,
        transactions: multipartTransactionCount(outputs.length - 1),
        outputs,
        fundingTotal,
        fee,
    };
    const ranges = multipartWaveRanges(outputs.length - 1);
    if (ranges.length > 1) {
        const fundingFees = ranges.map(({ from, to }) => {
            const outputCount = to - from + 1;
            const supplied = sizes.fundingTxVbytes;
            const vbytes = typeof supplied === 'function'
                ? Number(supplied(outputCount))
                : 192 + (34 * outputCount);
            if (!Number.isFinite(vbytes) || vbytes < 0) {
                throw new TypeError('quoteMultipartFile: funding transaction estimator returned an invalid size');
            }
            return Math.ceil(1.25 * feeRate * vbytes);
        });
        result.fundingFees = fundingFees;
        result.fundingFee = fundingFees.reduce((sum, value) => sum + value, 0);
        result.fee += result.fundingFee;
    }
    return result;
}
