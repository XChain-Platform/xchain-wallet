// Standalone user-initiated sign flows — §30.1, §30.4.
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

/**
 * @typedef {Object} SignMessageFlowOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} path                                    BIP32 path of the signing key
 * @property {string} message
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
    message,
}) {
    if (!vault) throw new Error('signMessageFlow: vault is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('signMessageFlow: chainId is required');
    }
    if (typeof path !== 'string' || !path.startsWith('m/')) {
        throw new Error('signMessageFlow: path must be a BIP32 path string');
    }
    if (typeof message !== 'string') {
        throw new Error('signMessageFlow: message must be a string');
    }
    const signer = await unlockWallet({
        vault,
        walletId,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });
    try {
        return await signer.signMessage({ message, chainId, path });
    } finally {
        signer.lock();
    }
}

/**
 * @typedef {Object} SignPsbtFlowOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} psbtHex
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
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
    const signer = await unlockWallet({
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
        signer.lock();
    }
}
