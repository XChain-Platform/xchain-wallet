// unlockWallet — fetch a persisted Wallet record, build a live
// SoftwareSigner against it, and unlock. The symmetric counterpart to
// createWallet (§15.3). Also exposes the lower-level primitive
// `unlockWalletRecord` that other flows reuse when they already hold
// the Wallet record in memory.
//
// Does NOT touch addresses — the caller is responsible for any address
// work after unlocking. Keeping this thin means it's usable from every
// shell that needs a signer.

import { SoftwareSigner } from '../signers/SoftwareSigner.js';

export class WalletNotFoundError extends Error {
    constructor(walletId) {
        super(`unlockWallet: no wallet with id "${walletId}"`);
        this.name = 'WalletNotFoundError';
        this.walletId = walletId;
    }
}

/**
 * @typedef {Object} UnlockRecordOpts
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 */

/**
 * Build a SoftwareSigner tied to an already-loaded Wallet record and
 * unlock it. Lower-level primitive — callers with a Wallet record in
 * hand (like `createWallet`) skip the vault lookup.
 *
 * @param {UnlockRecordOpts} opts
 * @returns {Promise<SoftwareSigner>}
 */
export async function unlockWalletRecord({
    wallet,
    password,
    bip39Passphrase = '',
    chainRegistry,
    sdkRegistry,
}) {
    if (!wallet) throw new Error('unlockWalletRecord: wallet is required');
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('unlockWalletRecord: password is required');
    }
    if (!chainRegistry) throw new Error('unlockWalletRecord: chainRegistry is required');

    const signer = new SoftwareSigner({
        id: wallet.id,
        displayName: wallet.name,
        chainRegistry,
        sdkRegistry,
        walletEncryption: {
            encryptedSeed: wallet.encryptedSeed,
            kdfParams: wallet.kdfParams,
            passphraseEnabled: wallet.passphraseEnabled,
            format: wallet.format,
        },
    });

    try {
        await signer.unlock({
            password,
            bip39Passphrase: wallet.passphraseEnabled ? bip39Passphrase : '',
        });
    } catch (e) {
        signer.lock();
        throw e;
    }

    return signer;
}

/**
 * @typedef {Object} UnlockWalletOpts
 * @property {import('../storage/Vault.js').Vault} vault        must be open
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 */

/**
 * Load a Wallet record from the vault and unlock it.
 *
 * @param {UnlockWalletOpts} opts
 * @returns {Promise<SoftwareSigner>}
 */
export async function unlockWallet({
    vault,
    walletId,
    password,
    bip39Passphrase,
    chainRegistry,
    sdkRegistry,
}) {
    if (!vault) throw new Error('unlockWallet: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('unlockWallet: walletId is required');
    }
    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    return unlockWalletRecord({
        wallet,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });
}
