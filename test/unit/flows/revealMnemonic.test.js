// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// revealMnemonic (§19.3), extended for the §15.6 stored 25th-word
// passphrase: the same password gate that decrypts the seed also
// decrypts the stored passphrase, using the master key retained from
// that one KDF round rather than paying a second derivation.

import { describe, it, expect } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { revealMnemonic, NoMnemonicForWifOnlyError } from '../../../packages/core/src/flows/revealMnemonic.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';
import { encryptWalletSeed, encryptWalletPassphrase } from '../../../packages/core/src/crypto/walletBlob.js';
import { deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';

// password -> KDF -> AES-256-GCM: every case pays a real Argon2id derivation.
import { vi } from 'vitest';
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const PASSWORD = 'correct horse battery staple';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

function fakeVault(wallet) {
    return { wallets: { get: async (id) => (id === wallet.id ? wallet : null) } };
}

async function bip39Wallet({ passphraseEnabled = false, storedPassphrase = null } = {}) {
    const seed = new TextEncoder().encode(MNEMONIC);
    const { encryptedSeed, kdfParams } = await encryptWalletSeed({
        password: PASSWORD,
        seed,
        kdfParams: KDF_PARAMS,
    });
    let encryptedPassphrase = null;
    if (storedPassphrase) {
        const masterKey = deriveMasterKey(PASSWORD, kdfParams);
        encryptedPassphrase = await encryptWalletPassphrase({ masterKey, passphrase: storedPassphrase });
        masterKey.fill(0);
    }
    return {
        id: 'w1',
        name: 'Cold',
        format: 'bip39',
        passphraseEnabled,
        encryptedSeed,
        kdfParams,
        encryptedPassphrase,
        importedKeys: [],
    };
}

describe('flows/revealMnemonic', () => {
    it('returns the mnemonic, format and passphraseEnabled for a plain wallet', async () => {
        const wallet = await bip39Wallet();
        const r = await revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD });
        expect(r.mnemonic).toBe(MNEMONIC);
        expect(r.format).toBe('bip39');
        expect(r.passphraseEnabled).toBe(false);
    });

    it('returns bip39Passphrase null for a wallet with no passphrase at all', async () => {
        const wallet = await bip39Wallet({ passphraseEnabled: false });
        const r = await revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD });
        expect(r.bip39Passphrase).toBeNull();
    });

    it('returns bip39Passphrase null for a legacy wallet awaiting one-time capture', async () => {
        // passphraseEnabled true, encryptedPassphrase still null: the
        // legacy, awaiting-capture state from the schema's three-state table.
        const wallet = await bip39Wallet({ passphraseEnabled: true, storedPassphrase: null });
        const r = await revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD });
        expect(r.passphraseEnabled).toBe(true);
        expect(r.bip39Passphrase).toBeNull();
        // The mnemonic itself must still come through untouched.
        expect(r.mnemonic).toBe(MNEMONIC);
    });

    it('decrypts and returns the stored passphrase as a string', async () => {
        const wallet = await bip39Wallet({ passphraseEnabled: true, storedPassphrase: 'my 25th word' });
        const r = await revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD });
        expect(r.passphraseEnabled).toBe(true);
        expect(typeof r.bip39Passphrase).toBe('string');
        expect(r.bip39Passphrase).toBe('my 25th word');
        // The seed decrypt itself must be unaffected by the extra decrypt.
        expect(r.mnemonic).toBe(MNEMONIC);
    });

    it('round-trips a non-ASCII stored passphrase', async () => {
        const pass = 'pässwörd 🔑 日本語';
        const wallet = await bip39Wallet({ passphraseEnabled: true, storedPassphrase: pass });
        const r = await revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD });
        expect(r.bip39Passphrase).toBe(pass);
    });

    it('rejects with the wrong wallet password before any passphrase decrypt happens', async () => {
        const wallet = await bip39Wallet({ passphraseEnabled: true, storedPassphrase: 'secret' });
        await expect(
            revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: 'wrong password' }),
        ).rejects.toThrow();
    });

    it('still throws NoMnemonicForWifOnlyError for a wif-only wallet, never touching passphrase logic', async () => {
        const wallet = { id: 'w2', name: 'WIF', format: 'wif-only', passphraseEnabled: false, importedKeys: [] };
        await expect(
            revealMnemonic({ vault: fakeVault(wallet), walletId: wallet.id, password: PASSWORD }),
        ).rejects.toBeInstanceOf(NoMnemonicForWifOnlyError);
    });

    it('throws WalletNotFoundError for an unknown walletId', async () => {
        const wallet = await bip39Wallet();
        await expect(
            revealMnemonic({ vault: fakeVault(wallet), walletId: 'does-not-exist', password: PASSWORD }),
        ).rejects.toBeInstanceOf(WalletNotFoundError);
    });
});
