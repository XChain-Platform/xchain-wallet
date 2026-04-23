// Popup-parity messaging helpers, targeting the in-page host instead of
// chrome.runtime. Each helper's signature matches the popup's
// `packages/extension/src/popup/messaging.js` — keeps shared route
// layouts (once extracted) swap-compatible across shells.

import {
    sendMessage,
    getSessionStatus,
    unlockWalletLocal,
    lockWalletLocal,
} from './hostBridge.js';

export { sendMessage, getSessionStatus };

/** @param {string} password */
export function unlockWallet(password) {
    return unlockWalletLocal({ password });
}

export function lockWallet() {
    return lockWalletLocal();
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
