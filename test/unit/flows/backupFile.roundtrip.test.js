// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import {
    BackupPasswordError,
    base64ToBytes,
    bytesToBase64,
    decrypt,
    decryptWalletPassphrase,
    decryptWalletSeed,
    deriveMasterKeyAsync,
    encrypt,
    encryptWalletPassphrase,
    encryptWalletSeed,
} from '../../../packages/core/src/crypto/index.js';
import {
    exportBackupFile,
    importBackupFile,
} from '../../../packages/core/src/flows/backupFile.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};
const CREATED_AT = '2026-10-13T18:00:00.000Z';
const WALLET_PASSWORD = 'source-wallet-password';
const DEVICE_PASSWORD = 'restored-device-password';
const BACKUP_PASSWORD = 'backup-file-password';
const SEED = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ';
const PASSPHRASE = 'correct horse battery staple';

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function collection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, clone(record)]));
    return {
        get: vi.fn(async (id) => clone(records.get(id) ?? null)),
        list: vi.fn(async () => [...records.values()].map((record) => clone(record))),
        put: vi.fn(async (record) => { records.set(record.id, clone(record)); }),
        delete: vi.fn(async (id) => { records.delete(id); }),
    };
}

function settingsStore(initial = null) {
    let settings = clone(initial);
    return {
        get: vi.fn(async () => clone(settings)),
        put: vi.fn(async (next) => { settings = clone(next); }),
    };
}

function vault({ wallet = null, accounts = [], addresses = [], settings = null } = {}) {
    return {
        wallets: collection(wallet ? [wallet] : []),
        accounts: collection(accounts),
        addresses: collection(addresses),
        contacts: collection(),
        connectedSites: collection(),
        pendingTxs: collection(),
        settings: settingsStore(settings),
    };
}

function account(walletId) {
    return {
        schemaVersion: 2,
        id: `account-${walletId}`,
        walletId,
        name: 'Primary account',
        index: 0,
        activeAddressByChainId: {},
        createdAt: CREATED_AT,
    };
}

function address({ id, accountId, source, address, label, publicKey }) {
    return {
        schemaVersion: 4,
        id,
        accountId,
        chain: 'bitcoin',
        network: 'mainnet',
        source,
        addressType: 'p2wpkh',
        derivationPath: source === 'hd' ? "m/84'/0'/0'/0/0" : null,
        address,
        publicKey,
        label,
        pinned: true,
        hidden: false,
        signerId: source === 'watch-only' ? null : 'wallet-source',
        role: 'receive',
        createdAt: CREATED_AT,
    };
}

async function sealedWif() {
    const key = await deriveMasterKeyAsync(WALLET_PASSWORD, KDF_PARAMS);
    try {
        return bytesToBase64(await encrypt(key, new TextEncoder().encode(WIF)));
    } finally {
        key.fill(0);
    }
}

async function sourceFixture(kind) {
    const id = `wallet-${kind}`;
    const common = {
        schemaVersion: 3,
        id,
        name: `${kind} backup`,
        createdAt: CREATED_AT,
        origin: kind === 'imported-key' ? 'imported-wif' : 'created',
        format: kind === 'imported-key' ? 'wif-only' : 'bip39',
        passphraseEnabled: kind === 'passphrase',
        encryptionAlgorithm: 'aes-256-gcm',
        encryptedPassphrase: null,
        kdfParams: KDF_PARAMS,
        importedKeys: [],
        multisigs: [],
    };
    const settings = {
        ...createDefaultSettings(),
        theme: 'dark',
        fiatCurrency: 'EUR',
        autolockMinutes: 30,
        privacy: {
            ...createDefaultSettings().privacy,
            labelsSurviveRestore: true,
        },
    };

    if (kind === 'imported-key') {
        const imported = address({
            id: 'address-imported',
            accountId: null,
            source: 'imported-wif',
            address: '1ImportedBackupAddress',
            label: 'Imported savings',
            publicKey: '02imported',
        });
        const wallet = {
            ...common,
            encryptedSeed: '',
            importedKeys: [{
                addressId: imported.id,
                encryptedWif: await sealedWif(),
                importedAt: CREATED_AT,
            }],
        };
        return { wallet, accounts: [], addresses: [imported], settings };
    }

    const sealed = await encryptWalletSeed({
        password: WALLET_PASSWORD,
        seed: new TextEncoder().encode(SEED),
        kdfParams: KDF_PARAMS,
    });
    const wallet = { ...common, encryptedSeed: sealed.encryptedSeed };
    if (kind === 'passphrase') {
        const key = await deriveMasterKeyAsync(WALLET_PASSWORD, KDF_PARAMS);
        try {
            wallet.encryptedPassphrase = await encryptWalletPassphrase({
                masterKey: key,
                passphrase: PASSPHRASE,
            });
        } finally {
            key.fill(0);
        }
    }
    const ownAccount = account(id);
    const addresses = [address({
        id: `address-${kind}`,
        accountId: ownAccount.id,
        source: 'hd',
        address: `bc1q${kind}`,
        label: kind === 'passphrase' ? 'Passphrase funds' : 'Daily spending',
        publicKey: `02${kind}`,
    })];
    if (kind === 'seed') {
        addresses.push(address({
            id: 'address-watch-only',
            accountId: ownAccount.id,
            source: 'watch-only',
            address: 'bc1qwatchonly',
            label: 'Auditor watch-only',
            publicKey: '02watchonly',
        }));
    }
    return { wallet, accounts: [ownAccount], addresses, settings };
}

async function exportFixture(kind) {
    const fixture = await sourceFixture(kind);
    const source = vault(fixture);
    const exported = await exportBackupFile({
        vault: source,
        walletId: fixture.wallet.id,
        password: BACKUP_PASSWORD,
        kdfParams: KDF_PARAMS,
    });
    return { fixture, fileContent: exported.fileContent };
}

async function restore(fileContent) {
    const target = vault();
    const result = await importBackupFile({
        vault: target,
        fileContent,
        password: BACKUP_PASSWORD,
        walletPassword: WALLET_PASSWORD,
        devicePassword: DEVICE_PASSWORD,
    });
    return { target, result };
}

describe('wallet backup file round trips', () => {
    it.each([
        ['seed wallet with an associated watch-only address', 'seed'],
        ['WIF-only wallet with an imported key', 'imported-key'],
        ['seed wallet with a stored BIP39 passphrase', 'passphrase'],
    ])('restores the %s with its addresses, labels, and settings', async (_name, kind) => {
        const { fixture, fileContent } = await exportFixture(kind);
        const { target, result } = await restore(fileContent);
        const restoredWallet = await target.wallets.get(result.walletId);

        expect(restoredWallet).toMatchObject({
            id: fixture.wallet.id,
            name: fixture.wallet.name,
            format: fixture.wallet.format,
            passphraseEnabled: fixture.wallet.passphraseEnabled,
        });
        expect(await target.accounts.list()).toEqual(fixture.accounts);
        expect(await target.addresses.list()).toEqual(fixture.addresses);
        expect(await target.settings.get()).toEqual(fixture.settings);

        if (kind === 'seed') {
            const plaintext = await decryptWalletSeed({
                password: DEVICE_PASSWORD,
                encryptedSeed: restoredWallet.encryptedSeed,
                kdfParams: restoredWallet.kdfParams,
            });
            expect(new TextDecoder().decode(plaintext)).toBe(SEED);
            plaintext.fill(0);
        }

        if (kind === 'imported-key') {
            expect(restoredWallet.importedKeys[0].addressId).toBe(fixture.addresses[0].id);
            const key = await deriveMasterKeyAsync(DEVICE_PASSWORD, restoredWallet.kdfParams);
            try {
                const plaintext = await decrypt(
                    key,
                    base64ToBytes(restoredWallet.importedKeys[0].encryptedWif),
                );
                expect(new TextDecoder().decode(plaintext)).toBe(WIF);
                plaintext.fill(0);
            } finally {
                key.fill(0);
            }
        }

        if (kind === 'passphrase') {
            const key = await deriveMasterKeyAsync(DEVICE_PASSWORD, restoredWallet.kdfParams);
            try {
                const plaintext = await decryptWalletPassphrase({
                    masterKey: key,
                    encryptedPassphrase: restoredWallet.encryptedPassphrase,
                });
                expect(new TextDecoder().decode(plaintext)).toBe(PASSPHRASE);
                plaintext.fill(0);
            } finally {
                key.fill(0);
            }
        }
    });

    it('reports a wrong backup password as a plain user-facing error', async () => {
        const { fileContent } = await exportFixture('seed');
        const error = await importBackupFile({
            vault: vault(),
            fileContent,
            password: 'wrong-backup-password',
            walletPassword: WALLET_PASSWORD,
            devicePassword: DEVICE_PASSWORD,
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(BackupPasswordError);
        expect(error.message).toMatch(/^That password did not open the backup file\./);
        expect(error.message).not.toMatch(/OperationError|AES|decrypt|stack/i);
    });

    it('refuses a corrupted file cleanly without writing partial records', async () => {
        const { fileContent } = await exportFixture('seed');
        const target = vault();
        const envelope = JSON.parse(fileContent);
        envelope.payload = `${envelope.payload[0] === 'A' ? 'B' : 'A'}${envelope.payload.slice(1)}`;
        const error = await importBackupFile({
            vault: target,
            fileContent: JSON.stringify(envelope),
            password: BACKUP_PASSWORD,
            walletPassword: WALLET_PASSWORD,
            devicePassword: DEVICE_PASSWORD,
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(BackupPasswordError);
        expect(error.message).toContain('the file itself has been changed');
        expect(await target.wallets.list()).toEqual([]);
        expect(await target.addresses.list()).toEqual([]);
        expect(await target.settings.get()).toBeNull();
    });
});
