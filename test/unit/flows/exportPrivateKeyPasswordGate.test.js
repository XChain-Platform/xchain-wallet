// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
    deriveMasterKeyAsync: vi.fn(async () => new Uint8Array(32).fill(7)),
    decrypt: vi.fn(async () => new TextEncoder().encode('confirmed-private-key')),
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...await importOriginal(),
    deriveMasterKeyAsync: cryptoMocks.deriveMasterKeyAsync,
    decrypt: cryptoMocks.decrypt,
}));

import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';

const address = {
    id: 'a1',
    source: 'imported-wif',
    address: 'test-address',
    chain: 'bitcoin',
    network: 'regtest',
};
const wallet = {
    id: 'w1',
    format: 'wif-only',
    kdfParams: {},
    importedKeys: [{ addressId: address.id, encryptedWif: 'AA==' }],
};
const vault = {
    addresses: { get: vi.fn(async () => address) },
    wallets: { get: vi.fn(async () => wallet) },
};
const chainRegistry = { chainIdFor: vi.fn(() => 'bitcoin-regtest') };

beforeEach(() => {
    cryptoMocks.deriveMasterKeyAsync.mockReset();
    cryptoMocks.deriveMasterKeyAsync.mockResolvedValue(new Uint8Array(32).fill(7));
    cryptoMocks.decrypt.mockReset();
    cryptoMocks.decrypt.mockImplementation(async () =>
        new TextEncoder().encode('confirmed-private-key'));
});

describe('exportPrivateKey password confirmation', () => {
    it('verifies a supplied password instead of using the session signer', async () => {
        const signer = {
            exportWifForPath: vi.fn(),
            exportWifForAddressId: vi.fn(() => 'session-private-key'),
        };

        const result = await exportPrivateKey({
            vault,
            walletId: wallet.id,
            signer,
            password: 'wallet-password',
            chainRegistry,
            addressId: address.id,
        });

        expect(cryptoMocks.deriveMasterKeyAsync).toHaveBeenCalledWith(
            'wallet-password',
            wallet.kdfParams,
        );
        expect(signer.exportWifForAddressId).not.toHaveBeenCalled();
        expect(result.wif).toBe('confirmed-private-key');
    });

    it('rejects an address that is not owned by the requested wallet', async () => {
        const foreignWallet = { ...wallet, importedKeys: [] };
        const foreignVault = {
            addresses: { get: vi.fn(async () => address) },
            wallets: { get: vi.fn(async () => foreignWallet) },
        };

        await expect(exportPrivateKey({
            vault: foreignVault,
            walletId: foreignWallet.id,
            password: 'wallet-password',
            chainRegistry,
            addressId: address.id,
        })).rejects.toMatchObject({ name: 'AddressWalletMismatchError' });
        expect(cryptoMocks.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('rejects a session signer from another wallet', async () => {
        const signer = {
            id: 'other-wallet',
            exportWifForAddressId: vi.fn(() => 'wrong-wallet-private-key'),
        };

        await expect(exportPrivateKey({
            vault,
            walletId: wallet.id,
            signer,
            chainRegistry,
            addressId: address.id,
        })).rejects.toThrow(/signer does not belong/);
        expect(signer.exportWifForAddressId).not.toHaveBeenCalled();
    });

    it('propagates an asynchronous signer export failure', async () => {
        const signer = {
            id: wallet.id,
            exportWifForAddressId: vi.fn(async () => {
                throw new Error('session export failed');
            }),
        };

        await expect(exportPrivateKey({
            vault,
            walletId: wallet.id,
            signer,
            chainRegistry,
            addressId: address.id,
        })).rejects.toThrow('session export failed');
    });

    it('clears decrypted seed probe bytes before returning an imported key', async () => {
        const seedBytes = new TextEncoder().encode('seed words');
        const wifBytes = new TextEncoder().encode('private-key');
        cryptoMocks.decrypt
            .mockResolvedValueOnce(seedBytes)
            .mockResolvedValueOnce(wifBytes);
        const seedWallet = {
            ...wallet,
            format: 'bip39',
            encryptedSeed: 'AA==',
        };
        const seedVault = {
            addresses: { get: vi.fn(async () => address) },
            wallets: { get: vi.fn(async () => seedWallet) },
        };

        const result = await exportPrivateKey({
            vault: seedVault,
            walletId: seedWallet.id,
            password: 'wallet-password',
            chainRegistry,
            addressId: address.id,
        });

        expect(result.wif).toBe('private-key');
        expect([...seedBytes]).toEqual(new Array(seedBytes.length).fill(0));
        expect([...wifBytes]).toEqual(new Array(wifBytes.length).fill(0));
    });
});
