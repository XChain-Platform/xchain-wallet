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
// address, except for the reserved sign-in challenge format.
//
// `signPsbtFlow` signs a caller-supplied PSBT with keys at the given
// signing paths. Used by the PSBT paste-in flow and by air-gapped
// PSBT-QR signer mode (§20).
//
// Both wrap unlockWallet + the corresponding Signer method with a
// guaranteed lock in `finally`.

import { unlockWallet } from './unlockWallet.js';
import { hardwareWalletRecord, refuseHardwareWallet } from './hardwareWallet.js';
import { assertSigningAllowed } from './panicMode.js';
import { assertNoDeceptiveCharacters, assertNoHiddenControls } from './signRiskClassifier.js';
import {
    parseSignInChallenge,
    SIGN_IN_CHALLENGE_PREFIX,
} from '@dankest-llc/xchain-connect';

export { SIGN_IN_CHALLENGE_PREFIX };

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
 * @property {string} [addressType] Script type recorded for the signing address
 * @property {string} message
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-built signer (pooled SoftwareSigner for an unlocked session, or RemoteSigner for HW). When supplied, the flow skips unlockWallet (no password KDF) and does not call `.lock()` (signer lifecycle is the caller's responsibility).
 */

/**
 * @param {SignMessageFlowOpts} opts
 * @returns {Promise<{ signature: string }>}
 */
export async function signMessageFlow(opts) {
    if (typeof opts?.message === 'string' && opts.message.startsWith(SIGN_IN_CHALLENGE_PREFIX)) {
        throw new Error('signMessageFlow: sign-in challenges cannot be signed as arbitrary messages');
    }
    return signMessageInternal(opts, 'signMessageFlow');
}

/**
 * Sign a v2 challenge assembled by the trusted sign-in bridge handler.
 * This separate entry point cannot weaken arbitrary message signing: it accepts
 * only bytes the shared bridge-spec parser recognizes as a v2 challenge.
 *
 * @param {SignMessageFlowOpts} opts
 * @returns {Promise<{ signature: string }>}
 */
export async function signSignInChallengeFlow(opts) {
    if (typeof opts?.message !== 'string' || parseSignInChallenge(opts.message) === null) {
        throw new Error('signSignInChallengeFlow: message must be a valid v2 sign-in challenge');
    }
    return signMessageInternal(opts, 'signSignInChallengeFlow');
}

/**
 * @param {SignMessageFlowOpts} opts
 * @param {string} flowName
 * @returns {Promise<{ signature: string }>}
 */
async function signMessageInternal({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    chainId,
    path,
    addressId,
    addressType,
    message,
    signer: injectedSigner,
}, flowName) {
    if (!vault) throw new Error(`${flowName}: vault is required`);
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error(`${flowName}: chainId is required`);
    }
    const hasPath = typeof path === 'string' && path.startsWith('m/');
    const hasAddressId = typeof addressId === 'string' && addressId.length > 0;
    if (hasPath === hasAddressId) {
        throw new Error(
            `${flowName}: supply exactly one of \`path\` (BIP32) or \`addressId\` (imported-WIF)`,
        );
    }
    if (typeof message !== 'string') {
        throw new Error(`${flowName}: message must be a string`);
    }
    // Refuse text whose visual form can conceal the bytes the signer receives.
    assertNoDeceptiveCharacters({ chainId, path, addressId, message }, flowName);
    assertNoHiddenControls(message, flowName);
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        // A hardware wallet signs only on its device; no password helps.
        refuseHardwareWallet(await hardwareWalletRecord(vault, walletId), 'signing without it connected');
        throw new Error(`${flowName}: either \`password\` or \`signer\` is required`);
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
        return await signer.signMessage({ message, chainId, path, addressId, addressType });
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
    // Refuse text whose visual form can conceal the bytes the signer receives.
    assertNoDeceptiveCharacters({ chainId, psbtHex, signingPaths }, 'signPsbtFlow');
    if (!injectedSigner && (typeof password !== 'string' || password.length === 0)) {
        // A hardware wallet signs only on its device; no password helps.
        refuseHardwareWallet(await hardwareWalletRecord(vault, walletId), 'signing without it connected');
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
