// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({
    calibrateKdfParamsAsync: vi.fn(),
    deriveMasterKeyAsync: vi.fn(),
    encrypt: vi.fn(),
    makeFreshKdfParams: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', () => ({
    bytesToBase64: (bytes) => `base64:${Array.from(bytes).join(',')}`,
    calibrateKdfParamsAsync: crypto.calibrateKdfParamsAsync,
    deriveMasterKeyAsync: crypto.deriveMasterKeyAsync,
    encrypt: crypto.encrypt,
    makeFreshKdfParams: crypto.makeFreshKdfParams,
}));

import {
    importSingleWif,
    InvalidWifError,
} from '../../../packages/core/src/flows/importSingleWif.js';

const KDF = Object.freeze({
    algorithm: 'argon2id', salt: 'salt', iterations: 1, memory: 8, parallelism: 1,
});
const DESCRIPTOR = Object.freeze({
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2pkh',
    addressTypes: ['p2pkh', 'p2wpkh'],
});

function setup(overrides = {}) {
    const walletPut = vi.fn(async () => {});
    const addressPut = vi.fn(async () => {});
    const importWIF = vi.fn(() => ({ publicKeyHex: '02abcd' }));
    const deriveAddress = vi.fn(() => 'mderived');
    return {
        args: {
            vault: { wallets: { put: walletPut }, addresses: { put: addressPut } },
            password: 'correct horse',
            chainRegistry: { get: vi.fn((id) => (id === DESCRIPTOR.id ? DESCRIPTOR : null)) },
            sdkRegistry: { get: vi.fn(() => ({ wallet: { importWIF, deriveAddress } })) },
            chainId: DESCRIPTOR.id,
            wif: 'cValidStubWif',
            kdfParams: KDF,
            ...overrides,
        },
        walletPut,
        addressPut,
        importWIF,
        deriveAddress,
    };
}

beforeEach(() => {
    crypto.calibrateKdfParamsAsync.mockReset().mockResolvedValue(KDF);
    crypto.makeFreshKdfParams.mockReset().mockReturnValue(KDF);
    crypto.deriveMasterKeyAsync.mockReset().mockResolvedValue(new Uint8Array([7, 7, 7]));
    crypto.encrypt.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('importSingleWif', () => {
    it('persists a linked WIF-only wallet and clears plaintext key material', async () => {
        const { args, walletPut, addressPut, importWIF, deriveAddress } = setup({
            name: 'Cold key',
            label: 'Donations',
            addressType: 'p2wpkh',
        });
        let masterKey;
        let plaintextWif;
        crypto.deriveMasterKeyAsync.mockImplementation(async () => {
            masterKey = new Uint8Array([9, 8, 7]);
            return masterKey;
        });
        crypto.encrypt.mockImplementation(async (_masterKey, bytes) => {
            plaintextWif = bytes;
            return new Uint8Array([4, 5]);
        });

        const { wallet, address } = await importSingleWif(args);

        expect(importWIF).toHaveBeenCalledWith('cValidStubWif');
        expect(deriveAddress).toHaveBeenCalledWith('02abcd', { type: 'p2wpkh' });
        expect(wallet).toMatchObject({
            name: 'Cold key',
            origin: 'imported-wif',
            format: 'wif-only',
            encryptedSeed: '',
            kdfParams: KDF,
        });
        expect(address).toMatchObject({
            accountId: null,
            chain: 'bitcoin',
            network: 'regtest',
            source: 'imported-wif',
            addressType: 'p2wpkh',
            derivationPath: null,
            address: 'mderived',
            publicKey: '02abcd',
            label: 'Donations',
            signerId: wallet.id,
        });
        expect(wallet.importedKeys).toEqual([
            expect.objectContaining({ addressId: address.id, encryptedWif: 'base64:4,5' }),
        ]);
        expect(walletPut).toHaveBeenCalledWith(wallet);
        expect(addressPut).toHaveBeenCalledWith(address);
        expect(Array.from(masterKey)).toEqual([0, 0, 0]);
        expect(Array.from(plaintextWif)).toEqual(new Array('cValidStubWif'.length).fill(0));
    });

    it('uses calibrated KDF parameters and default labels when none are supplied', async () => {
        const { args } = setup({ kdfParams: undefined });

        const result = await importSingleWif(args);

        expect(crypto.calibrateKdfParamsAsync).toHaveBeenCalledWith({ targetMs: 1000 });
        expect(result.wallet.name).toBe('Imported Wallet');
        expect(result.address.label).toBe('Imported Address');
        expect(result.address.addressType).toBe('p2pkh');
    });

    it('normalizes an SDK rejection and avoids KDF work', async () => {
        const sdkError = Object.assign(new Error('Non-base58 character'), { code: 'INVALID_WIF' });
        const { args, importWIF, walletPut } = setup();
        importWIF.mockImplementation(() => { throw sdkError; });

        const error = await importSingleWif(args).catch((err) => err);

        expect(error).toBeInstanceOf(InvalidWifError);
        expect(error).toMatchObject({ code: 'INVALID_WIF', raw: 'Non-base58 character' });
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
        expect(walletPut).not.toHaveBeenCalled();
    });

    it('clears the master key when encryption fails', async () => {
        const { args } = setup();
        const masterKey = new Uint8Array([3, 3]);
        crypto.deriveMasterKeyAsync.mockResolvedValue(masterKey);
        crypto.encrypt.mockRejectedValue(new Error('cipher unavailable'));

        await expect(importSingleWif(args)).rejects.toThrow('cipher unavailable');
        expect(Array.from(masterKey)).toEqual([0, 0]);
    });

    it.each([
        ['vault', { vault: null }, 'vault is required'],
        ['password', { password: '' }, 'password is required'],
        ['chain registry', { chainRegistry: null }, 'chainRegistry is required'],
        ['SDK registry', { sdkRegistry: null }, 'sdkRegistry is required'],
        ['chain id', { chainId: '' }, 'chainId is required'],
        ['WIF', { wif: '' }, 'wif is required'],
        ['known chain', { chainId: 'missing' }, 'unknown chain "missing"'],
        ['address type', { addressType: 'p2tr' }, 'addressType "p2tr" not supported'],
    ])('validates %s before deriving a key', async (_label, override, message) => {
        const { args } = setup(override);
        await expect(importSingleWif(args)).rejects.toThrow(message);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });
});
