// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Standalone user-initiated sign flows (§30.1, §30.4).
//
// `signMessageFlow` signs an arbitrary message with the key at a given
// address (user wants to prove ownership, produce a Sign-in challenge
// manually, etc.).
//
// `signPsbtFlow` signs a caller-supplied PSBT with keys at the given
// signing paths. Used by the PSBT paste-in flow and by air-gapped
// PSBT-QR signer mode (§20).
//
// Both wrap unlockWallet + the corresponding Signer method with a
// guaranteed lock in `finally`.

import { unlockWallet } from './unlockWallet.js';
import { assertSigningAllowed } from './panicMode.js';

/**
 * @typedef {Object} SignMessageFlowOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                    required for software-wallet signing; skipped when `signer` is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [path]        BIP32 path (HD key)
 * @property {string} [addressId]   Address record id (imported-WIF key)
 * @property {string} message
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-built signer (pooled SoftwareSigner for an unlocked session, or RemoteSigner for HW). When supplied, the flow skips unlockWallet (no password KDF) and does not call `.lock()` (signer lifecycle is the caller's responsibility).
 */

/**
 * @param {SignMessageFlowOpts} opts
 * @returns {Promise<{ signature: string }>}
 */
export async function signMessageFlow({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    chainId,
    path,
    addressId,
    message,
    signer: injectedSigner,
}) {
    if (!vault) throw new Error('signMessageFlow: vault is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('signMessageFlow: chainId is required');
    }
    const hasPath = typeof path === 'string' && path.startsWith('m/');
    const hasAddressId = typeof addressId === 'string' && addressId.length > 0;
    if (hasPath === hasAddressId) {
        throw new Error(
            'signMessageFlow: supply exactly one of `path` (BIP32) or `addressId` (imported-WIF)',
        );
    }
    if (typeof message !== 'string') {
        throw new Error('signMessageFlow: message must be a string');
    }
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('signMessageFlow: either `password` or `signer` is required');
    }
    // §26.5 panic-mode freeze.
    assertSigningAllowed();
    const signer = injectedSigner
        || await unlockWallet({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    try {
        return await signer.signMessage({ message, chainId, path, addressId });
    } finally {
        if (!injectedSigner && typeof signer.lock === 'function') {
            signer.lock();
        }
    }
}

/**
 * @typedef {Object} SignPsbtFlowOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                    required for software-wallet signing; skipped when `signer` is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} psbtHex
 * @property {import('../signers/Signer.js').SigningPathEntry[]} signingPaths
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-built signer (RemoteSigner for HW). When supplied, the flow skips unlockWallet (no password KDF) and does not call `.lock()` at the end (signer lifecycle is the caller's responsibility).
 */

/**
 * @param {SignPsbtFlowOpts} opts
 * @returns {Promise<{ signedPsbtHex: string, txHex: string, txid: string }>}
 */
export async function signPsbtFlow({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    chainId,
    psbtHex,
    signingPaths,
    signer: injectedSigner,
}) {
    if (!vault) throw new Error('signPsbtFlow: vault is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('signPsbtFlow: chainId is required');
    }
    if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
        throw new Error('signPsbtFlow: psbtHex is required');
    }
    if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
        throw new Error('signPsbtFlow: signingPaths must be a non-empty array');
    }
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('signPsbtFlow: either `password` or `signer` is required');
    }
    // §26.5 panic-mode freeze.
    assertSigningAllowed();
    const signer = injectedSigner
        || await unlockWallet({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    try {
        return await signer.signPsbt({ psbtHex, chainId, signingPaths });
    } finally {
        if (!injectedSigner && typeof signer.lock === 'function') {
            signer.lock();
        }
    }
}
