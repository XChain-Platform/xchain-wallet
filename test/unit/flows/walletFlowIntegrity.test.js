// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { unlockWalletRecord } = vi.hoisted(() => ({ unlockWalletRecord: vi.fn() }));

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWalletRecord,
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    deriveMasterKeyAsync: vi.fn(async () => new Uint8Array(32).fill(1)),
    copyMasterKey: vi.fn((key) => new Uint8Array(key)),
    encryptWalletSeed: vi.fn(async ({ kdfParams }) => ({
        encryptedSeed: 'encrypted-seed',
        kdfParams,
    })),
}));

import { persistHdWallet } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { resolveActiveAddresses, setActiveAddress } from '../../../packages/core/src/flows/activeAddress.js';
import { deriveChangeAddress } from '../../../packages/core/src/flows/changeAddress.js';
import { createAccount } from '../../../packages/core/src/flows/createAccount.js';

function memCollection(initial = [], { failPutAt = 0 } = {}) {
    const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    let puts = 0;
    return {
        async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
        async list() { return [...rows.values()].map((row) => structuredClone(row)); },
        async findBy(field, value) {
            return [...rows.values()]
                .filter((row) => row[field] === value)
                .map((row) => structuredClone(row));
        },
        async put(row) {
            puts += 1;
            rows.set(row.id, structuredClone(row));
            if (puts === failPutAt) throw new Error('storage failed');
        },
        async delete(id) { return rows.delete(id); },
    };
}

const DESCRIPTORS = {
    'bitcoin-regtest': {
        id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest',
        defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'],
    },
    'litecoin-regtest': {
        id: 'litecoin-regtest', coin: 'litecoin', networkKind: 'regtest',
        defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'],
    },
};

const chainRegistry = {
    has: (id) => Object.hasOwn(DESCRIPTORS, id),
    get: (id) => DESCRIPTORS[id],
    chainIdFor: (coin, network) => Object.values(DESCRIPTORS)
        .find((descriptor) => descriptor.coin === coin && descriptor.networkKind === network)?.id ?? null,
};

function derivedSigner() {
    return {
        id: 'signer-1',
        kind: 'software',
        lock: vi.fn(),
        getMasterKey: () => new Uint8Array(32).fill(2),
        getAddresses: vi.fn(async ({ chainId, accountIndex, change, startIndex }) => [{
            address: `${chainId}-${accountIndex}-${change}-${startIndex}`,
            publicKey: '02'.padEnd(66, '1'),
            path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
        }]),
    };
}

function accountRecord(overrides = {}) {
    return {
        schemaVersion: 2,
        id: 'account-1',
        walletId: 'wallet-1',
        name: 'Main',
        index: 0,
        activeAddressByChainId: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function addressRecord(id, chain = 'bitcoin', overrides = {}) {
    return {
        schemaVersion: 4,
        id,
        accountId: 'account-1',
        chain,
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        address: `${chain}-${id}`,
        publicKey: '02'.padEnd(66, '1'),
        label: '',
        pinned: false,
        hidden: false,
        signerId: 'signer-1',
        role: 'receive',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    unlockWalletRecord.mockResolvedValue(derivedSigner());
});

describe('wallet graph persistence', () => {
    it('does not persist an account when initial address derivation fails', async () => {
        const accounts = memCollection();
        const addresses = memCollection();
        const signer = derivedSigner();
        signer.getAddresses
            .mockResolvedValueOnce([{ address: 'btc', publicKey: 'pub', path: "m/84'/1'/0'/0/0" }])
            .mockRejectedValueOnce(new Error('device disconnected'));
        const vault = {
            wallets: memCollection([{ id: 'wallet-1', format: 'bip39' }]),
            accounts,
            addresses,
        };

        await expect(createAccount({
            walletId: 'wallet-1',
            signer,
            vault,
            chainRegistry,
            sdkRegistry: {},
            activeChainIds: ['bitcoin-regtest', 'litecoin-regtest'],
        })).rejects.toThrow('device disconnected');

        expect(await accounts.list()).toEqual([]);
        expect(await addresses.list()).toEqual([]);
    });

    it('rolls back a new account when an address write fails', async () => {
        const accounts = memCollection();
        const addresses = memCollection([], { failPutAt: 1 });
        const vault = {
            wallets: memCollection([{ id: 'wallet-1', format: 'bip39' }]),
            accounts,
            addresses,
        };

        await expect(createAccount({
            walletId: 'wallet-1',
            signer: derivedSigner(),
            vault,
            chainRegistry,
            sdkRegistry: {},
            activeChainIds: ['bitcoin-regtest'],
        })).rejects.toThrow('storage failed');

        expect(await accounts.list()).toEqual([]);
        expect(await addresses.list()).toEqual([]);
    });

    it('rolls back the complete new wallet graph when an address write fails', async () => {
        const wallets = memCollection();
        const accounts = memCollection();
        const addresses = memCollection([], { failPutAt: 1 });
        const vault = {
            wallets,
            accounts,
            addresses,
            settings: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        };

        await expect(persistHdWallet({
            mnemonic: 'test mnemonic',
            format: 'bip39',
            origin: 'created',
            passphraseEnabled: false,
            password: 'secret',
            name: 'Wallet',
            accountName: 'Main',
            kdfParams: {
                algorithm: 'argon2id', salt: 'salt', iterations: 1, memory: 1, parallelism: 1,
            },
            vault,
            chainRegistry,
            sdkRegistry: {},
            activeChainIds: ['bitcoin-regtest'],
            activeNetwork: 'regtest',
        })).rejects.toThrow('storage failed');

        expect(await wallets.list()).toEqual([]);
        expect(await accounts.list()).toEqual([]);
        expect(await addresses.list()).toEqual([]);
    });
});

describe('active address scoping', () => {
    it('returns no addresses when the requested account is missing or belongs to another wallet', async () => {
        const vault = {
            wallets: memCollection(),
            accounts: memCollection([accountRecord()]),
            addresses: memCollection([addressRecord('btc')]),
        };

        await expect(resolveActiveAddresses({
            vault, walletId: 'wallet-1', accountId: 'missing', chainRegistry,
        })).resolves.toEqual({});
        await expect(resolveActiveAddresses({
            vault, walletId: 'wallet-2', accountId: 'account-1', chainRegistry,
        })).resolves.toEqual({});
    });

    it('rejects an address from a different chain before updating the account', async () => {
        const account = accountRecord();
        const accounts = memCollection([account]);
        const vault = {
            wallets: memCollection(),
            accounts,
            addresses: memCollection([addressRecord('btc')]),
        };

        await expect(setActiveAddress({
            vault,
            accountId: account.id,
            chainId: 'litecoin-regtest',
            addressId: 'btc',
            chainRegistry,
        })).rejects.toThrow('address does not belong to this chain');
        expect((await accounts.get(account.id)).activeAddressByChainId).toEqual({});
    });

    it('does not resolve an imported override under a different chain', async () => {
        const imported = addressRecord('imported-btc', 'bitcoin', {
            accountId: null,
            source: 'imported-wif',
            derivationPath: null,
        });
        const litecoin = addressRecord('ltc', 'litecoin');
        const account = accountRecord({
            activeAddressByChainId: { 'litecoin-regtest': imported.id },
        });
        const vault = {
            wallets: memCollection([{ id: 'wallet-1', importedKeys: [{ addressId: imported.id }] }]),
            accounts: memCollection([account]),
            addresses: memCollection([imported, litecoin]),
        };

        const result = await resolveActiveAddresses({
            vault, walletId: 'wallet-1', accountId: account.id, chainRegistry,
        });

        expect(result['litecoin-regtest']).toEqual({ id: litecoin.id, address: litecoin.address });
    });
});

describe('change address wallet ownership', () => {
    it('does not derive change from an account owned by a different wallet', async () => {
        const signer = derivedSigner();
        const source = addressRecord('source');
        const vault = {
            wallets: memCollection([{ id: 'wallet-2', format: 'bip39' }]),
            accounts: memCollection([accountRecord()]),
            addresses: memCollection([source]),
        };

        await expect(deriveChangeAddress({
            vault,
            walletId: 'wallet-2',
            signer,
            chainRegistry,
            chainId: 'bitcoin-regtest',
            sourceAddress: source.address,
        })).resolves.toBeNull();
        expect(signer.getAddresses).not.toHaveBeenCalled();
    });
});
