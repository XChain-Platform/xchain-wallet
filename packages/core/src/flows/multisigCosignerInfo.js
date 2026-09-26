// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// multisigCosignerInfo: the public key material one of this wallet's
// addresses contributes as a §22.2 multisig cosigner. Create multisig
// auto-fills the local cosigner row from it, and "Share as cosigner"
// shows it so the other party can paste it in as an external cosigner.
//
// Everything returned is public: master fingerprint, account xpub,
// derivation path and one compressed pubkey. No private key leaves the
// signer, and the flow never takes a password.

import { accountPathOf } from './pairPartner.js';

/**
 * @typedef {Object} CosignerInfo
 * @property {string} fingerprint      BIP32 master key fingerprint, 8 lowercase hex chars
 * @property {string} derivationPath   full path of the cosigner key, e.g. "m/84'/1'/0'/0/0"
 * @property {string} accountPath      hardened account prefix of derivationPath
 * @property {string | null} xpub      extended public key at accountPath; null when the signer cannot produce one
 * @property {string} pubkey           compressed pubkey hex at derivationPath
 */

/**
 * Read the cosigner fields for one derivation path from an unlocked signer.
 *
 * @param {object} opts
 * @param {{ getPublicKey: Function, getMasterFingerprint?: Function, getAccountXpub?: Function }} opts.signer
 * @param {string} opts.derivationPath
 * @param {string} [opts.expectedPubkey]   the address record's stored pubkey; a mismatch means the signer holds a different seed
 * @returns {Promise<CosignerInfo>}
 */
export async function deriveCosignerKeys({ signer, derivationPath, expectedPubkey }) {
    // The signer must be unlocked and able to derive public keys.
    if (!signer || typeof signer.getPublicKey !== 'function') {
        throw new Error('multisigCosignerInfo: an unlocked signer is required');
    }
    // Only an HD path has a master key behind it to fingerprint.
    if (typeof derivationPath !== 'string' || !derivationPath.startsWith('m/')) {
        throw new Error('multisigCosignerInfo: this address has no HD derivation path, so it has no master fingerprint');
    }
    // Hardware signers expose their fingerprint through the device, not here.
    if (typeof signer.getMasterFingerprint !== 'function') {
        throw new Error('multisigCosignerInfo: this signer cannot report its master fingerprint; read it from the device and enter it by hand');
    }

    const { publicKey } = await signer.getPublicKey({ path: derivationPath });
    const pubkey = String(publicKey).toLowerCase();
    // A different seed (wrong passphrase, or a hardware-held address) would
    // yield a fingerprint that does not own this address's key.
    if (typeof expectedPubkey === 'string' && expectedPubkey.length > 0
        && expectedPubkey.toLowerCase() !== pubkey) {
        throw new Error('multisigCosignerInfo: this address\'s key is not held by the unlocked seed (a hardware-signer address, or a different passphrase)');
    }

    const fingerprint = String(await signer.getMasterFingerprint()).toLowerCase();
    // A fingerprint is exactly 4 bytes; anything else would fail the create form.
    if (!/^[0-9a-f]{8}$/.test(fingerprint)) {
        throw new Error(`multisigCosignerInfo: signer returned a malformed fingerprint "${fingerprint}"`);
    }

    const accountPath = accountPathOf(derivationPath);
    const xpub = typeof signer.getAccountXpub === 'function'
        ? await signer.getAccountXpub({ path: accountPath })
        : null;

    return {
        fingerprint,
        derivationPath,
        accountPath,
        xpub: typeof xpub === 'string' && xpub.length > 0 ? xpub : null,
        pubkey,
    };
}

/**
 * Resolve one of the wallet's own addresses and read its cosigner fields.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.walletId
 * @param {string} opts.addressId
 * @param {object} opts.signer        the wallet's unlocked signer
 * @returns {Promise<CosignerInfo & { addressId: string, address: string }>}
 */
export async function getMultisigCosignerInfo({ vault, walletId, addressId, signer }) {
    // Every input is required; the route has no defaults to fall back on.
    if (!vault) throw new Error('multisigCosignerInfo: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('multisigCosignerInfo: walletId is required');
    }
    if (typeof addressId !== 'string' || addressId.length === 0) {
        throw new Error('multisigCosignerInfo: addressId is required');
    }

    const address = await vault.addresses.get(addressId);
    if (!address) throw new Error(`multisigCosignerInfo: address "${addressId}" not found`);
    // The address must belong to an account of this wallet, never another one.
    const account = address.accountId ? await vault.accounts.get(address.accountId) : null;
    if (!account || account.walletId !== walletId) {
        throw new Error('multisigCosignerInfo: that address does not belong to this wallet');
    }
    // An imported key or watch-only address has no seed behind it.
    if (address.source !== 'hd') {
        throw new Error('multisigCosignerInfo: an imported or watch-only address has no master fingerprint; pick an address this wallet derived');
    }

    const info = await deriveCosignerKeys({
        signer,
        derivationPath: address.derivationPath,
        expectedPubkey: address.publicKey,
    });
    return { ...info, addressId: address.id, address: address.address };
}
