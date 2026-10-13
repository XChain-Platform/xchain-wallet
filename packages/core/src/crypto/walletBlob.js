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
// file). The optional BIP39 passphrase (§15.6) is a third plaintext,
// sealed under the same master key but with its own AAD.

import { decrypt, encrypt } from './aead.js';
import {
    copyMasterKey,
    deriveMasterKey,
    makeFreshKdfParams,
    bytesToBase64,
    base64ToBytes,
} from './kdf.js';

// Domain separator for the passphrase blob. The seed blob carries no AAD,
// so without this a passphrase ciphertext and a seed ciphertext would be
// interchangeable under the same master key: GCM authenticates the AAD in
// both directions, so tagging one side is enough to make the swap fail.
export const PASSPHRASE_AAD = new TextEncoder().encode('xchain-wallet:bip39-passphrase:v1');

/**
 * Encrypt a seed under a user-supplied password. Returns the fields the
 * Wallet record stores verbatim.
 *
 * @param {Object} input
 * @param {string} input.password
 * @param {Uint8Array} input.seed
 * @param {import('./kdf.js').KdfParams} [input.kdfParams]  override (e.g. calibrated)
 * @param {Uint8Array} [input.aad]                          extra authenticated data
 * @param {Uint8Array} [input.masterKey]                    already-derived key for these kdfParams, used instead of deriving from the password; copied on receipt, the copy is zeroed here, the caller zeroes its own buffer
 * @returns {Promise<{ encryptedSeed: string, kdfParams: import('./kdf.js').KdfParams }>}
 */
export async function encryptWalletSeed({ password, seed, kdfParams, aad, masterKey }) {
    // A supplied key belongs to the params it was derived with; minting
    // fresh params beside it would store a record no password opens.
    if (masterKey !== undefined && kdfParams === undefined) {
        throw new Error('encryptWalletSeed: a supplied masterKey needs the kdfParams it was derived with');
    }
    const params = kdfParams ?? makeFreshKdfParams();
    const workingKey = masterKey === undefined
        ? deriveMasterKey(password, params)
        : copyMasterKey(masterKey);
    try {
        const blob = await encrypt(workingKey, seed, aad);
        return { encryptedSeed: bytesToBase64(blob), kdfParams: params };
    } finally {
        workingKey.fill(0);
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
 * @param {Uint8Array} [input.masterKey]       already-derived key, used instead of deriving from the password; copied on receipt, the copy is zeroed here, the caller zeroes its own buffer. The AEAD check still runs, so a wrong key fails as a wrong password does
 * @param {(key: Uint8Array) => void} [input.retainMasterKey] receives its own key copy and owns zeroing it
 * @returns {Promise<Uint8Array>}
 */
export async function decryptWalletSeed({
    password,
    encryptedSeed,
    kdfParams,
    aad,
    masterKey,
    retainMasterKey,
}) {
    const workingKey = masterKey === undefined
        ? deriveMasterKey(password, kdfParams)
        : copyMasterKey(masterKey);
    try {
        const blob = base64ToBytes(encryptedSeed);
        const plaintext = await decrypt(workingKey, blob, aad);
        // Session retention (§15.5 password-less WIF import): hand the
        // caller its own copy of the derived key instead of re-running
        // the KDF. The caller owns zeroing it.
        if (typeof retainMasterKey === 'function') retainMasterKey(new Uint8Array(workingKey));
        return plaintext;
    } finally {
        workingKey.fill(0);
    }
}

/**
 * Seal a BIP39 passphrase under a wallet's already-derived master key
 * (§15.6). Takes the key rather than the password because every caller
 * is holding one: the create/import path and the unlock path both have
 * `signer.getMasterKey()` in hand, and re-deriving would cost a second
 * Argon2id round for no benefit.
 *
 * The key is NOT zeroed here. It belongs to the signer, which zeroes it
 * in place at `lock()`; a caller that cleared it would break the session.
 *
 * @param {Object} input
 * @param {Uint8Array} input.masterKey  32 bytes, owned by the caller
 * @param {string} input.passphrase     UTF-8, non-empty
 * @returns {Promise<string>} base64 ciphertext for Wallet.encryptedPassphrase
 */
export async function encryptWalletPassphrase({ masterKey, passphrase }) {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
        throw new Error('encryptWalletPassphrase: passphrase must be a non-empty string');
    }
    const bytes = new TextEncoder().encode(passphrase);
    try {
        const blob = await encrypt(masterKey, bytes, PASSPHRASE_AAD);
        return bytesToBase64(blob);
    } finally {
        bytes.fill(0);
    }
}

/**
 * Open a passphrase blob written by `encryptWalletPassphrase`. Throws on
 * auth failure, which includes being handed a seed blob by mistake.
 *
 * Returns BYTES, not a string: the caller decodes for the one derivation
 * call it needs and zeroes these in a `finally`. A JS string cannot be
 * zeroed (§17.7.3), so the byte form is the part we can actually clear.
 *
 * @param {Object} input
 * @param {Uint8Array} input.masterKey        32 bytes, owned by the caller
 * @param {string} input.encryptedPassphrase  base64, as stored
 * @returns {Promise<Uint8Array>} UTF-8 passphrase bytes; caller zeroes them
 */
export async function decryptWalletPassphrase({ masterKey, encryptedPassphrase }) {
    const blob = base64ToBytes(encryptedPassphrase);
    return decrypt(masterKey, blob, PASSPHRASE_AAD);
}
