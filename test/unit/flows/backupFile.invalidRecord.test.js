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
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const KDF = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};
const FAST_KDF = { ...KDF, iterations: 1, memory: 8192 };
const AT = '2026-10-13T18:00:00.000Z';

function payload(contacts, seed, kdfParams = KDF) {
    return {
        payloadVersion: 1,
        wallet: {
            schemaVersion: 3, id: 'w1', name: 'Src', createdAt: AT, origin: 'created', format: 'bip39',
            passphraseEnabled: false, encryptionAlgorithm: 'aes-256-gcm', encryptedSeed: seed,
            encryptedPassphrase: null, kdfParams, importedKeys: [], multisigs: [],
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

function address(overrides = {}) {
    return {
        schemaVersion: 4,
        id: 'address-1',
        accountId: 'a1',
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/0",
        address: 'bc1qbackupaddress',
        publicKey: '02aa',
        label: 'Backup address',
        pinned: false,
        hidden: false,
        signerId: 'w1',
        role: 'receive',
        createdAt: AT,
        ...overrides,
    };
}

async function backupWithAddress(addressRecord) {
    const sourceKey = await deriveMasterKeyAsync('wallet-password-1', FAST_KDF);
    const seed = bytesToBase64(await encrypt(sourceKey, new TextEncoder().encode('seed words')));
    const contents = payload([], seed, FAST_KDF);
    contents.addresses = [addressRecord];
    if (addressRecord.source === 'imported-wif') {
        contents.accounts = [];
        contents.wallet.importedKeys = [{
            addressId: addressRecord.id,
            encryptedWif: seed,
            importedAt: AT,
        }];
    }
    return stringifyBackupEnvelope(await encodeBackupEnvelope({
        password: 'backup-file-password', payload: contents, walletName: 'Src', kdfParams: FAST_KDF,
    }));
}

async function freshVault() {
    const backend = new InMemoryBackend();
    const key = await deriveMasterKeyAsync('device-password-1', FAST_KDF);
    const vault = new Vault({ backend, masterKey: key });
    await vault.open();
    return { backend, vault };
}

async function restore(vault, fileContent, chainRegistry) {
    return importBackupFile({
        vault,
        fileContent,
        password: 'backup-file-password',
        walletPassword: 'wallet-password-1',
        devicePassword: 'device-password-1',
        chainRegistry,
    });
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

    it('rejects an address type the chain does not support before writing', async () => {
        const fileContent = await backupWithAddress(address({
            chain: 'dogecoin',
            addressType: 'p2wpkh',
            derivationPath: "m/44'/3'/0'/0/0",
            address: 'DBackupAddress',
        }));
        const { backend, vault } = await freshVault();

        await expect(restore(vault, fileContent)).rejects.toThrow(/addresses\[0\].*does not support/);
        expect(await vault.wallets.list()).toEqual([]);
        expect(await vault.accounts.list()).toEqual([]);
        expect(await vault.addresses.list()).toEqual([]);
        expect(await backend.load()).toBeNull();
    });

    it('rejects an uncompressed imported key with a non-p2pkh type', async () => {
        const fileContent = await backupWithAddress(address({
            accountId: null,
            source: 'imported-wif',
            derivationPath: null,
            publicKey: `04${'ab'.repeat(64)}`,
        }));
        const { backend, vault } = await freshVault();

        await expect(restore(vault, fileContent)).rejects.toThrow(/uncompressed key.*p2pkh/);
        expect(await vault.addresses.list()).toEqual([]);
        expect(await backend.load()).toBeNull();
    });

    it('restores a p2pkh uncompressed imported key', async () => {
        const fileContent = await backupWithAddress(address({
            accountId: null,
            source: 'imported-wif',
            addressType: 'p2pkh',
            derivationPath: null,
            publicKey: `04${'ab'.repeat(64)}`,
        }));
        const { vault } = await freshVault();

        await expect(restore(vault, fileContent)).resolves.toMatchObject({ writes: { addresses: 1 } });
        expect(await vault.addresses.list()).toHaveLength(1);
    });

    it('restores an address for a chain absent from the registry', async () => {
        const fileContent = await backupWithAddress(address({ chain: 'custom-coin' }));
        const { vault } = await freshVault();
        const chainRegistry = new ChainRegistry({ bundled: [] });

        await expect(restore(vault, fileContent, chainRegistry)).resolves.toMatchObject({
            writes: { addresses: 1 },
        });
    });
});
