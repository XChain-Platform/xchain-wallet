// Security: backup-format tamper resistance. Every field that an
// attacker could mutate while keeping JSON parseable should cause
// decode to fail; the wallet should never silently return wrong
// plaintext or accept a forged envelope.

import { describe, it, expect } from 'vitest';
import {
    encodeBackupEnvelope,
    decodeBackupEnvelope,
    BackupPasswordError,
    BackupFormatError,
} from '../../../packages/core/src/crypto/backup.js';

const KDF = {
    algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3, memory: 65536, parallelism: 1,
};

async function makeEnv() {
    return encodeBackupEnvelope({
        password: 'right', payload: { secret: 1 }, walletName: 'A', kdfParams: KDF,
    });
}

describe('security/crypto/backup-tamper', () => {
    it('rejects wrong password', async () => {
        const env = await makeEnv();
        await expect(
            decodeBackupEnvelope({ password: 'wrong', envelope: env }),
        ).rejects.toBeInstanceOf(BackupPasswordError);
    });

    it('rejects when magic field is removed', async () => {
        const env = await makeEnv();
        delete env.magic;
        await expect(
            decodeBackupEnvelope({ password: 'right', envelope: env }),
        ).rejects.toBeInstanceOf(BackupFormatError);
    });

    it('rejects when formatVersion is bumped to a future unknown value', async () => {
        const env = await makeEnv();
        env.formatVersion = 999;
        await expect(
            decodeBackupEnvelope({ password: 'right', envelope: env }),
        ).rejects.toThrow();
    });

    it('rejects when encryption.iv field is dropped', async () => {
        const env = await makeEnv();
        env.encryption = { ...env.encryption };
        delete env.encryption.iv;
        await expect(
            decodeBackupEnvelope({ password: 'right', envelope: env }),
        ).rejects.toThrow();
    });

    it('rejects when encryption.tag field is dropped (auth tag missing)', async () => {
        const env = await makeEnv();
        env.encryption = { ...env.encryption };
        delete env.encryption.tag;
        await expect(
            decodeBackupEnvelope({ password: 'right', envelope: env }),
        ).rejects.toThrow();
    });
});
