// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: end-to-end of password → KDF → AEAD → walletBlob.
// Verifies the chain the wallet's onboarding uses to encrypt the seed.

import { describe, it, expect } from 'vitest';
import { deriveMasterKey, makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';
import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';

const SEED = new Uint8Array(64);
for (let i = 0; i < 64; i += 1) SEED[i] = i;

// Argon2id is synchronous, so each calibrated derivation blocks the worker for
// seconds and a worker that stops answering vitest's RPC ends an otherwise
// green run on `[vitest-worker]: Timeout calling "onTaskUpdate"`. The two cases
// below derive TWICE each, which is what pushed this file to 27s on a hosted
// runner. They are about a fresh salt per call and about a mismatched salt
// failing, not about what the KDF costs, so they run at demo grade and stay
// freshly salted. The calibrated defaults keep their end-to-end proof in the
// first two cases, and their tuning belongs to test/unit/crypto/kdf.test.js.
const FAST_KDF = { iterations: 1, memory: 8 * 1024 };

describe('integration/crypto/kdf-aead-walletblob', () => {
    it('end-to-end: encrypt → decrypt with fresh KDF params', async () => {
        const { encryptedSeed, kdfParams } = await encryptWalletSeed({
            password: 'correct horse',
            seed: SEED,
        });
        const back = await decryptWalletSeed({
            password: 'correct horse',
            encryptedSeed,
            kdfParams,
        });
        expect(Buffer.from(back).toString('hex')).toBe(Buffer.from(SEED).toString('hex'));
    });

    it('makeFreshKdfParams + deriveMasterKey + AEAD round-trip', async () => {
        const params = makeFreshKdfParams();
        const key = deriveMasterKey('p', params);
        expect(key.length).toBe(32);
        const ct = await encrypt(key, SEED);
        const pt = await decrypt(key, ct);
        expect(Buffer.from(pt).toString('hex')).toBe(Buffer.from(SEED).toString('hex'));
    });

    it('two encrypts of the same seed produce different blobs (random salt + IV)', async () => {
        const a = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: makeFreshKdfParams(FAST_KDF) });
        const b = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: makeFreshKdfParams(FAST_KDF) });
        expect(a.encryptedSeed).not.toBe(b.encryptedSeed);
        expect(a.kdfParams.salt).not.toBe(b.kdfParams.salt);
    });

    it('decrypt with correct password but mismatched kdfParams.salt fails', async () => {
        const a = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: makeFreshKdfParams(FAST_KDF) });
        const b = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: makeFreshKdfParams(FAST_KDF) });
        // Same password, but b.kdfParams has a different salt → master
        // key differs → decrypt fails.
        await expect(decryptWalletSeed({
            password: 'p',
            encryptedSeed: a.encryptedSeed,
            kdfParams: b.kdfParams,
        })).rejects.toThrow();
    });
});
