// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import {
    ImportConflictError,
    importWif,
} from '../../../packages/core/src/flows/importWif.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';

const OLD_KEY = new Uint8Array(32).fill(31);
const NEW_KEY = new Uint8Array(32).fill(47);
const SEED = new Uint8Array(16).fill(9);
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};
const DESCRIPTOR = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2pkh',
    addressTypes: ['p2pkh'],
};
const chainRegistry = { get: () => DESCRIPTOR };
const sdkRegistry = {
    get: () => ({
        wallet: {
            importWIF: () => ({ publicKeyHex: '02aa', compressed: true }),
            deriveAddress: () => 'mImportedAddress',
        },
    }),
};

async function setupVault() {
    const backend = new InMemoryBackend();
    const vault = new Vault({ backend, masterKey: OLD_KEY });
    await vault.open();
    const sealed = await encryptWalletSeed({
        seed: SEED,
        masterKey: OLD_KEY,
        kdfParams: KDF_PARAMS,
    });
    await vault.wallets.put({
        ...createWallet({
            name: 'Primary',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'wallet-1',
    });
    return { backend, vault };
}

async function passwordChangeInput(vault) {
    const readWallets = await vault.wallets.list();
    const sealed = await encryptWalletSeed({
        seed: SEED,
        masterKey: NEW_KEY,
        kdfParams: KDF_PARAMS,
    });
    return {
        readWallets,
        replacement: { ...readWallets[0], encryptedSeed: sealed.encryptedSeed },
    };
}

async function commitPasswordChange(vault) {
    const { readWallets, replacement } = await passwordChangeInput(vault);
    await vault.rekey({
        masterKey: NEW_KEY,
        wallets: [replacement],
        readWallets,
    });
    return replacement;
}

function runImport(vault) {
    return importWif({
        vault,
        walletId: 'wallet-1',
        masterKey: OLD_KEY,
        chainRegistry,
        sdkRegistry,
        chainId: DESCRIPTOR.id,
        wif: 'cImportedWif',
    });
}

async function expectOnlyPasswordChange({ backend, vault, replacement }) {
    expect(await vault.addresses.count()).toBe(0);
    expect(await vault.wallets.get('wallet-1')).toEqual(replacement);
    const reopened = new Vault({ backend, masterKey: NEW_KEY });
    await reopened.open();
    expect(await reopened.wallets.get('wallet-1')).toEqual(replacement);
}

describe('importWif password-change concurrency', () => {
    it('refuses when a password change commits before the guarded import write', async () => {
        const { backend, vault } = await setupVault();
        const getAddress = vault.addresses.get.bind(vault.addresses);
        let replacement;
        vault.addresses.get = async (id) => {
            replacement = await commitPasswordChange(vault);
            vault.addresses.get = getAddress;
            return getAddress(id);
        };

        await expect(runImport(vault)).rejects.toBeInstanceOf(ImportConflictError);
        await expectOnlyPasswordChange({ backend, vault, replacement });
    });

    it('refuses a password change queued immediately ahead of the import write', async () => {
        const { backend, vault } = await setupVault();
        const { readWallets, replacement } = await passwordChangeInput(vault);
        const guardedWrite = vault.putManyGuarded.bind(vault);
        vault.putManyGuarded = async (builder) => {
            const rekey = vault.rekey({
                masterKey: NEW_KEY,
                wallets: [replacement],
                readWallets,
            });
            const write = guardedWrite(builder);
            await rekey;
            return write;
        };

        await expect(runImport(vault)).rejects.toBeInstanceOf(ImportConflictError);
        await expectOnlyPasswordChange({ backend, vault, replacement });
    });
});
