// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: walletBlob with an already-derived master key. The AEAD and KDF
// modules are wrapped (real behaviour, recorded calls) so the tests can
// see which buffer actually reached the cipher: the caller's buffer must
// never be the one used or zeroed, the private copy must be zeroed on
// return, and a supplied key must skip the Argon2id derivation entirely.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/crypto/aead.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        encrypt: vi.fn(actual.encrypt),
        decrypt: vi.fn(actual.decrypt),
    };
});

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKey: vi.fn(actual.deriveMasterKey),
    };
});

import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';
import { deriveMasterKey, copyMasterKey } from '../../../packages/core/src/crypto/kdf.js';

const SEED = new Uint8Array(64).map((_, i) => i);

// Never derived from: a supplied key replaces the derivation, so these
// params only have to be well formed for the stored record.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

function callerKey() {
    return new Uint8Array(32).fill(11);
}

const isZero = (bytes) => bytes.every((b) => b === 0);
const isElevens = (bytes) => bytes.every((b) => b === 11);

beforeEach(() => {
    vi.mocked(encrypt).mockClear();
    vi.mocked(decrypt).mockClear();
    vi.mocked(deriveMasterKey).mockClear();
});

describe('crypto/walletBlob with a supplied master key', () => {
    it('encryptWalletSeed uses and zeroes its own copy, never the caller buffer, and does not derive', async () => {
        const key = callerKey();
        await encryptWalletSeed({ password: 'unused', seed: SEED, kdfParams: KDF_PARAMS, masterKey: key });

        expect(deriveMasterKey).not.toHaveBeenCalled();
        expect(encrypt).toHaveBeenCalledTimes(1);
        const used = vi.mocked(encrypt).mock.calls[0][0];
        expect(used).not.toBe(key);
        expect(used.buffer).not.toBe(key.buffer);
        expect(isZero(used)).toBe(true);
        expect(isElevens(key)).toBe(true);
    });

    it('decryptWalletSeed uses and zeroes its own copy, retains a separate copy, and does not derive', async () => {
        const key = callerKey();
        const { encryptedSeed } = await encryptWalletSeed({
            password: 'unused', seed: SEED, kdfParams: KDF_PARAMS, masterKey: key,
        });
        vi.mocked(decrypt).mockClear();

        let retained = null;
        const plaintext = await decryptWalletSeed({
            password: 'unused',
            encryptedSeed,
            kdfParams: KDF_PARAMS,
            masterKey: key,
            retainMasterKey: (k) => { retained = k; },
        });

        expect(plaintext).toEqual(SEED);
        expect(deriveMasterKey).not.toHaveBeenCalled();
        const used = vi.mocked(decrypt).mock.calls[0][0];
        expect(used).not.toBe(key);
        expect(isZero(used)).toBe(true);
        expect(isElevens(key)).toBe(true);
        // The retained copy is the receiver's to zero, so it is live here.
        expect(retained).not.toBe(key);
        expect(retained).not.toBe(used);
        expect(isElevens(retained)).toBe(true);
        retained.fill(0);
    });

    it('a key the caller zeroes afterwards does not reach back into the stored blob', async () => {
        const key = callerKey();
        const { encryptedSeed } = await encryptWalletSeed({
            password: 'unused', seed: SEED, kdfParams: KDF_PARAMS, masterKey: key,
        });
        key.fill(0);
        const again = callerKey();
        const plaintext = await decryptWalletSeed({
            password: 'unused', encryptedSeed, kdfParams: KDF_PARAMS, masterKey: again,
        });
        expect(plaintext).toEqual(SEED);
    });

    it.each([
        ['a number', 32],
        ['a short Uint8Array', new Uint8Array(16)],
        ['a plain array', new Array(32).fill(1)],
        ['null', null],
    ])('rejects %s as a master key before any cipher call', async (_label, bad) => {
        await expect(encryptWalletSeed({
            password: 'unused', seed: SEED, kdfParams: KDF_PARAMS, masterKey: bad,
        })).rejects.toThrow(/masterKey must be a 32-byte Uint8Array/);
        await expect(decryptWalletSeed({
            password: 'unused', encryptedSeed: 'AAAA', kdfParams: KDF_PARAMS, masterKey: bad,
        })).rejects.toThrow(/masterKey must be a 32-byte Uint8Array/);
        expect(encrypt).not.toHaveBeenCalled();
        expect(decrypt).not.toHaveBeenCalled();
        expect(deriveMasterKey).not.toHaveBeenCalled();
    });

    it('copyMasterKey returns an independent copy', () => {
        const key = callerKey();
        const copy = copyMasterKey(key);
        expect(copy).not.toBe(key);
        copy.fill(0);
        expect(isElevens(key)).toBe(true);
    });
});
