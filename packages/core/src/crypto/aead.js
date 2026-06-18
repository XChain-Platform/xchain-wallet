// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AES-256-GCM via `@noble/ciphers/aes` (§11.4 step 2).
//
// We deliberately do NOT use `crypto.subtle.encrypt` here: SubtleCrypto
// is only exposed in secure contexts (HTTPS or `localhost`), so a wallet
// loaded over plain HTTP from a LAN host would crash at unlock /
// onboarding with `Cannot read properties of undefined (reading
// 'importKey')`. `@noble/ciphers` is a pure-JS implementation that
// works in every JavaScript runtime regardless of secure-context.
// `crypto.getRandomValues` (used for IV generation below) is part of
// the Web Crypto API but is available in every context.
//
// Ciphertext format (binary concatenation):
//   [12-byte IV | ciphertext || 16-byte auth tag]
// `gcm()` from `@noble/ciphers/aes` appends the 16-byte tag to its
// ciphertext output by default, matching what Web Crypto produced, so
// blobs written by an older subtle-based build decrypt cleanly under
// the new code path and vice versa. This is wire-format-compatible.

import { gcm } from '@noble/ciphers/aes';

const IV_LENGTH = 12;        // GCM standard nonce length
const TAG_LENGTH_BYTES = 16; // GCM auth tag (128 bits)

/**
 * Encrypt `plaintext` with a 256-bit key. Optional `aad` is authenticated
 * (not encrypted) and must be supplied again at decrypt time.
 *
 * Returns a Promise (rather than a sync value) so the public surface
 * stays identical to the previous Web-Crypto-backed implementation;
 * every existing caller awaits this.
 *
 * @param {Uint8Array} key        32 bytes
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} [aad]
 * @returns {Promise<Uint8Array>} iv || ciphertext(||tag)
 */
export async function encrypt(key, plaintext, aad) {
    assertKey(key);
    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);
    const cipher = gcm(key, iv, aad && aad.length > 0 ? aad : undefined);
    const ct = cipher.encrypt(plaintext);
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return out;
}

/**
 * Decrypt a blob produced by `encrypt`. Throws on auth failure.
 *
 * @param {Uint8Array} key
 * @param {Uint8Array} blob       iv || ciphertext(||tag)
 * @param {Uint8Array} [aad]
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(key, blob, aad) {
    assertKey(key);
    if (blob.length < IV_LENGTH + TAG_LENGTH_BYTES) {
        throw new Error('aead: ciphertext too short');
    }
    const iv = blob.subarray(0, IV_LENGTH);
    const ct = blob.subarray(IV_LENGTH);
    const cipher = gcm(key, iv, aad && aad.length > 0 ? aad : undefined);
    return cipher.decrypt(ct);
}

function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        throw new Error('aead: key must be a 32-byte Uint8Array');
    }
}
