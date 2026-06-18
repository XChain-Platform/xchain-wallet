// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: walletBlob. Encrypt/decrypt of the wallet's seed with the
// password-derived master key. End-to-end of the
// password → KDF → AES-256-GCM chain.

import { describe, it, expect } from 'vitest';
import {
    encryptWalletSeed,
    decryptWalletSeed,
} from '../../../packages/core/src/crypto/walletBlob.js';

const SEED = new Uint8Array(64);
for (let i = 0; i < 64; i += 1) SEED[i] = i & 0xff;

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

describe('crypto/walletBlob', () => {
    it('encrypt + decrypt round-trips the seed', async () => {
        const { encryptedSeed, kdfParams } = await encryptWalletSeed({
            password: 'correct horse battery staple',
            seed: SEED,
            kdfParams: KDF_PARAMS,
        });
        const back = await decryptWalletSeed({
            password: 'correct horse battery staple',
            encryptedSeed,
            kdfParams,
        });
        expect(Buffer.from(back).toString('hex')).toBe(Buffer.from(SEED).toString('hex'));
    });

    it('refuses to decrypt with the wrong password', async () => {
        const { encryptedSeed, kdfParams } = await encryptWalletSeed({
            password: 'right',
            seed: SEED,
            kdfParams: KDF_PARAMS,
        });
        await expect(decryptWalletSeed({
            password: 'wrong',
            encryptedSeed,
            kdfParams,
        })).rejects.toThrow();
    });

    it('AAD binding: omitting AAD on decrypt fails when AAD was supplied on encrypt', async () => {
        const aad = new TextEncoder().encode('vault-v2');
        const { encryptedSeed, kdfParams } = await encryptWalletSeed({
            password: 'p',
            seed: SEED,
            kdfParams: KDF_PARAMS,
            aad,
        });
        await expect(decryptWalletSeed({
            password: 'p',
            encryptedSeed,
            kdfParams,
        })).rejects.toThrow();
    });

    it('mints fresh kdfParams when not supplied', async () => {
        const out = await encryptWalletSeed({
            password: 'p',
            seed: SEED,
        });
        expect(out.kdfParams).toBeTruthy();
        expect(out.kdfParams.algorithm).toBe('argon2id');
        expect(typeof out.kdfParams.salt).toBe('string');
    });

    it('encryptedSeed is base64-shaped (no spaces, no slashes only base64)', async () => {
        const { encryptedSeed } = await encryptWalletSeed({
            password: 'p',
            seed: SEED,
            kdfParams: KDF_PARAMS,
        });
        expect(/^[A-Za-z0-9+/=]+$/.test(encryptedSeed)).toBe(true);
    });

    it('two encrypts of the same seed + same password produce different ciphertexts (random IV)', async () => {
        const a = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: KDF_PARAMS });
        const b = await encryptWalletSeed({ password: 'p', seed: SEED, kdfParams: KDF_PARAMS });
        expect(a.encryptedSeed).not.toBe(b.encryptedSeed);
    });
});
