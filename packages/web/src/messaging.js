// Popup-parity messaging helpers, targeting the in-page host instead of
// chrome.runtime. Each helper's signature matches the popup's
// `packages/extension/src/popup/messaging.js` — keeps shared route
// layouts (once extracted) swap-compatible across shells.

import {
    sendMessage,
    getSessionStatus,
    unlockWalletLocal,
    lockWalletLocal,
    createWalletLocal,
    importMnemonicLocal,
} from './hostBridge.js';

export { sendMessage, getSessionStatus };

/** @param {string} password */
export function unlockWallet(password) {
    return unlockWalletLocal({ password });
}

export function lockWallet() {
    return lockWalletLocal();
}

/**
 * Create a fresh BIP39 wallet + unlock. Returns the plaintext mnemonic
 * so the UI can display the §19.2 seed-phrase ceremony screen.
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} [opts.name]
 * @param {128 | 160 | 192 | 224 | 256} [opts.strengthBits]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<{ mnemonic: string, walletName: string }>}
 */
export function createWallet(opts) {
    return createWalletLocal(opts);
}

/**
 * Import an existing mnemonic (BIP39 or Counterwallet-legacy).
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} opts.mnemonic
 * @param {string} [opts.name]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<{ format: 'bip39' | 'counterwallet-legacy', walletName: string }>}
 */
export function importMnemonic(opts) {
    return importMnemonicLocal(opts);
}

export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/** @param {string} walletId */
export function getWalletBalances(walletId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId }));
}

/** @param {string} walletId */
export function getAddressesByChain(walletId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId }));
}

/** @param {string} walletId @param {string} chainId */
export function getNewestAddress(walletId, chainId) {
    return /** @type {any} */ (sendMessage('addresses.newest', { walletId, chainId }));
}

/**
 * Build, sign, and broadcast a SEND action via the host's `action.send`
 * handler. Pass-through to core's `sendAsset` flow — fails loudly
 * against the dev-SDK stub until real xchain-sdk is bundled.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.to
 * @param {string} opts.asset
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function sendAsset(opts) {
    return /** @type {any} */ (sendMessage('action.send', opts));
}

/**
 * Build, sign, and broadcast an ISSUE action — creates or updates a
 * token on the XChain protocol. See popup messaging.js for prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function issueToken(opts) {
    return /** @type {any} */ (sendMessage('action.issue', opts));
}

/**
 * Build, sign, and broadcast a MINT action. See popup messaging.js for
 * prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function mintAsset(opts) {
    return /** @type {any} */ (sendMessage('action.mint', opts));
}

/**
 * Build, sign, and broadcast a DESTROY action. See popup messaging.js
 * for prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function destroyAsset(opts) {
    return /** @type {any} */ (sendMessage('action.destroy', opts));
}

/**
 * Build, sign, and broadcast a BROADCAST action. See popup messaging.js
 * for prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function broadcastAction(opts) {
    return /** @type {any} */ (sendMessage('action.broadcast', opts));
}

/**
 * Persist a paired hardware signer (§17.6 / §18.3). See popup
 * messaging.js for prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function registerSigner(opts) {
    return /** @type {any} */ (sendMessage('signer.register', opts));
}

/** @param {string} walletId */
export function listSigners(walletId) {
    return /** @type {any} */ (sendMessage('signer.list', { walletId }));
}

/** @param {string} signerId */
export function unregisterSigner(signerId) {
    return /** @type {any} */ (sendMessage('signer.unregister', { signerId }));
}

/**
 * Export the WIF for an address (§17.7). See popup messaging.js for
 * prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
export function exportPrivateKey(opts) {
    return /** @type {any} */ (sendMessage('wallet.exportPrivateKey', opts));
}

/**
 * Derive + persist the next unused external address for (wallet, chain).
 * Requires the user's password because the signer re-derives the HD
 * key material; the vault-level unlock doesn't cover the per-wallet
 * seed decryption (§26 — password-never-stored posture).
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.password
 * @param {string} [opts.bip39Passphrase]
 * @param {string} [opts.addressType]
 * @returns {Promise<{ id: string, address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}
