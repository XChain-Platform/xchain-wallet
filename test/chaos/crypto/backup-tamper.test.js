// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Chaos: backup envelope tampering. A single mutated byte in the
// ciphertext / IV / salt must cause decode to fail with a
// BackupPasswordError, not silently return wrong plaintext.
//
// Envelope shape (from encodeBackupEnvelope):
//   { magic, formatVersion, createdAt, walletName,
//     encryption: { algorithm, kdf, iv, tag },
//     payload }                  ← base64 ciphertext

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

describe('chaos/crypto/backup-tamper', () => {
    it('mutated ciphertext byte → decode fails', async () => {
        const env = await encodeBackupEnvelope({
            password: 'p', payload: { secret: 42 }, walletName: 'A', kdfParams: KDF,
        });
        // Flip the LAST base64 char in payload (always present).
        const last = env.payload[env.payload.length - 1] === 'A' ? 'B' : 'A';
        env.payload = env.payload.slice(0, -1) + last;
        await expect(
            decodeBackupEnvelope({ password: 'p', envelope: env }),
        ).rejects.toThrow();
    });

    it('mutated encryption.kdf.salt → decode fails', async () => {
        const env = await encodeBackupEnvelope({
            password: 'p', payload: { secret: 42 }, walletName: 'A', kdfParams: KDF,
        });
        env.encryption = {
            ...env.encryption,
            kdf: { ...env.encryption.kdf, salt: 'BBBBBBBBBBBBBBBBBBBBBA==' },
        };
        await expect(
            decodeBackupEnvelope({ password: 'p', envelope: env }),
        ).rejects.toBeInstanceOf(BackupPasswordError);
    });

    it('zeroed magic → decode rejects with format error', async () => {
        const env = await encodeBackupEnvelope({
            password: 'p', payload: {}, walletName: 'A', kdfParams: KDF,
        });
        env.magic = 'NOPE';
        await expect(
            decodeBackupEnvelope({ password: 'p', envelope: env }),
        ).rejects.toBeInstanceOf(BackupFormatError);
    });

    it('downgraded encryption.kdf.algorithm → decode rejects', async () => {
        const env = await encodeBackupEnvelope({
            password: 'p', payload: {}, walletName: 'A', kdfParams: KDF,
        });
        env.encryption = {
            ...env.encryption,
            kdf: { ...env.encryption.kdf, algorithm: 'pbkdf2' },
        };
        await expect(
            decodeBackupEnvelope({ password: 'p', envelope: env }),
        ).rejects.toThrow();
    });
});
