// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gated stored bytes use `[iv][tag][ciphertext]`. The caller must retain the
 * IV and reuse a key and IV pair only when rebuilding bytes from the same
 * original byte string. A key and IV pair must never encrypt different bytes.
 * @module gatedStoredBytes
 */

import { gcm } from '@noble/ciphers/aes';

export const GATED_IV_BYTES = 12;

const GATED_TAG_BYTES = 16;

export function freshGatedIv() {
    const iv = new Uint8Array(GATED_IV_BYTES);
    crypto.getRandomValues(iv);
    return iv;
}

export function encryptGatedStoredBytes({ stored, key, iv }) {
    requireBytes(key, 32, 'key');
    requireBytes(iv, GATED_IV_BYTES, 'iv');
    requireBytes(stored, null, 'stored');
    if (stored.length === 0) throw invalidField('stored', 'must not be empty');

    const ciphertextAndTag = gcm(key, iv).encrypt(stored);
    const ciphertextBytes = ciphertextAndTag.length - GATED_TAG_BYTES;
    const output = new Uint8Array(GATED_IV_BYTES + ciphertextAndTag.length);
    output.set(iv, 0);
    output.set(ciphertextAndTag.subarray(ciphertextBytes), GATED_IV_BYTES);
    output.set(ciphertextAndTag.subarray(0, ciphertextBytes), GATED_IV_BYTES + GATED_TAG_BYTES);
    return output;
}

function requireBytes(value, length, field) {
    if (!(value instanceof Uint8Array)) {
        throw invalidField(field, 'must be a Uint8Array');
    }
    if (length !== null && value.length !== length) {
        throw invalidField(field, `must be ${length} bytes`);
    }
}

function invalidField(field, reason) {
    const error = new Error(`gated stored bytes: ${field} ${reason}`);
    error.code = 'GATED_STORED_INVALID';
    return error;
}
