// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fuzz: AEAD round-trip property.  encrypt(decrypt(x)) === x
// for any 32-byte key, any byte buffer plaintext, any AAD.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 100);

describe('fuzz/aead/round-trip', () => {
    it('encrypt → decrypt is identity for any plaintext + key + AAD', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uint8Array({ minLength: 32, maxLength: 32 }),    // key
                fc.uint8Array({ minLength: 0, maxLength: 256 }),    // plaintext
                fc.uint8Array({ minLength: 0, maxLength: 256 }),    // aad
                async (key, pt, aad) => {
                    const ct = await encrypt(key, pt, aad);
                    const round = await decrypt(key, ct, aad);
                    return round.length === pt.length
                        && round.every((b, i) => b === pt[i]);
                },
            ),
            { numRuns: RUNS },
        );
    });

    it('decrypt throws when ANY byte of the ciphertext is mutated', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uint8Array({ minLength: 32, maxLength: 32 }),
                fc.uint8Array({ minLength: 1, maxLength: 64 }),
                fc.nat(),
                async (key, pt, idxRaw) => {
                    const ct = await encrypt(key, pt);
                    const idx = idxRaw % ct.length;
                    const mut = ct.slice();
                    mut[idx] ^= 0x01;
                    let threw = false;
                    try { await decrypt(key, mut); } catch { threw = true; }
                    return threw;
                },
            ),
            { numRuns: RUNS },
        );
    });
});
