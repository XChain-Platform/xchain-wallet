// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BIP39 mnemonic helpers — §15.1 primary wallet format.
//
// The wallet only generates BIP39 mnemonics. Legacy Counterwallet
// mnemonics (§15.2) are import-only and live in counterwallet.js.

import {
    entropyToMnemonic,
    generateMnemonic,
    mnemonicToEntropy,
    mnemonicToSeed,
    mnemonicToSeedSync,
    validateMnemonic,
} from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';

// Entropy strengths in bits → word counts: 128 → 12, 160 → 15, 192 → 18,
// 224 → 21, 256 → 24. Default 128 (12 words) matches consumer wallets;
// users who want 24 words can opt in.
export const BIP39_DEFAULT_STRENGTH_BITS = 128;

/**
 * Generate a new BIP39 mnemonic.
 * @param {number} [strengthBits]
 * @returns {string} space-separated words
 */
export function generateBip39Mnemonic(strengthBits = BIP39_DEFAULT_STRENGTH_BITS) {
    return generateMnemonic(englishWordlist, strengthBits);
}

/** @param {string} mnemonic */
export function isValidBip39Mnemonic(mnemonic) {
    return validateMnemonic(mnemonic, englishWordlist);
}

/**
 * Convert a mnemonic to a seed, applying the optional BIP39 passphrase
 * (the "25th word") per §15.6.
 *
 * @param {string} mnemonic
 * @param {string} [passphrase]   default ''
 * @returns {Promise<Uint8Array>} 64-byte seed
 */
export function bip39MnemonicToSeed(mnemonic, passphrase = '') {
    if (!isValidBip39Mnemonic(mnemonic)) {
        throw new Error('bip39: invalid mnemonic');
    }
    return mnemonicToSeed(mnemonic, passphrase);
}

/**
 * Synchronous variant. Use only in contexts where async doesn't work
 * (rare in the wallet). Prefer the async form.
 *
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {Uint8Array}
 */
export function bip39MnemonicToSeedSync(mnemonic, passphrase = '') {
    if (!isValidBip39Mnemonic(mnemonic)) {
        throw new Error('bip39: invalid mnemonic');
    }
    return mnemonicToSeedSync(mnemonic, passphrase);
}

/**
 * Round-trip: entropy bytes ↔ mnemonic words. Used for backup export
 * (showing raw entropy to a user who understands what it means, or
 * passing entropy to external tools).
 *
 * @param {Uint8Array} entropy
 * @returns {string}
 */
export function entropyToBip39Mnemonic(entropy) {
    return entropyToMnemonic(entropy, englishWordlist);
}

/**
 * @param {string} mnemonic
 * @returns {Uint8Array}
 */
export function bip39MnemonicToEntropy(mnemonic) {
    return mnemonicToEntropy(mnemonic, englishWordlist);
}

export { englishWordlist };
