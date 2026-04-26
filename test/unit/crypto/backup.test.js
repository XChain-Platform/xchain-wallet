// Unit: encrypted backup envelope. Round-trips a payload through the
// password-encrypted file format the wallet exports for backups.

import { describe, it, expect } from 'vitest';
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
    });

    describe('format errors', () => {
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
