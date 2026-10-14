// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({
    decoded: null,
    encoded: null,
    decodeBackupEnvelope: vi.fn(),
    encodeBackupEnvelope: vi.fn(),
    parseBackupEnvelope: vi.fn(),
    stringifyBackupEnvelope: vi.fn(),
    deriveMasterKeyAsync: vi.fn(),
    makeFreshKdfParams: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...await importOriginal(),
    decodeBackupEnvelope: crypto.decodeBackupEnvelope,
    encodeBackupEnvelope: crypto.encodeBackupEnvelope,
    parseBackupEnvelope: crypto.parseBackupEnvelope,
    stringifyBackupEnvelope: crypto.stringifyBackupEnvelope,
    deriveMasterKeyAsync: crypto.deriveMasterKeyAsync,
    makeFreshKdfParams: crypto.makeFreshKdfParams,
    encrypt: crypto.encrypt,
    decrypt: crypto.decrypt,
    bytesToBase64: (bytes) => `base64:${Array.from(bytes).join(',')}`,
    base64ToBytes: () => new Uint8Array([8, 9]),
}));

import {
    BackupPointerUnresolvedError,
    BackupSeedPasswordError,
    exportBackupFile,
    importBackupFile,
    rekeyWalletRecord,
    restoreFromBackupPointer,
} from '../../../packages/core/src/flows/backupFile.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

const KDF = {
    algorithm: 'argon2id', salt: 'salt', iterations: 2, memory: 8192, parallelism: 1,
};
const NEXT_KDF = { ...KDF, salt: 'fresh-salt' };

function collection(records = []) {
    return {
        get: vi.fn(async (id) => records.find((record) => record.id === id) ?? null),
        list: vi.fn(async () => records),
        put: vi.fn(async () => {}),
    };
}

function exportFixture() {
    const wallet = { id: 'wallet-1', name: 'Wallet', importedKeys: [] };
    return {
        wallet,
        vault: {
            wallets: collection([wallet]),
            accounts: collection(),
            addresses: collection(),
            contacts: collection(),
            connectedSites: collection(),
            pendingTxs: collection([{ id: 'pending-1' }]),
            settings: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        },
    };
}

function importVault() {
    return {
        wallets: collection(),
        accounts: collection(),
        addresses: collection(),
        contacts: collection(),
        connectedSites: collection(),
        pendingTxs: collection(),
        settings: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
    };
}

beforeEach(() => {
    crypto.decoded = null;
    crypto.encoded = null;
    crypto.decodeBackupEnvelope.mockReset().mockImplementation(async () => structuredClone(crypto.decoded));
    crypto.encodeBackupEnvelope.mockReset().mockImplementation(async (input) => {
        crypto.encoded = input;
        return { envelope: true };
    });
    crypto.parseBackupEnvelope.mockReset().mockImplementation((value) => value);
    crypto.stringifyBackupEnvelope.mockReset().mockReturnValue('{"envelope":true}');
    crypto.deriveMasterKeyAsync.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    crypto.makeFreshKdfParams.mockReset().mockReturnValue(NEXT_KDF);
    crypto.encrypt.mockReset().mockResolvedValue(new Uint8Array([6, 7]));
    crypto.decrypt.mockReset().mockResolvedValue(new Uint8Array([4, 5]));
});

describe('backup export and payload validation edges', () => {
    it.each([
        [{ vault: null, walletId: 'wallet-1', password: 'long enough' }, 'vault is required'],
        [{ vault: {}, walletId: '', password: 'long enough' }, 'walletId is required'],
    ])('rejects invalid export input before reading the vault %#', async (args, message) => {
        await expect(exportBackupFile(args)).rejects.toThrow(message);
    });

    it('throws WalletNotFoundError before listing any collections', async () => {
        const fixture = exportFixture();
        fixture.vault.wallets.get.mockResolvedValue(null);

        await expect(exportBackupFile({
            vault: fixture.vault, walletId: 'missing', password: 'long enough',
        })).rejects.toBeInstanceOf(WalletNotFoundError);
        expect(fixture.vault.accounts.list).not.toHaveBeenCalled();
    });

    it('omits pending transactions on request and keeps malformed site grants for validation', async () => {
        const fixture = exportFixture();
        const malformedSite = { id: 'site-1', permissions: { accounts: 'not-an-array' } };
        fixture.vault.connectedSites.list.mockResolvedValue([malformedSite]);

        await exportBackupFile({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'long enough',
            includePendingTxs: false,
        });

        expect(crypto.encoded.payload.pendingTxs).toEqual([]);
        expect(crypto.encoded.payload.connectedSites).toEqual([malformedSite]);
    });

    it.each([
        [{ onConflict: 'merge' }, /onConflict must be/],
        [{ mode: 'replace' }, /mode must be/],
    ])('rejects an unsupported import option before parsing %#', async (override, message) => {
        await expect(importBackupFile({
            vault: importVault(), fileContent: {}, password: 'backup password', ...override,
        })).rejects.toThrow(message);
        expect(crypto.parseBackupEnvelope).not.toHaveBeenCalled();
    });

    it.each([
        [null, 'decoded payload is not an object'],
        [{ payloadVersion: 2, wallet: { id: 'wallet-1' } }, 'unsupported payloadVersion 2'],
        [{ payloadVersion: 1 }, 'payload missing wallet record'],
        [{ payloadVersion: 1, wallet: { id: '' } }, 'payload missing wallet record'],
    ])('rejects malformed decoded payload %# before vault writes', async (decoded, message) => {
        crypto.decoded = decoded;
        const vault = importVault();

        await expect(importBackupFile({
            vault, fileContent: {}, password: 'backup password',
        })).rejects.toThrow(message);
        expect(vault.wallets.put).not.toHaveBeenCalled();
    });
});

describe('wallet re-key failure and cleanup edges', () => {
    it('returns false without requiring passwords when no sealed material exists', async () => {
        const wallet = { encryptedSeed: '', encryptedPassphrase: null, importedKeys: [] };

        await expect(rekeyWalletRecord(wallet, {})).resolves.toBe(false);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it.each([
        [{ walletPassword: '', devicePassword: 'device password' }, /Password of the wallet/],
        [{ walletPassword: 'wallet password', devicePassword: '' }, /Password for this device/],
    ])('names a missing password field before deriving keys %#', async (options, message) => {
        const wallet = { encryptedSeed: 'seed', kdfParams: KDF, importedKeys: [] };
        await expect(rekeyWalletRecord(wallet, options)).rejects.toThrow(message);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('rejects sealed material without KDF parameters', async () => {
        const wallet = { encryptedSeed: 'seed', importedKeys: [] };
        await expect(rekeyWalletRecord(wallet, {
            walletPassword: 'wallet password', devicePassword: 'device password',
        })).rejects.toThrow(/missing the details needed to unlock it/);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('classifies an imported-key decrypt failure and zeros the old key', async () => {
        const oldKey = new Uint8Array([1, 2, 3]);
        const wallet = {
            encryptedSeed: '',
            encryptedPassphrase: null,
            importedKeys: [{ addressId: 'address-1', encryptedWif: 'wif' }],
            kdfParams: KDF,
        };
        crypto.deriveMasterKeyAsync.mockResolvedValue(oldKey);
        crypto.decrypt.mockRejectedValue(new Error('bad tag'));

        const error = await rekeyWalletRecord(wallet, {
            walletPassword: 'wallet password', devicePassword: 'device password',
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(BackupSeedPasswordError);
        expect(error.what).toBe('imported key');
        expect([...oldKey]).toEqual([0, 0, 0]);
    });

    it('zeros both keys and decrypted plaintext when resealing fails', async () => {
        const oldKey = new Uint8Array([1, 2]);
        const newKey = new Uint8Array([3, 4]);
        const seed = new Uint8Array([5, 6]);
        const wallet = {
            encryptedSeed: 'seed', encryptedPassphrase: null, importedKeys: [], kdfParams: KDF,
        };
        crypto.deriveMasterKeyAsync
            .mockResolvedValueOnce(oldKey)
            .mockResolvedValueOnce(newKey);
        crypto.decrypt.mockResolvedValue(seed);
        crypto.encrypt.mockRejectedValue(new Error('encrypt unavailable'));

        await expect(rekeyWalletRecord(wallet, {
            walletPassword: 'wallet password', devicePassword: 'device password',
        })).rejects.toThrow('encrypt unavailable');
        expect([...oldKey]).toEqual([0, 0]);
        expect([...newKey]).toEqual([0, 0]);
        expect([...seed]).toEqual([0, 0]);
    });

    it('zeros decrypted seed and WIF bytes when passphrase decryption fails', async () => {
        const seed = new Uint8Array([5, 6]);
        const wif = new Uint8Array([7, 8]);
        const wallet = {
            encryptedSeed: 'seed',
            encryptedPassphrase: 'passphrase',
            importedKeys: [{ addressId: 'address-1', encryptedWif: 'wif' }],
            kdfParams: KDF,
        };
        crypto.decrypt
            .mockResolvedValueOnce(seed)
            .mockResolvedValueOnce(wif)
            .mockRejectedValueOnce(new Error('bad passphrase tag'));

        await rekeyWalletRecord(wallet, {
            walletPassword: 'wallet password', devicePassword: 'device password',
        }).catch(() => {});
        expect([...seed]).toEqual([0, 0]);
        expect([...wif]).toEqual([0, 0]);
    });
});

describe('backup pointer guard edges', () => {
    it.each([
        [{ vault: null, pointer: { location: 'x' }, password: 'p', resolveBackupContent: () => 'x' }, 'vault is required'],
        [{ vault: {}, pointer: { location: 'x' }, password: '', resolveBackupContent: () => 'x' }, 'password is required'],
        [{ vault: {}, pointer: { location: 'x' }, password: 'p' }, 'resolveBackupContent must be a function'],
        [{ vault: {}, pointer: {}, password: 'p', resolveBackupContent: () => 'x' }, 'pointer must have a location'],
    ])('rejects invalid pointer input %#', async (args, message) => {
        await expect(restoreFromBackupPointer(args)).rejects.toThrow(message);
    });

    it.each([null, undefined, '', '   '])('rejects unresolved backup content %j', async (content) => {
        const pointer = { location: 'https://example.invalid/backup' };
        const error = await restoreFromBackupPointer({
            vault: importVault(),
            pointer,
            password: 'backup password',
            resolveBackupContent: vi.fn(async () => content),
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(BackupPointerUnresolvedError);
        expect(error.pointer).toBe(pointer);
    });
});
