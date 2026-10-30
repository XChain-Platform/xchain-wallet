// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import {
    bytesToBase64,
    deriveMasterKeyAsync,
    encrypt,
    encodeBackupEnvelope,
    stringifyBackupEnvelope,
} from '../../../packages/core/src/crypto/index.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { importBackupFile } from '../../../packages/core/src/flows/backupFile.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const KDF = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};
const AT = '2026-10-13T18:00:00.000Z';

function payload(contacts, seed) {
    return {
        payloadVersion: 1,
        wallet: {
            schemaVersion: 3, id: 'w1', name: 'Src', createdAt: AT, origin: 'created', format: 'bip39',
            passphraseEnabled: false, encryptionAlgorithm: 'aes-256-gcm', encryptedSeed: seed,
            encryptedPassphrase: null, kdfParams: KDF, importedKeys: [], multisigs: [],
        },
        accounts: [{
            schemaVersion: 2, id: 'a1', walletId: 'w1', name: 'Primary', index: 0,
            activeAddressByChainId: {}, createdAt: AT,
        }],
        addresses: [],
        contacts,
        connectedSites: [],
        settings: null,
        signers: [],
        pendingTxs: [],
    };
}

describe('flows/backupFile invalid record', () => {
    it('writes nothing when a later collection holds a record the vault refuses', async () => {
        const good = {
            schemaVersion: 1, id: 'c0', name: 'Ann', notes: '', avatarSeed: '',
            entries: [{ chain: 'bitcoin', address: 'bc1qa', label: '' }], createdAt: AT, updatedAt: AT,
        };
        const sourceKey = await deriveMasterKeyAsync('wallet-password-1', KDF);
        const seed = bytesToBase64(await encrypt(sourceKey, new TextEncoder().encode('seed words')));
        const bad = { ...good, id: 'c1', entries: 'not-an-array' };
        const fileContent = stringifyBackupEnvelope(await encodeBackupEnvelope({
            password: 'backup-file-password', payload: payload([good, bad], seed), walletName: 'Src', kdfParams: KDF,
        }));
        const backend = new InMemoryBackend();
        const key = await deriveMasterKeyAsync('device-password-1', KDF);
        const vault = new Vault({ backend, masterKey: key });
        await vault.open();

        await expect(importBackupFile({
            vault, fileContent, password: 'backup-file-password',
            walletPassword: 'wallet-password-1', devicePassword: 'device-password-1',
        })).rejects.toThrow(/contacts\[1\] is invalid/);

        expect(await vault.wallets.list()).toEqual([]);
        expect(await vault.accounts.list()).toEqual([]);
        expect(await vault.contacts.list()).toEqual([]);
        expect(await backend.load()).toBeNull();
    });
});
