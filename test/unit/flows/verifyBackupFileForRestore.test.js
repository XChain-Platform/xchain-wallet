// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Forgot Password's "Restore from backup file" verifies the file before
// anything on the device is erased (operator ruling 2026-11-16). Verified
// means the restore's own checks pass: the envelope opens with the file
// password, the payload validates, and the wallet's own seals open.

import { describe, expect, it, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/index.js';
import { exportBackupFile, verifyBackupFileForRestore } from '../../../packages/core/src/flows/backupFile.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const KDF_PARAMS = { algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 1, memory: 8192, parallelism: 1 };
const WALLET_PASSWORD = 'source-wallet-password';
const BACKUP_PASSWORD = 'backup-file-password';
const SEED = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function collection(initial = []) {
    const records = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => structuredClone(records.get(id) ?? null),
        list: async () => [...records.values()].map((r) => structuredClone(r)),
        put: async (r) => { records.set(r.id, structuredClone(r)); },
    };
}

async function backupFile({ walletPassword = WALLET_PASSWORD } = {}) {
    const sealed = await encryptWalletSeed({ password: walletPassword, seed: new TextEncoder().encode(SEED), kdfParams: KDF_PARAMS });
    const wallet = {
        schemaVersion: 3,
        id: 'wallet-1',
        name: 'Savings',
        createdAt: '2026-10-13T18:00:00.000Z',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptedPassphrase: null,
        encryptedSeed: sealed.encryptedSeed,
        kdfParams: KDF_PARAMS,
        importedKeys: [],
        multisigs: [],
    };
    const vault = {
        wallets: collection([wallet]),
        accounts: collection(),
        addresses: collection(),
        contacts: collection(),
        connectedSites: collection(),
        signers: collection(),
        pendingTxs: collection(),
        settings: { get: async () => null, put: async () => {} },
    };
    const { fileContent } = await exportBackupFile({ vault, walletId: 'wallet-1', password: BACKUP_PASSWORD, kdfParams: KDF_PARAMS });
    return fileContent;
}

describe('verifyBackupFileForRestore', () => {
    it('marks a good file as belonging to this vault when its wallet id matches', async () => {
        const fileContent = await backupFile({ walletPassword: BACKUP_PASSWORD });
        await expect(verifyBackupFileForRestore({
            fileContent,
            password: BACKUP_PASSWORD,
            currentWalletIds: ['wallet-1', 'hardware-wallet'],
        })).resolves.toEqual({ verified: true, walletName: 'Savings', belongsToVault: true });
    });

    it('marks a valid backup with another wallet id as foreign', async () => {
        const fileContent = await backupFile({ walletPassword: BACKUP_PASSWORD });
        await expect(verifyBackupFileForRestore({
            fileContent,
            password: BACKUP_PASSWORD,
            currentWalletIds: ['another-wallet'],
        })).resolves.toEqual({ verified: true, walletName: 'Savings', belongsToVault: false });
    });

    it('verifies a file whose wallet has its own password when that password is given', async () => {
        const fileContent = await backupFile();
        await expect(verifyBackupFileForRestore({
            fileContent,
            password: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            currentWalletIds: ['wallet-1'],
        }))
            .resolves.toMatchObject({ verified: true });
    });

    it('refuses a wrong file password', async () => {
        const fileContent = await backupFile();
        await expect(verifyBackupFileForRestore({ fileContent, password: 'not-the-password' }))
            .rejects.toMatchObject({ name: 'BackupPasswordError' });
    });

    it('refuses when the wallet inside needs its own password', async () => {
        const fileContent = await backupFile();
        await expect(verifyBackupFileForRestore({ fileContent, password: BACKUP_PASSWORD }))
            .rejects.toMatchObject({ name: 'BackupSeedPasswordError' });
    });

    it('refuses a file that is not a backup', async () => {
        await expect(verifyBackupFileForRestore({ fileContent: '{"hello":1}', password: BACKUP_PASSWORD }))
            .rejects.toMatchObject({ name: 'BackupFormatError' });
    });
});
