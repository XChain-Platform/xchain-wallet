/**
 * @vitest-environment node
 */

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    createRuntime,
    ensureHost,
    tearDownHost,
} from '../../../packages/desktop/main/runtime.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { createWallet as createWalletRecord } from '../../../packages/core/src/schemas/wallet.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};
const OTHER_KDF_PARAMS = {
    ...KDF_PARAMS,
    salt: 'AQEBAQEBAQEBAQEBAQEBAQ==',
};

function memoryBackend(initial = null) {
    let value = initial instanceof Uint8Array ? new Uint8Array(initial) : initial;
    return {
        load: async () => (value instanceof Uint8Array ? new Uint8Array(value) : value),
        save: async (next) => { value = new Uint8Array(next); },
        clear: async () => { value = null; },
    };
}

describe('desktop keychain signer restoration', () => {
    it('rebuilds only wallet signers sealed with the cached vault key', async () => {
        const masterKey = new Uint8Array(32).fill(7);
        const otherKey = new Uint8Array(32).fill(9);
        const storageBackend = memoryBackend();
        const setupVault = new Vault({ backend: storageBackend, masterKey });
        await setupVault.open();
        const mnemonicBytes = new TextEncoder().encode(MNEMONIC);
        const { encryptedSeed } = await encryptWalletSeed({
            seed: mnemonicBytes,
            kdfParams: KDF_PARAMS,
            masterKey,
        });
        const wallet = createWalletRecord({
            name: 'Main Wallet',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed,
            kdfParams: KDF_PARAMS,
        });
        await setupVault.wallets.put(wallet);
        const { encryptedSeed: otherEncryptedSeed } = await encryptWalletSeed({
            seed: mnemonicBytes,
            kdfParams: OTHER_KDF_PARAMS,
            masterKey: otherKey,
        });
        const independentlySealedWallet = createWalletRecord({
            name: 'Imported Wallet',
            origin: 'imported-mnemonic',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: otherEncryptedSeed,
            kdfParams: OTHER_KDF_PARAMS,
        });
        await setupVault.wallets.put(independentlySealedWallet);
        mnemonicBytes.fill(0);
        setupVault.close();

        const runtime = createRuntime({
            storageBackend,
            sessionBackend: memoryBackend(masterKey),
            metaBackend: {
                load: async () => ({ kdfParams: KDF_PARAMS }),
                save: async () => {},
                clear: async () => {},
            },
            chainRegistry: new ChainRegistry(),
            sdkRegistry: {},
        });

        await ensureHost(runtime);

        expect(runtime.signerPool.has(wallet.id)).toBe(true);
        expect(await runtime.signerPool.get(wallet.id).getStatus()).toBe('available');
        expect(runtime.signerPool.has(independentlySealedWallet.id)).toBe(false);

        tearDownHost(runtime);
        masterKey.fill(0);
        otherKey.fill(0);
    });
});
