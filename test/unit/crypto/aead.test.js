// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the wallet's AEAD primitive (AES-256-GCM via
// @noble/ciphers). Covers the round-trip property, AAD binding,
// blob-format guarantees, and refusal paths for malformed input.

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, AeadAuthError } from '../../../packages/core/src/crypto/aead.js';

const KEY_32 = new Uint8Array(32).fill(7);
const PLAINTEXT = new TextEncoder().encode('hello xchain');

describe('crypto/aead', () => {
    describe('encrypt + decrypt', () => {
        it('round-trips plaintext with no AAD', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT);
            const pt = await decrypt(KEY_32, ct);
            expect(new TextDecoder().decode(pt)).toBe('hello xchain');
        });

        it('round-trips plaintext with AAD', async () => {
            const aad = new TextEncoder().encode('vault-v2');
            const ct = await encrypt(KEY_32, PLAINTEXT, aad);
            const pt = await decrypt(KEY_32, ct, aad);
            expect(new TextDecoder().decode(pt)).toBe('hello xchain');
        });

        it('emits IV ‖ ciphertext-with-tag in the wire format', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT);
            // Format = 12 byte IV + ciphertext + 16 byte GCM tag.
            // Plaintext is 12 bytes here; total = 12 + 12 + 16 = 40.
            expect(ct.length).toBe(12 + PLAINTEXT.length + 16);
        });

        it('produces unique ciphertexts across calls (random IV)', async () => {
            const a = await encrypt(KEY_32, PLAINTEXT);
            const b = await encrypt(KEY_32, PLAINTEXT);
            expect(a).not.toEqual(b);
        });
    });

    describe('decrypt failure modes', () => {
        it('throws on a wrong-AAD decryption (auth fails)', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT, new Uint8Array([1]));
            await expect(decrypt(KEY_32, ct, new Uint8Array([2]))).rejects.toThrow();
        });

        it('throws on a wrong-key decryption (auth fails)', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT);
            const otherKey = new Uint8Array(32).fill(8);
            await expect(decrypt(otherKey, ct)).rejects.toThrow();
        });

        it('throws on a too-short ciphertext blob', async () => {
            const blob = new Uint8Array(20);
            await expect(decrypt(KEY_32, blob)).rejects.toThrow(/too short/);
        });

        it('throws when the auth tag has been mangled', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT);
            const mangled = ct.slice();
            mangled[mangled.length - 1] ^= 0xff;
            await expect(decrypt(KEY_32, mangled)).rejects.toThrow();
        });

        // Callers decide "wrong password" on the TYPE, not on error text: a
        // message heuristic also matched storage and application faults, and
        // unlock charged those to its lockout ladder.
        it('types a tag mismatch as AeadAuthError', async () => {
            const ct = await encrypt(KEY_32, PLAINTEXT);
            const otherKey = new Uint8Array(32).fill(8);
            const err = await decrypt(otherKey, ct).catch((e) => e);
            expect(err).toBeInstanceOf(AeadAuthError);
            expect(err.name).toBe('AeadAuthError');
            expect(err).toBeInstanceOf(Error);
            // The library's own wording is preserved for anything still
            // reading the message.
            expect(err.message).toMatch(/tag/i);
        });

        it('leaves format and key faults as plain errors, not auth failures', async () => {
            const short = await decrypt(KEY_32, new Uint8Array(20)).catch((e) => e);
            expect(short.name).not.toBe('AeadAuthError');

            const ct = await encrypt(KEY_32, PLAINTEXT);
            const badKey = await decrypt(new Uint8Array(16), ct).catch((e) => e);
            expect(badKey.name).not.toBe('AeadAuthError');
        });
    });

    describe('key validation', () => {
        it('rejects a non-Uint8Array key', async () => {
            await expect(encrypt('hex-string', PLAINTEXT)).rejects.toThrow(/key/);
        });

        it('rejects a key that is not 32 bytes', async () => {
            const short = new Uint8Array(16);
            await expect(encrypt(short, PLAINTEXT)).rejects.toThrow(/32-byte/);
        });
    });
});
