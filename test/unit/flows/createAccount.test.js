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

import { createAccount } from '../../../packages/core/src/flows/createAccount.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

const DESCRIPTORS = {
    'bitcoin-mainnet': {
        coin: 'bitcoin',
        networkKind: 'mainnet',
        defaultAddressType: 'p2wpkh',
    },
    'litecoin-mainnet': {
        coin: 'litecoin',
        networkKind: 'mainnet',
        defaultAddressType: 'p2wpkh',
    },
};

const chainRegistry = {
    has: vi.fn((id) => Object.hasOwn(DESCRIPTORS, id)),
    get: vi.fn((id) => DESCRIPTORS[id]),
};

function makeVault({ wallet = { id: 'wallet-1', format: 'bip39' }, accounts = [] } = {}) {
    return {
        wallets: { get: vi.fn().mockResolvedValue(wallet) },
        accounts: {
            findBy: vi.fn().mockResolvedValue(accounts),
            put: vi.fn().mockResolvedValue(undefined),
        },
        addresses: { put: vi.fn().mockResolvedValue(undefined) },
    };
}

function makeSigner(kind = 'software') {
    return {
        id: `signer-${kind}`,
        kind,
        getAddresses: vi.fn(async ({ chainId, accountIndex }) => [{
            path: `m/${chainId}/${accountIndex}/0/0`,
            address: `${chainId}-address-${accountIndex}`,
            publicKey: `${chainId}-pubkey-${accountIndex}`,
        }]),
        lock: vi.fn(),
    };
}

function opts(vault, signer, overrides = {}) {
    return {
        walletId: 'wallet-1',
        signer,
        vault,
        chainRegistry,
        sdkRegistry: { get: vi.fn() },
        activeChainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
        ...overrides,
    };
}

describe('createAccount', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the next free index and persists one derived address per chain', async () => {
        const vault = makeVault({
            accounts: [
                { walletId: 'wallet-1', index: 1 },
                { walletId: 'wallet-1', index: 4 },
            ],
        });
        const signer = makeSigner();

        const result = await createAccount(opts(vault, signer));

        expect(result.account).toMatchObject({
            walletId: 'wallet-1',
            name: 'Account 6',
            index: 5,
        });
        expect(vault.accounts.findBy).toHaveBeenCalledWith('walletId', 'wallet-1');
        expect(vault.accounts.put).toHaveBeenCalledWith(result.account);
        expect(signer.getAddresses).toHaveBeenNthCalledWith(1, {
            chainId: 'bitcoin-mainnet',
            accountIndex: 5,
            change: 0,
            startIndex: 0,
            count: 1,
            addressType: 'p2wpkh',
        });
        expect(result.addresses.map(({ chainId, address }) => ({
            chainId,
            accountId: address.accountId,
            source: address.source,
            label: address.label,
        }))).toEqual([
            {
                chainId: 'bitcoin-mainnet',
                accountId: result.account.id,
                source: 'hd',
                label: 'BTC Address #1',
            },
            {
                chainId: 'litecoin-mainnet',
                accountId: result.account.id,
                source: 'hd',
                label: 'LTC Address #1',
            },
        ]);
        expect(vault.addresses.put).toHaveBeenCalledTimes(2);
        expect(signer.lock).not.toHaveBeenCalled();
        expect(unlockWalletRecord).not.toHaveBeenCalled();
    });

    it('persists hardware ownership and applies explicit labels', async () => {
        const vault = makeVault();
        const signer = makeSigner('trezor');

        const result = await createAccount(opts(vault, signer, {
            activeChainIds: ['bitcoin-mainnet'],
            name: 'Trading',
            initialAddressLabel: 'Primary',
        }));

        expect(result.account.name).toBe('Trading');
        expect(result.addresses[0].address).toMatchObject({
            source: 'trezor',
            signerId: 'signer-trezor',
            label: 'Primary',
        });
        expect(signer.lock).not.toHaveBeenCalled();
    });

    it('unlocks and always locks a password-owned signer after derivation', async () => {
        const vault = makeVault();
        const signer = makeSigner();
        unlockWalletRecord.mockResolvedValue(signer);

        await createAccount(opts(vault, undefined, {
            password: 'secret',
            bip39Passphrase: 'twenty-fifth',
            activeChainIds: ['bitcoin-mainnet'],
        }));

        expect(unlockWalletRecord).toHaveBeenCalledWith({
            wallet: { id: 'wallet-1', format: 'bip39' },
            password: 'secret',
            bip39Passphrase: 'twenty-fifth',
            chainRegistry,
            sdkRegistry: expect.any(Object),
        });
        expect(signer.lock).toHaveBeenCalledOnce();
    });

    it('locks a password-owned signer when address derivation fails', async () => {
        const vault = makeVault();
        const signer = makeSigner();
        signer.getAddresses.mockRejectedValue(new Error('device failed'));
        unlockWalletRecord.mockResolvedValue(signer);

        await expect(createAccount(opts(vault, undefined, {
            password: 'secret',
            activeChainIds: ['bitcoin-mainnet'],
        }))).rejects.toThrow('device failed');
        expect(signer.lock).toHaveBeenCalledOnce();
    });

    it('refuses unknown chains before reading or writing the vault', async () => {
        const vault = makeVault();

        await expect(createAccount(opts(vault, makeSigner(), {
            activeChainIds: ['unknown-chain'],
        }))).rejects.toThrow('createAccount: unknown chain "unknown-chain"');
        expect(vault.wallets.get).not.toHaveBeenCalled();
        expect(vault.accounts.put).not.toHaveBeenCalled();
    });

    it('throws WalletNotFoundError without persisting an account', async () => {
        const vault = makeVault({ wallet: null });

        await expect(createAccount(opts(vault, makeSigner())))
            .rejects.toBeInstanceOf(WalletNotFoundError);
        expect(vault.accounts.put).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });
});
