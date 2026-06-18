// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet encrypted blob: pairs the KDF and AEAD primitives with the
// Wallet schema's kdfParams + encryptedSeed fields (§11.3.1, §11.4).
//
// The plaintext protected here is the user's BIP39 seed. Imported WIFs
// use the same master key but are stored under Wallet.importedKeys with
// per-entry ciphertext (see §15.5 and the TODO at the bottom of this
// file).

import { decrypt, encrypt } from './aead.js';
import {
    deriveMasterKey,
    makeFreshKdfParams,
    bytesToBase64,
    base64ToBytes,
} from './kdf.js';

/**
 * Encrypt a seed under a user-supplied password. Returns the fields the
 * Wallet record stores verbatim.
 *
 * @param {Object} input
 * @param {string} input.password
 * @param {Uint8Array} input.seed
 * @param {import('./kdf.js').KdfParams} [input.kdfParams]  override (e.g. calibrated)
 * @param {Uint8Array} [input.aad]                          extra authenticated data
 * @returns {Promise<{ encryptedSeed: string, kdfParams: import('./kdf.js').KdfParams }>}
 */
export async function encryptWalletSeed({ password, seed, kdfParams, aad }) {
    const params = kdfParams ?? makeFreshKdfParams();
    const masterKey = deriveMasterKey(password, params);
    try {
        const blob = await encrypt(masterKey, seed, aad);
        return { encryptedSeed: bytesToBase64(blob), kdfParams: params };
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Decrypt a seed from a Wallet record's fields.
 *
 * @param {Object} input
 * @param {string} input.password
 * @param {string} input.encryptedSeed
 * @param {import('./kdf.js').KdfParams} input.kdfParams
 * @param {Uint8Array} [input.aad]
 * @returns {Promise<Uint8Array>}
 */
export async function decryptWalletSeed({ password, encryptedSeed, kdfParams, aad }) {
    const masterKey = deriveMasterKey(password, kdfParams);
    try {
        const blob = base64ToBytes(encryptedSeed);
        return await decrypt(masterKey, blob, aad);
    } finally {
        masterKey.fill(0);
    }
}
