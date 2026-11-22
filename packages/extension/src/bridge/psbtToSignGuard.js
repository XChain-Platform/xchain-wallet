// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

function decodeHex(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
        return null;
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function readCompactSize(bytes, offset) {
    if (offset >= bytes.length) return null;

    const prefix = bytes[offset];
    if (prefix < 0xfd) return { value: prefix, next: offset + 1 };

    const width = prefix === 0xfd ? 2 : prefix === 0xfe ? 4 : 8;
    if (offset + 1 + width > bytes.length) return null;

    let value = 0n;
    for (let i = 0; i < width; i += 1) {
        value |= BigInt(bytes[offset + 1 + i]) << BigInt(i * 8);
    }

    const minimum = prefix === 0xfd ? 0xfdn : prefix === 0xfe ? 0x10000n : 0x100000000n;
    if (value < minimum || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { value: Number(value), next: offset + 1 + width };
}

function keyId(bytes, offset, length) {
    let id = '';
    for (let i = 0; i < length; i += 1) {
        id += bytes[offset + i].toString(16).padStart(2, '0');
    }
    return id;
}

function readUint32LE(bytes, offset) {
    return bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24);
}

function skipTransactionVector(
    bytes,
    offset,
    count,
    fixedSize,
    trailingSize = 0,
    emptyScripts = false,
) {
    for (let i = 0; i < count; i += 1) {
        if (fixedSize > bytes.length - offset) return null;
        offset += fixedSize;

        const scriptLength = readCompactSize(bytes, offset);
        if (!scriptLength) return null;
        if (emptyScripts && scriptLength.value !== 0) return null;
        offset = scriptLength.next;
        if (scriptLength.value > bytes.length - offset) return null;
        offset += scriptLength.value;

        if (trailingSize > bytes.length - offset) return null;
        offset += trailingSize;
    }
    return offset;
}

function compactSizeValue(bytes, offset, length) {
    const end = offset + length;
    const compactSize = readCompactSize(bytes.subarray(0, end), offset);
    if (!compactSize || compactSize.next !== end) return null;
    return compactSize.value;
}

function unsignedTransactionDetails(bytes, offset, length) {
    const end = offset + length;
    if (length < 10) return null;

    const version = readUint32LE(bytes, offset);
    offset += 4;

    const inputCount = readCompactSize(bytes.subarray(0, end), offset);
    if (!inputCount) return null;
    offset = skipTransactionVector(
        bytes.subarray(0, end),
        inputCount.next,
        inputCount.value,
        36,
        4,
        true,
    );
    if (offset === null) return null;

    const outputCount = readCompactSize(bytes.subarray(0, end), offset);
    if (!outputCount) return null;
    offset = skipTransactionVector(bytes.subarray(0, end), outputCount.next, outputCount.value, 8);
    if (offset === null || end - offset !== 4) return null;

    return {
        version,
        inputCount: inputCount.value,
        outputCount: outputCount.value,
    };
}

function skipMap(bytes, initialOffset) {
    let offset = initialOffset;
    const seenKeys = new Set();

    while (true) {
        const keyLength = readCompactSize(bytes, offset);
        if (!keyLength) return null;
        offset = keyLength.next;

        if (keyLength.value === 0) return offset;
        if (keyLength.value > bytes.length - offset) return null;

        const id = keyId(bytes, offset, keyLength.value);
        if (seenKeys.has(id)) return null;
        seenKeys.add(id);
        offset += keyLength.value;

        const valueLength = readCompactSize(bytes, offset);
        if (!valueLength) return null;
        offset = valueLength.next;
        if (valueLength.value > bytes.length - offset) return null;
        offset += valueLength.value;
    }
}

function skipMaps(bytes, initialOffset, count) {
    let offset = initialOffset;
    for (let i = 0; i < count; i += 1) {
        offset = skipMap(bytes, offset);
        if (offset === null) return null;
    }
    return offset;
}

/**
 * Classifies a PSBT by the transaction version recorded in its global map.
 *
 * @param {unknown} psbtHex
 * @returns {'to_sign' | 'ok' | 'unparsed'}
 */
export function psbtToSignVerdict(psbtHex) {
    try {
        const bytes = decodeHex(psbtHex);
        if (!bytes || bytes.length < PSBT_MAGIC.length + 1) return 'unparsed';
        if (PSBT_MAGIC.some((byte, index) => bytes[index] !== byte)) return 'unparsed';

        let offset = PSBT_MAGIC.length;
        let transactionVersion = null;
        let transactionCounts = null;
        let globalInputCount = null;
        let globalOutputCount = null;
        let psbtVersion = null;
        const seenKeys = new Set();

        while (true) {
            const keyLength = readCompactSize(bytes, offset);
            if (!keyLength) return 'unparsed';
            offset = keyLength.next;

            if (keyLength.value === 0) break;
            if (keyLength.value > bytes.length - offset) return 'unparsed';

            const keyOffset = offset;
            const id = keyId(bytes, keyOffset, keyLength.value);
            if (seenKeys.has(id)) return 'unparsed';
            seenKeys.add(id);
            offset += keyLength.value;

            const valueLength = readCompactSize(bytes, offset);
            if (!valueLength) return 'unparsed';
            offset = valueLength.next;
            if (valueLength.value > bytes.length - offset) return 'unparsed';

            const keyType = bytes[keyOffset];
            if (keyType === 0x00 || keyType === 0x02) {
                if (keyLength.value !== 1 || transactionVersion !== null) return 'unparsed';
                if (keyType === 0x02 && valueLength.value !== 4) return 'unparsed';

                if (keyType === 0x00) {
                    const transaction = unsignedTransactionDetails(bytes, offset, valueLength.value);
                    if (!transaction) return 'unparsed';
                    transactionVersion = transaction.version;
                    transactionCounts = transaction;
                } else {
                    transactionVersion = readUint32LE(bytes, offset);
                }
            } else if (keyType === 0x04 || keyType === 0x05) {
                if (keyLength.value !== 1) return 'unparsed';
                const count = compactSizeValue(bytes, offset, valueLength.value);
                if (count === null) return 'unparsed';

                if (keyType === 0x04) globalInputCount = count;
                else globalOutputCount = count;
            } else if (keyType === 0xfb) {
                if (keyLength.value !== 1 || valueLength.value !== 4) return 'unparsed';
                psbtVersion = readUint32LE(bytes, offset);
                if (psbtVersion !== 0 && psbtVersion !== 2) return 'unparsed';
            }

            offset += valueLength.value;
        }

        if (transactionVersion === null) return 'unparsed';

        let inputCount;
        let outputCount;
        if (transactionCounts) {
            if (psbtVersion !== null && psbtVersion !== 0) return 'unparsed';
            if (globalInputCount !== null || globalOutputCount !== null) return 'unparsed';
            inputCount = transactionCounts.inputCount;
            outputCount = transactionCounts.outputCount;
        } else {
            if (psbtVersion !== 2) return 'unparsed';
            if (globalInputCount === null || globalOutputCount === null) return 'unparsed';
            inputCount = globalInputCount;
            outputCount = globalOutputCount;
        }

        offset = skipMaps(bytes, offset, inputCount);
        if (offset === null) return 'unparsed';
        offset = skipMaps(bytes, offset, outputCount);
        if (offset === null || offset !== bytes.length) return 'unparsed';

        return transactionVersion === 0 ? 'to_sign' : 'ok';
    } catch {
        return 'unparsed';
    }
}
