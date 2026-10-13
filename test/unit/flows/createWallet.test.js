// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateBip39Mnemonic, persistHdWallet } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    persistHdWallet: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/mnemonic.js', () => ({
    BIP39_DEFAULT_STRENGTH_BITS: 128,
    generateBip39Mnemonic,
}));

vi.mock('../../../packages/core/src/flows/_persistHdWallet.js', () => ({
    persistHdWallet,
}));

const { createWallet } = await import('../../../packages/core/src/flows/createWallet.js');

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function harness() {
    const descriptors = new Map([
        ['bitcoin-regtest', { id: 'bitcoin-regtest', networkKind: 'regtest' }],
        ['litecoin-regtest', { id: 'litecoin-regtest', networkKind: 'regtest' }],
    ]);
    return {
        vault: { wallets: {} },
        sdkRegistry: { get: vi.fn() },
        chainRegistry: {
            has: vi.fn((id) => descriptors.has(id)),
            descriptorFor: vi.fn((id) => descriptors.get(id)),
        },
    };
}

beforeEach(() => {
    generateBip39Mnemonic.mockReset().mockReturnValue(mnemonic);
    persistHdWallet.mockReset().mockResolvedValue({
        wallet: { id: 'wallet-1' },
        account: { id: 'account-1' },
        addresses: [{ chainId: 'bitcoin-regtest', address: { id: 'address-1' } }],
    });
});

describe('createWallet', () => {
    it('generates the requested mnemonic and persists the complete creation context', async () => {
        const deps = harness();
        const masterKey = new Uint8Array([1, 2, 3]);

        const result = await createWallet({
            ...deps,
            password: 'correct horse battery staple',
            activeChainIds: ['bitcoin-regtest', 'litecoin-regtest'],
            name: 'Savings',
            strengthBits: 256,
            bip39Passphrase: 'hidden words',
            kdfParams: { algorithm: 'argon2id' },
            masterKey,
        });

        expect(generateBip39Mnemonic).toHaveBeenCalledWith(256);
        expect(persistHdWallet).toHaveBeenCalledWith(expect.objectContaining({
            mnemonic,
            format: 'bip39',
            origin: 'created',
            passphraseEnabled: true,
            bip39Passphrase: 'hidden words',
            password: 'correct horse battery staple',
            name: 'Savings',
            accountName: 'Main',
            masterKey,
            activeChainIds: ['bitcoin-regtest', 'litecoin-regtest'],
            activeNetwork: 'regtest',
        }));
        expect(result).toEqual({
            mnemonic,
            wallet: { id: 'wallet-1' },
            account: { id: 'account-1' },
            addresses: [{ chainId: 'bitcoin-regtest', address: { id: 'address-1' } }],
        });
    });

    it('honors an explicit active network and disables an empty BIP39 passphrase', async () => {
        const deps = harness();

        await createWallet({
            ...deps,
            password: 'password',
            activeChainIds: ['bitcoin-regtest'],
            activeNetwork: 'mainnet',
        });

        expect(persistHdWallet).toHaveBeenCalledWith(expect.objectContaining({
            activeNetwork: 'mainnet',
            passphraseEnabled: false,
            bip39Passphrase: '',
        }));
    });

    it('rejects an unknown chain before generating or persisting secret material', async () => {
        const deps = harness();

        await expect(createWallet({
            ...deps,
            password: 'password',
            activeChainIds: ['unknown-mainnet'],
        })).rejects.toThrow('unknown chain "unknown-mainnet"');

        expect(generateBip39Mnemonic).not.toHaveBeenCalled();
        expect(persistHdWallet).not.toHaveBeenCalled();
    });

    it.each([
        [{ password: '', activeChainIds: ['bitcoin-regtest'] }, /password is required/],
        [{ password: 'password', activeChainIds: [] }, /non-empty array/],
    ])('validates required input %#', async (overrides, message) => {
        await expect(createWallet({ ...harness(), ...overrides })).rejects.toThrow(message);
        expect(generateBip39Mnemonic).not.toHaveBeenCalled();
    });
});
