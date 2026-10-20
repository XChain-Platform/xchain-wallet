// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the cipher calls are mocked; the real layout lengths stay, because
// backup.js splits and checks the envelope on them.
vi.mock('../../../packages/core/src/crypto/aead.js', async (importOriginal) => ({
    ...(await importOriginal()),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/kdf.js', () => ({
    base64ToBytes: vi.fn((value) => new Uint8Array(Buffer.from(value, 'base64'))),
    bytesToBase64: vi.fn((value) => Buffer.from(value).toString('base64')),
    deriveMasterKeyAsync: vi.fn(),
    makeFreshKdfParams: vi.fn(),
}));

import { decrypt as aeadDecrypt, encrypt as aeadEncrypt } from '../../../packages/core/src/crypto/aead.js';
import { deriveMasterKeyAsync, makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import {
    BACKUP_FORMAT_VERSION,
    BACKUP_MAGIC,
    BackupFormatError,
    BackupPasswordError,
    decodeBackupEnvelope,
    encodeBackupEnvelope,
    parseBackupEnvelope,
    stringifyBackupEnvelope,
} from '../../../packages/core/src/crypto/backup.js';

const PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAA=',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

function packedBlob() {
    return new Uint8Array([
        ...new Uint8Array(12).fill(1),
        2, 3, 4,
        ...new Uint8Array(16).fill(5),
    ]);
}

function validEnvelope(overrides = {}) {
    return {
        magic: BACKUP_MAGIC,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: '2026-01-01T00:00:00.000Z',
        walletName: 'Wallet',
        encryption: {
            algorithm: 'aes-256-gcm',
            kdf: PARAMS,
            iv: Buffer.alloc(12, 1).toString('base64'),
            tag: Buffer.alloc(16, 5).toString('base64'),
        },
        payload: Buffer.from([2, 3, 4]).toString('base64'),
        ...overrides,
    };
}

beforeEach(() => {
    vi.mocked(aeadEncrypt).mockReset().mockResolvedValue(packedBlob());
    vi.mocked(aeadDecrypt).mockReset().mockResolvedValue(new TextEncoder().encode('{"ok":true}'));
    vi.mocked(deriveMasterKeyAsync).mockReset().mockResolvedValue(new Uint8Array(32).fill(7));
    vi.mocked(makeFreshKdfParams).mockReset().mockReturnValue(PARAMS);
});

describe('crypto/backup uncovered branches', () => {
    it.each([['empty', ''], ['non-string', null]])('rejects an %s password', async (_label, password) => {
        await expect(encodeBackupEnvelope({ password, payload: {}, walletName: 'Wallet' }))
            .rejects.toThrow(/password is required/);
    });

    it('rejects a non-string wallet name', async () => {
        await expect(encodeBackupEnvelope({ password: 'p', payload: {}, walletName: null }))
            .rejects.toThrow(/walletName must be a string/);
    });

    it('uses fresh params, splits the cipher blob, and clears temporary secrets', async () => {
        const masterKey = new Uint8Array(32).fill(7);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(masterKey);
        const envelope = await encodeBackupEnvelope({
            password: 'p',
            payload: { ok: true },
            walletName: 'Wallet',
        });
        const plaintext = vi.mocked(aeadEncrypt).mock.calls[0][1];

        expect(makeFreshKdfParams).toHaveBeenCalledOnce();
        expect(envelope.encryption).toMatchObject({
            algorithm: 'aes-256-gcm',
            kdf: PARAMS,
            iv: Buffer.alloc(12, 1).toString('base64'),
            tag: Buffer.alloc(16, 5).toString('base64'),
        });
        expect(envelope.payload).toBe(Buffer.from([2, 3, 4]).toString('base64'));
        expect(plaintext.every((byte) => byte === 0)).toBe(true);
        expect(masterKey.every((byte) => byte === 0)).toBe(true);
    });

    it('rejects a payload JSON cannot represent and clears the derived key', async () => {
        const masterKey = new Uint8Array(32).fill(6);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(masterKey);
        await expect(encodeBackupEnvelope({
            password: 'p',
            payload: undefined,
            walletName: 'Wallet',
            kdfParams: PARAMS,
        })).rejects.toThrow(/payload must be JSON-serializable/);
        expect(masterKey.every((byte) => byte === 0)).toBe(true);
    });

    it('clears plaintext and the key when encryption fails', async () => {
        const masterKey = new Uint8Array(32).fill(6);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(masterKey);
        vi.mocked(aeadEncrypt).mockRejectedValueOnce(new Error('cipher failed'));
        await expect(encodeBackupEnvelope({
            password: 'p',
            payload: { secret: true },
            walletName: 'Wallet',
            kdfParams: PARAMS,
        })).rejects.toThrow('cipher failed');
        expect(vi.mocked(aeadEncrypt).mock.calls[0][1].every((byte) => byte === 0)).toBe(true);
        expect(masterKey.every((byte) => byte === 0)).toBe(true);
    });

    it.each([
        ['wrong magic', { ...validEnvelope(), magic: 'WRONG' }, /unexpected magic/],
        ['wrong version', { ...validEnvelope(), formatVersion: 2 }, /unsupported formatVersion/],
        ['missing encryption', { ...validEnvelope(), encryption: null }, /encryption.algorithm/],
        ['wrong encryption', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, algorithm: 'cbc' } }, /encryption.algorithm/],
        ['missing KDF', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: null } }, /kdf.algorithm/],
        ['wrong KDF', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, algorithm: 'scrypt' } } }, /kdf.algorithm/],
        ['missing salt', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, salt: '' } } }, /salt missing/],
        ['non-string salt', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, salt: 1 } } }, /salt missing/],
        ['missing iterations', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, iterations: null } } }, /params missing/],
        ['missing memory', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, memory: null } } }, /params missing/],
        ['missing parallelism', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, kdf: { ...PARAMS, parallelism: null } } }, /params missing/],
        ['non-string iv', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, iv: null } }, /iv \/ tag/],
        ['non-string tag', { ...validEnvelope(), encryption: { ...validEnvelope().encryption, tag: null } }, /iv \/ tag/],
        ['non-string payload', { ...validEnvelope(), payload: null }, /payload must be/],
    ])('rejects a shape with %s', (_label, envelope, message) => {
        expect(() => parseBackupEnvelope(envelope)).toThrow(message);
    });

    it('rejects a non-object envelope before decoding', async () => {
        await expect(decodeBackupEnvelope({ password: 'p', envelope: null }))
            .rejects.toThrow(/envelope must be an object/);
    });

    it.each([null, 42, true])('rejects non-object parse input %j', (input) => {
        expect(() => parseBackupEnvelope(input)).toThrow(/input must be a JSON string or object/);
    });

    it('reports invalid JSON and accepts valid string or object inputs', () => {
        expect(() => parseBackupEnvelope('{')).toThrow(/file is not valid JSON/);
        const envelope = validEnvelope();
        expect(parseBackupEnvelope(JSON.stringify(envelope))).toEqual(envelope);
        expect(parseBackupEnvelope(envelope)).toBe(envelope);
        expect(JSON.parse(stringifyBackupEnvelope(envelope))).toEqual(envelope);
    });

    it('rejects invalid IV and tag byte lengths before deriving', async () => {
        await expect(decodeBackupEnvelope({
            password: 'p',
            envelope: validEnvelope({
                encryption: { ...validEnvelope().encryption, iv: Buffer.alloc(11).toString('base64') },
            }),
        })).rejects.toThrow(/iv must be 12 bytes/);
        await expect(decodeBackupEnvelope({
            password: 'p',
            envelope: validEnvelope({
                encryption: { ...validEnvelope().encryption, tag: Buffer.alloc(15).toString('base64') },
            }),
        })).rejects.toThrow(/tag must be 16 bytes/);
        expect(deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('maps authentication failure to BackupPasswordError and clears the key', async () => {
        const masterKey = new Uint8Array(32).fill(4);
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(masterKey);
        vi.mocked(aeadDecrypt).mockRejectedValueOnce(new Error('auth failed'));
        await expect(decodeBackupEnvelope({ password: 'p', envelope: validEnvelope() }))
            .rejects.toBeInstanceOf(BackupPasswordError);
        expect(masterKey.every((byte) => byte === 0)).toBe(true);
    });

    it('decodes valid JSON and clears the plaintext and key', async () => {
        const masterKey = new Uint8Array(32).fill(3);
        const plaintext = new TextEncoder().encode('{"answer":42}');
        vi.mocked(deriveMasterKeyAsync).mockResolvedValueOnce(masterKey);
        vi.mocked(aeadDecrypt).mockResolvedValueOnce(plaintext);

        await expect(decodeBackupEnvelope({ password: 'p', envelope: validEnvelope() }))
            .resolves.toEqual({ answer: 42 });
        expect(masterKey.every((byte) => byte === 0)).toBe(true);
        expect(plaintext.every((byte) => byte === 0)).toBe(true);
    });

    it('rejects decrypted non-JSON and clears the plaintext', async () => {
        const plaintext = new TextEncoder().encode('not json');
        vi.mocked(aeadDecrypt).mockResolvedValueOnce(plaintext);
        await expect(decodeBackupEnvelope({ password: 'p', envelope: validEnvelope() }))
            .rejects.toBeInstanceOf(BackupFormatError);
        expect(plaintext.every((byte) => byte === 0)).toBe(true);
    });
});
