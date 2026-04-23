// Popup-facing helpers layered on the shared chrome.runtime.sendMessage
// wrapper. Each helper documents the exact message type + request shape
// so callers don't need to build envelopes by hand.

import { sendMessage } from '../shared/chromeMessaging.js';

export { sendMessage };

/**
 * Read the background's view of the current wallet-session state.
 * Answered by the session-meta listener in background.js — works before
 * the MessageHost's vault-backed handlers come online.
 *
 * @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>}
 */
export function getSessionStatus() {
    return /** @type {any} */ (sendMessage('session.status'));
}

/**
 * Derive the vault master key from `password`, authenticate it by
 * opening the encrypted blob, seed the session backend, and trigger a
 * host re-init in the background. On wrong-password, rejects with an
 * error whose `name === 'InvalidPasswordError'`.
 *
 * @param {string} password
 * @returns {Promise<{ unlocked: true }>}
 */
export function unlockWallet(password) {
    return /** @type {any} */ (sendMessage('wallet.unlock', { password }));
}

/**
 * Create a fresh BIP39 wallet via the pre-host `wallet.create` handler.
 * Returns the plaintext mnemonic for the §19.2 seed-phrase ceremony.
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} [opts.name]
 * @param {128 | 160 | 192 | 224 | 256} [opts.strengthBits]
 * @param {string} [opts.bip39Passphrase]
 */
export function createWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.create', opts));
}

/**
 * Import an existing 12/15/18/21/24-word BIP39 mnemonic (or
 * Counterwallet-legacy 12-word; format auto-detected).
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} opts.mnemonic
 * @param {string} [opts.name]
 * @param {string} [opts.bip39Passphrase]
 */
export function importMnemonic(opts) {
    return /** @type {any} */ (sendMessage('wallet.import', opts));
}

/**
 * Clear the session master key and tear down the background host. Next
 * query of `session.status` returns `locked`.
 *
 * @returns {Promise<{ locked: true }>}
 */
export function lockWallet() {
    return /** @type {any} */ (sendMessage('wallet.lock'));
}

/**
 * List all persisted wallets, safe-projected (no encryptedSeed / kdfParams /
 * importedKeys). Populates the Home screen's wallet picker.
 *
 * @returns {Promise<Array<{ id: string, name: string, createdAt: string, origin: string, format: string, passphraseEnabled: boolean, multisig: boolean | null }>>}
 */
export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/**
 * Aggregate balances for a wallet, grouped by chainId. Per-address
 * entries carry `balances: null` + a `error` string when the SDK
 * read fails — the Home screen renders those as retry rows.
 *
 * @param {string} walletId
 * @returns {Promise<Record<string, Array<{ address: string, addressType: string, label: string, balances: unknown | null, error: string | null }>>>}
 */
export function getWalletBalances(walletId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId }));
}

/**
 * @param {string} walletId
 * @returns {Promise<Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null }>>>}
 */
export function getAddressesByChain(walletId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId }));
}

/**
 * Newest (highest external index) HD address for a wallet + chain, or
 * `null` if no address exists yet.
 *
 * @param {string} walletId
 * @param {string} chainId
 * @returns {Promise<null | { address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function getNewestAddress(walletId, chainId) {
    return /** @type {any} */ (
        sendMessage('addresses.newest', { walletId, chainId })
    );
}

/**
 * Derive + persist the next unused external address for (wallet, chain).
 * Requires the user's password because the signer re-derives the HD
 * key material; the vault-level unlock doesn't cover the per-wallet
 * seed decryption.
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
