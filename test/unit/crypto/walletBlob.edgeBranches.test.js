// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/crypto/aead.js', () => ({
    encrypt: vi.fn(async (_key, plaintext) => new Uint8Array(plaintext)),
    decrypt: vi.fn(async (_key, blob) => new Uint8Array(blob)),
}));

vi.mock('../../../packages/core/src/crypto/kdf.js', () => ({
    copyMasterKey: vi.fn((key) => new Uint8Array(key)),
    deriveMasterKeyAsync: vi.fn(async () => new Uint8Array(32).fill(7)),
    makeFreshKdfParams: vi.fn(() => ({
        algorithm: 'argon2id',
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        iterations: 3,
        memory: 65536,
        parallelism: 1,
    })),
    bytesToBase64: vi.fn((bytes) => Buffer.from(bytes).toString('base64')),
    base64ToBytes: vi.fn((value) => new Uint8Array(Buffer.from(value, 'base64'))),
}));

import { decrypt, encrypt } from '../../../packages/core/src/crypto/aead.js';
import {
    copyMasterKey,
    deriveMasterKeyAsync,
    makeFreshKdfParams,
} from '../../../packages/core/src/crypto/kdf.js';
import {
    decryptWalletPassphrase,
    decryptWalletSeed,
    encryptWalletPassphrase,
    encryptWalletSeed,
} from '../../../packages/core/src/crypto/walletBlob.js';

const PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

beforeEach(() => {
    vi.mocked(encrypt).mockReset().mockImplementation(async (_key, plaintext) => new Uint8Array(plaintext));
    vi.mocked(decrypt).mockReset().mockImplementation(async (_key, blob) => new Uint8Array(blob));
    vi.mocked(copyMasterKey).mockClear();
    vi.mocked(deriveMasterKeyAsync).mockReset().mockResolvedValue(new Uint8Array(32).fill(7));
    vi.mocked(makeFreshKdfParams).mockClear();
});

describe('crypto/walletBlob uncovered branches', () => {
    it('mints params and derives a key when encrypting without either input', async () => {
        const seed = new Uint8Array([1, 2, 3]);
        const out = await encryptWalletSeed({ password: 'password', seed });
        const workingKey = vi.mocked(encrypt).mock.calls[0][0];

        expect(makeFreshKdfParams).toHaveBeenCalledOnce();
        expect(deriveMasterKeyAsync).toHaveBeenCalledWith('password', out.kdfParams);
        expect(copyMasterKey).not.toHaveBeenCalled();
        expect(out.encryptedSeed).toBe('AQID');
        expect(workingKey.every((byte) => byte === 0)).toBe(true);
    });

    it('zeroes a derived key when seed encryption rejects', async () => {
        const workingKey = new Uint8Array(32).fill(8);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(workingKey);
        vi.mocked(encrypt).mockRejectedValueOnce(new Error('cipher failed'));

        await expect(encryptWalletSeed({ password: 'password', seed: new Uint8Array([1]), kdfParams: PARAMS }))
            .rejects.toThrow('cipher failed');
        expect(workingKey.every((byte) => byte === 0)).toBe(true);
    });

    it('derives for decryption and only retains a key for a function callback', async () => {
        const firstKey = new Uint8Array(32).fill(4);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(firstKey);
        const first = await decryptWalletSeed({
            password: 'password',
            encryptedSeed: 'AQID',
            kdfParams: PARAMS,
            retainMasterKey: true,
        });
        expect(first).toEqual(new Uint8Array([1, 2, 3]));
        expect(firstKey.every((byte) => byte === 0)).toBe(true);

        const retain = vi.fn();
        const secondKey = new Uint8Array(32).fill(5);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(secondKey);
        await decryptWalletSeed({
            password: 'password',
            encryptedSeed: 'BAUG',
            kdfParams: PARAMS,
            retainMasterKey: retain,
        });
        expect(retain).toHaveBeenCalledOnce();
        expect(retain.mock.calls[0][0]).toEqual(new Uint8Array(32).fill(5));
        expect(retain.mock.calls[0][0]).not.toBe(secondKey);
        expect(secondKey.every((byte) => byte === 0)).toBe(true);
    });

    it('copies a supplied key and requires its KDF params', async () => {
        const key = new Uint8Array(32).fill(9);
        await expect(encryptWalletSeed({ password: 'unused', seed: new Uint8Array([1]), masterKey: key }))
            .rejects.toThrow(/needs the kdfParams/);

        await encryptWalletSeed({
            password: 'unused',
            seed: new Uint8Array([1]),
            masterKey: key,
            kdfParams: PARAMS,
        });
        expect(copyMasterKey).toHaveBeenCalledWith(key);
        expect(deriveMasterKeyAsync).not.toHaveBeenCalled();
        expect(key.every((byte) => byte === 9)).toBe(true);
    });

    it.each(['', null, undefined, 42])('rejects invalid passphrase input %j', async (passphrase) => {
        await expect(encryptWalletPassphrase({ masterKey: new Uint8Array(32), passphrase }))
            .rejects.toThrow(/non-empty string/);
    });

    it('clears passphrase bytes when encryption rejects', async () => {
        vi.mocked(encrypt).mockRejectedValueOnce(new Error('cipher failed'));
        await expect(encryptWalletPassphrase({
            masterKey: new Uint8Array(32),
            passphrase: 'secret',
        })).rejects.toThrow('cipher failed');
        const bytes = vi.mocked(encrypt).mock.calls[0][1];
        expect(bytes.every((byte) => byte === 0)).toBe(true);
    });

    it('decodes the stored passphrase before decryption', async () => {
        await expect(decryptWalletPassphrase({
            masterKey: new Uint8Array(32),
            encryptedPassphrase: 'AQID',
        })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    });
});
