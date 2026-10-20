// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: encrypted backup envelope. Round-trips a payload through the
// password-encrypted file format the wallet exports for backups.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import {
    BACKUP_MAGIC,
    BACKUP_FORMAT_VERSION,
    BackupFormatError,
    BackupPasswordError,
    encodeBackupEnvelope,
    decodeBackupEnvelope,
    stringifyBackupEnvelope,
    parseBackupEnvelope,
} from '../../../packages/core/src/crypto/backup.js';
import { IV_LENGTH, TAG_LENGTH_BYTES } from '../../../packages/core/src/crypto/aead.js';

// Every round-trip here pays a real Argon2id derivation at the production floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

describe('crypto/backup', () => {
    describe('round-trip', () => {
        it('encode + decode a small payload', async () => {
            const payload = { wallets: [{ name: 'A' }] };
            const env = await encodeBackupEnvelope({
                password: 'p',
                payload,
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            });
            const back = await decodeBackupEnvelope({ password: 'p', envelope: env });
            expect(back).toEqual(payload);
        });

        it('refuses to decode with the wrong password (BackupPasswordError)', async () => {
            const env = await encodeBackupEnvelope({
                password: 'right',
                payload: { x: 1 },
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            });
            await expect(
                decodeBackupEnvelope({ password: 'wrong', envelope: env }),
            ).rejects.toBeInstanceOf(BackupPasswordError);
        });
    });

    describe('envelope shape', () => {
        it('carries the wallet magic + version', async () => {
            const env = await encodeBackupEnvelope({
                password: 'p',
                payload: { x: 1 },
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            });
            expect(env.magic).toBe(BACKUP_MAGIC);
            expect(env.formatVersion).toBe(BACKUP_FORMAT_VERSION);
        });

        it('serialises to JSON and back', async () => {
            const env = await encodeBackupEnvelope({
                password: 'p',
                payload: { x: 1 },
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            });
            const json = stringifyBackupEnvelope(env);
            const parsed = parseBackupEnvelope(json);
            expect(parsed.magic).toBe(BACKUP_MAGIC);
        });

        // These lengths ARE format version 1. If the AEAD layout ever changes, bump
        // BACKUP_FORMAT_VERSION and keep a v1 decode path; never edit the literals here.
        it('pins format version 1 to a 12-byte iv and a 16-byte tag', async () => {
            expect({ formatVersion: BACKUP_FORMAT_VERSION, iv: IV_LENGTH, tag: TAG_LENGTH_BYTES })
                .toEqual({ formatVersion: 1, iv: 12, tag: 16 });
            const env = await encodeBackupEnvelope({
                password: 'p',
                payload: { x: 1 },
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            });
            expect(Buffer.from(env.encryption.iv, 'base64')).toHaveLength(12);
            expect(Buffer.from(env.encryption.tag, 'base64')).toHaveLength(16);
        });
    });

    describe('format errors', () => {
        it('refuses a payload that JSON cannot represent', async () => {
            await expect(encodeBackupEnvelope({
                password: 'p',
                payload: undefined,
                walletName: 'A',
                kdfParams: KDF_PARAMS,
            })).rejects.toThrow(/payload must be JSON-serializable/);
        });

        it('parseBackupEnvelope rejects non-JSON input', () => {
            expect(() => parseBackupEnvelope('not json')).toThrow(BackupFormatError);
        });

        it('parseBackupEnvelope rejects JSON without magic', () => {
            expect(() => parseBackupEnvelope('{}')).toThrow(BackupFormatError);
        });

        it('parseBackupEnvelope rejects wrong magic', () => {
            expect(() => parseBackupEnvelope(JSON.stringify({ magic: 'NOPE' })))
                .toThrow(BackupFormatError);
        });
    });
});
