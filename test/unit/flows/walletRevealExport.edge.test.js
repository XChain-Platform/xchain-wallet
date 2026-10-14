// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    decryptWalletSeed: vi.fn(),
    decryptWalletPassphrase: vi.fn(),
    deriveMasterKeyAsync: vi.fn(),
    decrypt: vi.fn(),
    unlockWalletRecord: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/walletBlob.js', () => ({
    decryptWalletSeed: mocks.decryptWalletSeed,
    decryptWalletPassphrase: mocks.decryptWalletPassphrase,
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...await importOriginal(),
    deriveMasterKeyAsync: mocks.deriveMasterKeyAsync,
    decrypt: mocks.decrypt,
    base64ToBytes: () => new Uint8Array([1, 2]),
}));

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...await importOriginal(),
    unlockWalletRecord: mocks.unlockWalletRecord,
}));

import { revealMnemonic } from '../../../packages/core/src/flows/revealMnemonic.js';
import {
    AddressNotFoundError,
    AddressWalletMismatchError,
    exportPrivateKey,
    ImportedKeyMissingError,
    NoKeyForAddressError,
    WrongPasswordError,
} from '../../../packages/core/src/flows/exportPrivateKey.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

const chainRegistry = { chainIdFor: vi.fn(() => 'bitcoin-regtest') };

function revealWallet(overrides = {}) {
    return {
        id: 'wallet-1',
        name: 'Wallet',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'seed',
        encryptedPassphrase: null,
        kdfParams: {},
        ...overrides,
    };
}

function importedFixture({ address: addressOverrides = {}, wallet: walletOverrides = {} } = {}) {
    const address = {
        id: 'address-1',
        source: 'imported-wif',
        address: 'm-address',
        chain: 'bitcoin',
        network: 'regtest',
        accountId: null,
        signerId: 'wallet-1',
        ...addressOverrides,
    };
    const wallet = {
        id: 'wallet-1',
        format: 'wif-only',
        kdfParams: {},
        importedKeys: [{ addressId: address.id, encryptedWif: 'wif' }],
        ...walletOverrides,
    };
    return {
        address,
        wallet,
        vault: {
            addresses: { get: vi.fn(async (id) => (id === address.id ? address : null)) },
            wallets: { get: vi.fn(async (id) => (id === wallet.id ? wallet : null)) },
            accounts: { get: vi.fn(async () => null) },
        },
    };
}

function hdFixture(addressOverrides = {}, accountOverrides = {}) {
    const address = {
        id: 'address-hd',
        source: 'hd',
        address: 'bcrt1qaddress',
        chain: 'bitcoin',
        network: 'regtest',
        accountId: 'account-1',
        derivationPath: "m/84'/1'/0'/0/0",
        ...addressOverrides,
    };
    const wallet = { id: 'wallet-1', format: 'bip39', kdfParams: {}, importedKeys: [] };
    const account = { id: address.accountId, walletId: wallet.id, ...accountOverrides };
    return {
        address,
        wallet,
        account,
        vault: {
            addresses: { get: vi.fn(async () => address) },
            wallets: { get: vi.fn(async () => wallet) },
            accounts: { get: vi.fn(async () => account) },
        },
    };
}

beforeEach(() => {
    chainRegistry.chainIdFor.mockReset().mockReturnValue('bitcoin-regtest');
    mocks.decryptWalletSeed.mockReset().mockResolvedValue(new TextEncoder().encode('seed words'));
    mocks.decryptWalletPassphrase.mockReset().mockResolvedValue(new TextEncoder().encode('passphrase'));
    mocks.deriveMasterKeyAsync.mockReset().mockResolvedValue(new Uint8Array([7, 8]));
    mocks.decrypt.mockReset().mockResolvedValue(new TextEncoder().encode('private-key'));
    mocks.unlockWalletRecord.mockReset();
});

describe('revealMnemonic guard and cleanup edges', () => {
    it.each([
        [{ vault: null, walletId: 'wallet-1', password: 'password' }, 'vault is required'],
        [{ vault: {}, walletId: '', password: 'password' }, 'walletId is required'],
        [{ vault: {}, walletId: 'wallet-1', password: '' }, 'password is required'],
    ])('rejects invalid input before reading a wallet %#', async (args, message) => {
        await expect(revealMnemonic(args)).rejects.toThrow(message);
        expect(mocks.decryptWalletSeed).not.toHaveBeenCalled();
    });

    it('falls back to BIP39 for a legacy record without a format field and zeros plaintext', async () => {
        const plaintext = new TextEncoder().encode('seed words');
        const wallet = revealWallet({ format: undefined });
        mocks.decryptWalletSeed.mockResolvedValue(plaintext);

        await expect(revealMnemonic({
            vault: { wallets: { get: async () => wallet } },
            walletId: wallet.id,
            password: 'password',
        })).resolves.toMatchObject({ mnemonic: 'seed words', format: 'bip39' });
        expect([...plaintext]).toEqual(new Array(plaintext.length).fill(0));
    });

    it('zeros seed and retained master-key bytes when passphrase decryption fails', async () => {
        const plaintext = new TextEncoder().encode('seed words');
        const masterKey = new Uint8Array([3, 4]);
        const wallet = revealWallet({ passphraseEnabled: true, encryptedPassphrase: 'passphrase' });
        mocks.decryptWalletSeed.mockImplementation(async ({ retainMasterKey }) => {
            retainMasterKey(masterKey);
            return plaintext;
        });
        mocks.decryptWalletPassphrase.mockRejectedValue(new Error('passphrase decrypt failed'));

        await expect(revealMnemonic({
            vault: { wallets: { get: async () => wallet } },
            walletId: wallet.id,
            password: 'password',
        })).rejects.toThrow('passphrase decrypt failed');
        expect([...plaintext]).toEqual(new Array(plaintext.length).fill(0));
        expect([...masterKey]).toEqual([0, 0]);
    });

    it('zeros decrypted passphrase bytes after returning their text', async () => {
        const plaintext = new TextEncoder().encode('seed words');
        const passphrase = new TextEncoder().encode('secret');
        const masterKey = new Uint8Array([3, 4]);
        const wallet = revealWallet({ passphraseEnabled: true, encryptedPassphrase: 'passphrase' });
        mocks.decryptWalletSeed.mockImplementation(async ({ retainMasterKey }) => {
            retainMasterKey(masterKey);
            return plaintext;
        });
        mocks.decryptWalletPassphrase.mockResolvedValue(passphrase);

        const result = await revealMnemonic({
            vault: { wallets: { get: async () => wallet } },
            walletId: wallet.id,
            password: 'password',
        });

        expect(result.bip39Passphrase).toBe('secret');
        expect([...passphrase]).toEqual(new Array(passphrase.length).fill(0));
        expect([...masterKey]).toEqual([0, 0]);
    });
});

describe('exportPrivateKey refusal and cleanup edges', () => {
    it.each([
        [{ vault: null, walletId: 'wallet-1', password: 'password', chainRegistry, addressId: 'address-1' }, 'vault is required'],
        [{ vault: {}, walletId: '', password: 'password', chainRegistry, addressId: 'address-1' }, 'walletId is required'],
        [{ vault: {}, walletId: 'wallet-1', chainRegistry, addressId: 'address-1' }, 'either `signer` or `password` is required'],
        [{ vault: {}, walletId: 'wallet-1', password: 'password', chainRegistry: null, addressId: 'address-1' }, 'chainRegistry is required'],
        [{ vault: {}, walletId: 'wallet-1', password: 'password', chainRegistry, addressId: '' }, 'addressId is required'],
    ])('rejects invalid input before loading an address %#', async (args, message) => {
        await expect(exportPrivateKey(args)).rejects.toThrow(message);
    });

    it('throws AddressNotFoundError before loading a wallet', async () => {
        const getWallet = vi.fn();
        await expect(exportPrivateKey({
            vault: { addresses: { get: async () => null }, wallets: { get: getWallet } },
            walletId: 'wallet-1',
            password: 'password',
            chainRegistry,
            addressId: 'missing',
        })).rejects.toBeInstanceOf(AddressNotFoundError);
        expect(getWallet).not.toHaveBeenCalled();
    });

    it.each([
        ['watch-only', 'watch-only'],
        ['trezor', 'hardware'],
        ['ledger', 'hardware'],
    ])('refuses %s addresses before loading a wallet', async (source, reason) => {
        const fixture = importedFixture({ address: { source } });

        const error = await exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(NoKeyForAddressError);
        expect(error.reason).toBe(reason);
        expect(fixture.vault.wallets.get).not.toHaveBeenCalled();
    });

    it('throws WalletNotFoundError after resolving an exportable address', async () => {
        const fixture = importedFixture();
        fixture.vault.wallets.get.mockResolvedValue(null);

        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toBeInstanceOf(WalletNotFoundError);
    });

    it('rejects an HD address without a wallet-owned account', async () => {
        const fixture = hdFixture({}, { walletId: 'other-wallet' });

        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toBeInstanceOf(AddressWalletMismatchError);
    });

    it('rejects an address whose chain is not registered', async () => {
        const fixture = importedFixture();
        chainRegistry.chainIdFor.mockReturnValue(null);

        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toThrow('no registered chain for bitcoin/regtest');
        expect(mocks.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('requires the matching session export capability for each address type', async () => {
        const imported = importedFixture();
        await expect(exportPrivateKey({
            vault: imported.vault,
            walletId: imported.wallet.id,
            signer: { id: imported.wallet.id },
            chainRegistry,
            addressId: imported.address.id,
        })).rejects.toThrow('signer cannot export imported private keys');

        const hd = hdFixture();
        await expect(exportPrivateKey({
            vault: hd.vault,
            walletId: hd.wallet.id,
            signer: { id: hd.wallet.id },
            chainRegistry,
            addressId: hd.address.id,
        })).rejects.toThrow('signer cannot export derived private keys');
    });

    it('rejects an HD address without a derivation path on both credential paths', async () => {
        const fixture = hdFixture({ derivationPath: null });
        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            signer: { id: fixture.wallet.id, exportWifForPath: vi.fn() },
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toThrow('has no derivationPath');
        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toThrow('has no derivationPath');
        expect(mocks.unlockWalletRecord).not.toHaveBeenCalled();
    });

    it.each(['wif-only', 'bip39'])('maps a bad %s wallet password and zeros the derived key', async (format) => {
        const masterKey = new Uint8Array([7, 8]);
        const fixture = importedFixture({
            wallet: { format, encryptedSeed: format === 'bip39' ? 'seed' : '' },
        });
        mocks.deriveMasterKeyAsync.mockResolvedValue(masterKey);
        mocks.decrypt.mockRejectedValue(new Error('bad tag'));

        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'wrong password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toBeInstanceOf(WrongPasswordError);
        expect([...masterKey]).toEqual([0, 0]);
    });

    it('locks an unlocked HD signer when key export throws', async () => {
        const fixture = hdFixture();
        const signer = {
            exportWifForPath: vi.fn(() => { throw new Error('derive failed'); }),
            lock: vi.fn(),
        };
        mocks.unlockWalletRecord.mockResolvedValue(signer);

        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            sdkRegistry: {},
            addressId: fixture.address.id,
        })).rejects.toThrow('derive failed');
        expect(signer.lock).toHaveBeenCalledOnce();
    });

    it('reports a missing imported key before checking wallet ownership', async () => {
        const fixture = importedFixture({ wallet: { importedKeys: [] } });
        await expect(exportPrivateKey({
            vault: fixture.vault,
            walletId: fixture.wallet.id,
            password: 'password',
            chainRegistry,
            addressId: fixture.address.id,
        })).rejects.toBeInstanceOf(ImportedKeyMissingError);
    });
});
