// submitAction — convenience wrapper that chains unlockWallet +
// submitWithSigner + signer.lock() for the common "send this one
// action" path. Every UI surface that builds a single transaction (send
// form, sign-dApp-request screen, dispenser purchase, etc.) uses this.
//
// For batched submissions under one unlock, use unlockWallet +
// submitWithSigner directly — re-unlocking is expensive (Argon2id).

import { unlockWallet } from './unlockWallet.js';
import { submitWithSigner } from '../sdk/submitWithSigner.js';

/**
 * @typedef {Object} SubmitActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {{ action: string, params: object }} actionData
 * @property {import('../sdk/submitWithSigner.js').SubmitEncoderOpts} encoderOpts
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 */

/**
 * @param {SubmitActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function submitAction({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
    chainId,
    actionData,
    encoderOpts,
    signingPaths,
    waitForTxid,
    waitOpts,
    onProgress,
}) {
    const signer = await unlockWallet({
        vault,
        walletId,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });
    try {
        return await submitWithSigner({
            sdkRegistry,
            chainId,
            actionData,
            encoderOpts,
            signer,
            signingPaths,
            waitForTxid,
            waitOpts,
            onProgress,
        });
    } finally {
        signer.lock();
    }
}
