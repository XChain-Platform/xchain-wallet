// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6: the BIP39 passphrase is now captured once, at create/import time,
// instead of being typed at every unlock. `persistHdWallet` is the seam
// that captures it: it builds the Wallet record, unlocks it in memory via
// `unlockWalletRecord` (which is how it gets the master key), seals the
// typed passphrase under that key when one applies, and only THEN puts the
// record - one put, not two, so there is no window where the wallet is
// stored without its passphrase already sealed.
//
// These cases prove the wiring end to end with the real crypto and a real
// Vault, not with a stubbed signer: a passphrase wallet's stored blob
// really does decrypt back to the typed passphrase under a signer unlocked
// from the persisted record, a no-passphrase wallet stores null, and the
// wallets collection is written to exactly once per call.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { persistHdWallet } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';
import { decryptWalletPassphrase } from '../../../packages/core/src/crypto/walletBlob.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

// Every case here pays a real Argon2id derivation (mnemonic encrypt + at
// least one unlock), at a deliberately low test cost, not the production
// floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const VAULT_MASTER_KEY = new Uint8Array(32).fill(7);

// Below the production floor on purpose: what is under test is the
// put-ordering and passphrase wiring, not Argon2id's cost.
const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const REG = { chainRegistry: {}, sdkRegistry: {} };

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: VAULT_MASTER_KEY });
    await vault.open();
    return vault;
}

/**
 * @param {Object} overrides
 */
async function persist(vault, overrides = {}) {
    return persistHdWallet({
        mnemonic: generateBip39Mnemonic(128),
        format: 'bip39',
        origin: 'created',
        passphraseEnabled: false,
        password: 'correct-horse-battery-staple',
        name: 'Test Wallet',
        accountName: 'Main',
        kdfParams: LOW_COST_KDF_PARAMS,
        vault,
        chainRegistry: {},
        sdkRegistry: {},
        // Empty on purpose: address derivation across real chains is
        // covered elsewhere and is not part of this seam.
        activeChainIds: [],
        ...overrides,
    });
}

describe('flows/_persistHdWallet passphrase capture (§15.6)', () => {
    it('a passphrase wallet lands with a non-null encryptedPassphrase that decrypts back to the typed passphrase', async () => {
        const vault = await openVault();
        const passphrase = 'the fifth element';

        const { wallet } = await persist(vault, {
            passphraseEnabled: true,
            bip39Passphrase: passphrase,
        });

        expect(typeof wallet.encryptedPassphrase).toBe('string');
        expect(wallet.encryptedPassphrase.length).toBeGreaterThan(0);

        // Round-trip through a FRESH unlock of the persisted record (not
        // the signer used during persist, which is already locked and
        // zeroed) to prove the stored ciphertext really opens under this
        // wallet's own master key, the way a later unlock would use it.
        const signer = await unlockWalletRecord({
            wallet,
            password: 'correct-horse-battery-staple',
            ...REG,
        });
        try {
            const bytes = await decryptWalletPassphrase({
                masterKey: signer.getMasterKey(),
                encryptedPassphrase: wallet.encryptedPassphrase,
            });
            try {
                expect(new TextDecoder().decode(bytes)).toBe(passphrase);
            } finally {
                bytes.fill(0);
            }
        } finally {
            signer.lock();
        }
    });

    it('a no-passphrase wallet lands with encryptedPassphrase null', async () => {
        const vault = await openVault();

        const { wallet } = await persist(vault, {
            passphraseEnabled: false,
            bip39Passphrase: '',
        });

        expect(wallet.encryptedPassphrase).toBeNull();
    });

    it('puts the wallet record exactly once, whether or not a passphrase is captured', async () => {
        for (const passphraseEnabled of [true, false]) {
            const vault = await openVault();
            const putSpy = vi.spyOn(vault.wallets, 'put');

            await persist(vault, {
                passphraseEnabled,
                bip39Passphrase: passphraseEnabled ? 'a passphrase' : '',
            });

            expect(putSpy).toHaveBeenCalledTimes(1);
            putSpy.mockRestore();
        }
    });
});
