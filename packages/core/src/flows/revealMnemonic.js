// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// revealMnemonic (§19.3). Decrypts the wallet's encrypted seed blob
// and returns the BIP39 (or Counterwallet-legacy) mnemonic string. The
// shell UI is responsible for the user-facing guardrails: tap-to-reveal,
// auto-hide on blur, no clipboard write, mandatory password every time.
// This flow is the pure primitive.
//
// The returned mnemonic is a single UTF-8 string ready for display
// (12–24 space-separated words for BIP39; 12 words for Counterwallet
// legacy; both formats are handled identically downstream).
//
// Wif-only wallets throw `NoMnemonicForWifOnlyError` because by definition
// they have no mnemonic to reveal.

import { decryptWalletSeed } from '../crypto/walletBlob.js';
import { WalletNotFoundError } from './unlockWallet.js';

export class NoMnemonicForWifOnlyError extends Error {
    constructor() {
        super('revealMnemonic: wif-only wallets have no mnemonic to reveal');
        this.name = 'NoMnemonicForWifOnlyError';
    }
}

/**
 * @typedef {Object} RevealMnemonicOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 */

/**
 * @typedef {Object} RevealMnemonicResult
 * @property {string} mnemonic    UTF-8 string; 12 / 15 / 18 / 21 / 24 words for BIP39
 * @property {'bip39' | 'counterwallet-legacy'} format
 * @property {boolean} passphraseEnabled  whether the user also entered a 25th-word at create-time
 */

/**
 * @param {RevealMnemonicOpts} opts
 * @returns {Promise<RevealMnemonicResult>}
 */
export async function revealMnemonic({ vault, walletId, password }) {
    if (!vault) throw new Error('revealMnemonic: vault is required');
    if (typeof walletId !== 'string' || !walletId) {
        throw new Error('revealMnemonic: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('revealMnemonic: password is required');
    }
    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    const format = wallet.format ?? 'bip39';
    if (format === 'wif-only') {
        throw new NoMnemonicForWifOnlyError();
    }
    const plaintext = await decryptWalletSeed({
        password,
        encryptedSeed: wallet.encryptedSeed,
        kdfParams: wallet.kdfParams,
        aad: wallet.aad,
    });
    try {
        const mnemonic = new TextDecoder().decode(plaintext);
        return {
            mnemonic,
            format,
            passphraseEnabled: Boolean(wallet.passphraseEnabled),
        };
    } finally {
        plaintext.fill(0);
    }
}
