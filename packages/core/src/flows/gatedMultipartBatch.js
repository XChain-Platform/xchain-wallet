// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const MULTIPART_FILE_MAX_PARTS = 65535;
const MULTIPART_FILE_MAX_BYTES = 262140000000;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const RESERVED_TEXT = /[|;]/;

function refuse(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function assertHash(value, field, code) {
    if (!LOWERCASE_SHA256.test(String(value ?? ''))) {
        refuse(code, `${field} must be 64 lowercase hexadecimal characters`);
    }
}

function assertDecimalRange(value, field, min, max, code) {
    const decimal = typeof value === 'number' && Number.isInteger(value)
        ? String(value)
        : value;
    if (typeof decimal !== 'string' || !/^[1-9][0-9]*$/.test(decimal)) {
        refuse(code, `${field} must be a decimal integer from ${min} to ${max}`);
    }
    const number = Number(decimal);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        refuse(code, `${field} must be a decimal integer from ${min} to ${max}`);
    }
}

function text(value) {
    return value === undefined || value === null ? '' : String(value);
}

function field(params, wireName, camelName) {
    const wireValue = params?.[wireName];
    return wireValue === undefined || wireValue === null ? params?.[camelName] : wireValue;
}

function assertTextFields(fields) {
    for (const [field, value] of fields) {
        if (RESERVED_TEXT.test(value)) {
            refuse('TEXT_FIELD_RESERVED', `${field} cannot contain | or ; characters`);
        }
    }
}

/**
 * Compose a gated multipart FILE manifest and its MESSAGE key handoff as one
 * atomic BATCH. The caller supplies the already-encrypted key handoff.
 *
 * @param {{ manifest: object, keyHandoffCiphertext: string, coin: string, sourceAddress: string }} input
 * @returns {{ action: 'BATCH', params: { VERSION: '0', COMMAND: string } }}
 */
export function composeGatedManifestBatch({
    manifest, keyHandoffCiphertext, coin, sourceAddress,
}) {
    const params = manifest?.params || manifest || {};
    const fileHash = field(params, 'FILE_HASH', 'fileHash');
    const totalParts = field(params, 'TOTAL_PARTS', 'totalParts');
    const totalBytes = field(params, 'TOTAL_BYTES', 'totalBytes');
    const keyHash = field(params, 'KEY_HASH', 'keyHash');
    assertHash(fileHash, 'FILE_HASH', 'FILE_HASH_FORMAT');
    assertDecimalRange(
        totalParts, 'TOTAL_PARTS', 2, MULTIPART_FILE_MAX_PARTS, 'TOTAL_PARTS_RANGE',
    );
    assertDecimalRange(
        totalBytes, 'TOTAL_BYTES', 1, MULTIPART_FILE_MAX_BYTES, 'TOTAL_BYTES_RANGE',
    );
    assertHash(keyHash, 'KEY_HASH', 'KEY_HASH_FORMAT');

    const textFields = [
        ['NAME', text(field(params, 'NAME', 'name'))],
        ['TYPE', text(field(params, 'TYPE', 'type'))],
        ['TITLE', text(field(params, 'TITLE', 'title'))],
        ['MEMO', text(field(params, 'MEMO', 'memo'))],
        ['GATE_TICKER', text(field(params, 'GATE_TICKER', 'gateTicker'))],
        ['GATE_MIN_AMOUNT', text(field(params, 'GATE_MIN_AMOUNT', 'gateMinAmount'))],
        ['COMPRESSION', text(field(params, 'COMPRESSION', 'compression'))], ['COIN', text(coin)],
        ['SOURCE', text(sourceAddress)], ['CIPHERTEXT', text(keyHandoffCiphertext)],
    ];
    assertTextFields(textFields);
    const values = Object.fromEntries(textFields);
    const fileCommand = [
        'FILE', '1', fileHash, String(totalParts), String(totalBytes),
        values.NAME, values.TYPE, values.TITLE, values.MEMO, values.GATE_TICKER,
        '1', keyHash, values.GATE_MIN_AMOUNT, values.COMPRESSION,
    ].join('|');
    const messageCommand = [
        'MESSAGE', '2', values.COIN, values.SOURCE, values.CIPHERTEXT,
    ].join('|');
    return {
        action: 'BATCH',
        params: { VERSION: '0', COMMAND: `${fileCommand};${messageCommand}` },
    };
}
