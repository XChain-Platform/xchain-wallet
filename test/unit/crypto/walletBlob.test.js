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

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import {
    encryptWalletSeed,
    decryptWalletSeed,
    encryptWalletPassphrase,
    decryptWalletPassphrase,
    PASSPHRASE_AAD,
} from '../../../packages/core/src/crypto/walletBlob.js';
import { encrypt } from '../../../packages/core/src/crypto/aead.js';

// password -> KDF -> AES-256-GCM: every case pays a real Argon2id derivation.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

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

// The passphrase blob (§15.6). These take an already-derived master key, so
// no Argon2id round is paid here.
describe('crypto/walletBlob - passphrase', () => {
    const MASTER_KEY = new Uint8Array(32).fill(7);
    const OTHER_KEY = new Uint8Array(32).fill(9);
    const PASSPHRASE = 'correct horse battery stapler';
    const decode = (bytes) => new TextDecoder().decode(bytes);

    it('round-trips a passphrase under the wallet master key', async () => {
        const blob = await encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: PASSPHRASE });
        expect(typeof blob).toBe('string');
        expect(/^[A-Za-z0-9+/=]+$/.test(blob)).toBe(true);
        const out = await decryptWalletPassphrase({ masterKey: MASTER_KEY, encryptedPassphrase: blob });
        expect(ArrayBuffer.isView(out)).toBe(true);
        expect(decode(out)).toBe(PASSPHRASE);
    });

    it('round-trips a passphrase with non-ASCII characters', async () => {
        const pass = 'pässwörd 🔑 日本語';
        const blob = await encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: pass });
        const out = await decryptWalletPassphrase({ masterKey: MASTER_KEY, encryptedPassphrase: blob });
        expect(decode(out)).toBe(pass);
    });

    it('refuses to decrypt under a different master key', async () => {
        const blob = await encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: PASSPHRASE });
        await expect(
            decryptWalletPassphrase({ masterKey: OTHER_KEY, encryptedPassphrase: blob }),
        ).rejects.toThrow();
    });

    it('rejects a blob sealed without the passphrase AAD', async () => {
        // What a seed blob looks like: same key, no AAD. The AAD is the only
        // thing making the two non-interchangeable, so this is the guard.
        const raw = await encrypt(MASTER_KEY, new TextEncoder().encode(PASSPHRASE));
        const asBase64 = btoa(String.fromCharCode(...raw));
        await expect(
            decryptWalletPassphrase({ masterKey: MASTER_KEY, encryptedPassphrase: asBase64 }),
        ).rejects.toThrow();
    });

    it('rejects a blob sealed under a different AAD', async () => {
        const raw = await encrypt(
            MASTER_KEY,
            new TextEncoder().encode(PASSPHRASE),
            new TextEncoder().encode('xchain-wallet:bip39-passphrase:v2'),
        );
        const asBase64 = btoa(String.fromCharCode(...raw));
        await expect(
            decryptWalletPassphrase({ masterKey: MASTER_KEY, encryptedPassphrase: asBase64 }),
        ).rejects.toThrow();
    });

    it('refuses an empty or non-string passphrase', async () => {
        await expect(encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: '' })).rejects.toThrow(
            /non-empty string/,
        );
        await expect(
            encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: null }),
        ).rejects.toThrow(/non-empty string/);
    });

    it('does not zero the caller\'s master key', async () => {
        const key = new Uint8Array(32).fill(3);
        const blob = await encryptWalletPassphrase({ masterKey: key, passphrase: PASSPHRASE });
        expect(key.every((b) => b === 3)).toBe(true);
        await decryptWalletPassphrase({ masterKey: key, encryptedPassphrase: blob });
        expect(key.every((b) => b === 3)).toBe(true);
    });

    it('two encrypts of the same passphrase produce different ciphertexts', async () => {
        const a = await encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: PASSPHRASE });
        const b = await encryptWalletPassphrase({ masterKey: MASTER_KEY, passphrase: PASSPHRASE });
        expect(a).not.toBe(b);
    });

    it('the AAD constant is bytes, not a string (aead only honours byte AAD)', () => {
        // Realm-agnostic: under jsdom the module's Uint8Array is a different
        // constructor than the test file's, so `toBeInstanceOf` is unusable.
        expect(ArrayBuffer.isView(PASSPHRASE_AAD)).toBe(true);
        expect(PASSPHRASE_AAD.constructor.name).toBe('Uint8Array');
        expect(typeof PASSPHRASE_AAD).not.toBe('string');
        expect(PASSPHRASE_AAD.length).toBeGreaterThan(0);
    });
});
