// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({
    calibrateKdfParamsAsync: vi.fn(),
    deriveMasterKeyAsync: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    makeFreshKdfParams: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', () => ({
    bytesToBase64: (bytes) => `base64:${Array.from(bytes).join(',')}`,
    base64ToBytes: () => new Uint8Array([4, 5, 6]),
    calibrateKdfParamsAsync: crypto.calibrateKdfParamsAsync,
    deriveMasterKeyAsync: crypto.deriveMasterKeyAsync,
    encrypt: crypto.encrypt,
    decrypt: crypto.decrypt,
    makeFreshKdfParams: crypto.makeFreshKdfParams,
}));

import {
    importSingleWif,
    InvalidWifError as InvalidSingleWifError,
} from '../../../packages/core/src/flows/importSingleWif.js';
import {
    importWif,
    WrongPasswordError,
} from '../../../packages/core/src/flows/importWif.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

const KDF = {
    algorithm: 'argon2id', salt: 'salt', iterations: 1, memory: 8, parallelism: 1,
};
const DESCRIPTOR = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2pkh',
    addressTypes: ['p2pkh'],
};

function registries(importWIF = vi.fn(() => ({ publicKeyHex: '02abcd' }))) {
    return {
        chainRegistry: { get: vi.fn((id) => (id === DESCRIPTOR.id ? DESCRIPTOR : null)) },
        sdkRegistry: {
            get: vi.fn(() => ({
                wallet: { importWIF, deriveAddress: vi.fn(() => 'm-address') },
            })),
        },
    };
}

function singleHarness(overrides = {}) {
    const vault = {
        wallets: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
            delete: vi.fn(async () => true),
        },
        addresses: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
            delete: vi.fn(async () => true),
        },
    };
    return {
        vault,
        args: {
            vault,
            password: 'wallet password',
            ...registries(),
            chainId: DESCRIPTOR.id,
            wif: 'c-valid-wif',
            kdfParams: KDF,
            ...overrides,
        },
    };
}

function existingHarness(walletOverrides = {}, argsOverrides = {}) {
    const wallet = {
        id: 'wallet-1',
        name: 'Wallet',
        format: 'bip39',
        encryptedSeed: 'seed',
        kdfParams: KDF,
        importedKeys: [],
        ...walletOverrides,
    };
    const vault = {
        wallets: {
            get: vi.fn(async (id) => (id === wallet.id ? wallet : null)),
            put: vi.fn(async () => {}),
        },
        addresses: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
            delete: vi.fn(async () => true),
        },
    };
    return {
        wallet,
        vault,
        args: {
            vault,
            walletId: wallet.id,
            password: 'wallet password',
            ...registries(),
            chainId: DESCRIPTOR.id,
            wif: 'c-valid-wif',
            ...argsOverrides,
        },
    };
}

beforeEach(() => {
    crypto.calibrateKdfParamsAsync.mockReset().mockResolvedValue(KDF);
    crypto.makeFreshKdfParams.mockReset().mockReturnValue(KDF);
    crypto.deriveMasterKeyAsync.mockReset().mockResolvedValue(new Uint8Array([9, 9, 9]));
    crypto.encrypt.mockReset().mockResolvedValue(new Uint8Array([7, 8]));
    crypto.decrypt.mockReset().mockResolvedValue(new Uint8Array([1, 2]));
});

describe('importSingleWif persistence edges', () => {
    it('normalizes a primitive SDK rejection', async () => {
        const importWIF = vi.fn(() => { throw 'bad key'; });
        const { args } = singleHarness({ ...registries(importWIF) });

        const error = await importSingleWif(args).catch((caught) => caught);

        expect(error).toBeInstanceOf(InvalidSingleWifError);
        expect(error).toMatchObject({ raw: 'bad key', code: null });
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('refuses wallet and address identifier collisions before writes', async () => {
        const walletCollision = singleHarness();
        walletCollision.vault.wallets.get.mockResolvedValue({ id: 'existing-wallet' });
        await expect(importSingleWif(walletCollision.args)).rejects.toThrow(/wallet id collision/);
        expect(walletCollision.vault.wallets.put).not.toHaveBeenCalled();

        const addressCollision = singleHarness();
        addressCollision.vault.addresses.get.mockResolvedValue({ id: 'existing-address' });
        await expect(importSingleWif(addressCollision.args)).rejects.toThrow(/address id collision/);
        expect(addressCollision.vault.wallets.put).not.toHaveBeenCalled();
        expect(addressCollision.vault.addresses.put).not.toHaveBeenCalled();
    });

    it('reports both the original write failure and a rollback failure', async () => {
        const { args, vault } = singleHarness();
        vault.wallets.put.mockRejectedValue(new Error('wallet write failed'));
        vault.wallets.delete.mockRejectedValue(new Error('wallet rollback failed'));

        const error = await importSingleWif(args).catch((caught) => caught);

        expect(error).toBeInstanceOf(AggregateError);
        expect(error.message).toBe('importSingleWif: persistence and rollback failed');
        expect(error.errors.map(({ message }) => message))
            .toEqual(['wallet write failed', 'wallet rollback failed']);
        expect(error.cause.message).toBe('wallet write failed');
    });
});

describe('importWif error and rollback edges', () => {
    it.each([
        [{ vault: null }, 'vault is required'],
        [{ walletId: '' }, 'walletId is required'],
        [{ password: '', masterKey: undefined }, 'password or masterKey is required'],
        [{ chainRegistry: null }, 'chainRegistry is required'],
        [{ sdkRegistry: null }, 'sdkRegistry is required'],
        [{ chainId: '' }, 'chainId is required'],
        [{ wif: '' }, 'wif is required'],
        [{ chainId: 'unknown' }, 'unknown chain "unknown"'],
        [{ addressType: 'p2tr' }, 'addressType "p2tr" not supported'],
    ])('rejects invalid input before deriving a key %#', async (override, message) => {
        const { args } = existingHarness({}, override);
        await expect(importWif(args)).rejects.toThrow(message);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('throws WalletNotFoundError before asking the SDK to parse the WIF', async () => {
        const { args, vault } = existingHarness();
        vault.wallets.get.mockResolvedValue(null);

        await expect(importWif(args)).rejects.toBeInstanceOf(WalletNotFoundError);
        expect(args.sdkRegistry.get).not.toHaveBeenCalled();
    });

    it('refuses an address identifier collision without persisting either record', async () => {
        const { args, vault } = existingHarness();
        vault.addresses.get.mockResolvedValue({ id: 'collision' });

        await expect(importWif(args)).rejects.toThrow(/address id collision/);
        expect(vault.addresses.put).not.toHaveBeenCalled();
        expect(vault.wallets.put).not.toHaveBeenCalled();
    });

    it('skips malformed and dangling imported-key links during duplicate detection', async () => {
        const { args, vault } = existingHarness({
            importedKeys: [null, { addressId: 42 }, { addressId: 'missing-address' }],
        }, { masterKey: new Uint8Array([3, 4]), password: undefined });

        await expect(importWif(args)).resolves.toMatchObject({
            address: { address: 'm-address' },
        });
        expect(vault.addresses.get).toHaveBeenCalledWith('missing-address');
    });

    it('keeps a session-owned master key intact when password verification fails', async () => {
        const sessionKey = new Uint8Array([5, 6, 7]);
        const { args } = existingHarness({}, { masterKey: sessionKey, password: undefined });
        crypto.decrypt.mockRejectedValue(new Error('bad tag'));

        await expect(importWif(args)).rejects.toBeInstanceOf(WrongPasswordError);
        expect([...sessionKey]).toEqual([5, 6, 7]);
        expect(crypto.deriveMasterKeyAsync).not.toHaveBeenCalled();
    });

    it('zeros a derived master key when password verification fails', async () => {
        const derivedKey = new Uint8Array([5, 6, 7]);
        const { args } = existingHarness();
        crypto.deriveMasterKeyAsync.mockResolvedValue(derivedKey);
        crypto.decrypt.mockRejectedValue(new Error('bad tag'));

        await expect(importWif(args)).rejects.toBeInstanceOf(WrongPasswordError);
        expect([...derivedKey]).toEqual([0, 0, 0]);
    });

    it('aggregates a failed final write with both failed rollback operations', async () => {
        const { args, vault } = existingHarness();
        vault.wallets.put
            .mockRejectedValueOnce(new Error('updated wallet write failed'))
            .mockRejectedValueOnce(new Error('wallet restore failed'));
        vault.addresses.delete.mockRejectedValue(new Error('address rollback failed'));

        const error = await importWif(args).catch((caught) => caught);

        expect(error).toBeInstanceOf(AggregateError);
        expect(error.message).toBe('importWif: persistence and rollback failed');
        expect(error.errors.map(({ message }) => message)).toEqual([
            'updated wallet write failed',
            'wallet restore failed',
            'address rollback failed',
        ]);
    });
});
