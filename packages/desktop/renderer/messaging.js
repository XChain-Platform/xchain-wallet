// Desktop renderer messaging helpers. Parity with
// `packages/extension/src/popup/messaging.js` +
// `packages/web/src/messaging.js` so shared routes under
// `@xchain-wallet/core/shared/routes/*` render unchanged.
//
// All traffic routes through `sendMessage` → preload's
// `window.xchainWalletBridge.sendMessage` → main-process
// `ipcMain.handle(IPC_CHANNEL, …)` → MessageHost.

import { sendMessage } from './bridgeMessaging.js';

export { sendMessage };

/** @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>} */
export function getSessionStatus() {
    return /** @type {any} */ (sendMessage('session.status'));
}

/** @param {string} password */
export function unlockWallet(password) {
    return /** @type {any} */ (sendMessage('wallet.unlock', { password }));
}

export function lockWallet() {
    return /** @type {any} */ (sendMessage('wallet.lock'));
}

/** @param {object} opts */
export function createWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.create', opts));
}

/** @param {object} opts */
export function importMnemonic(opts) {
    return /** @type {any} */ (sendMessage('wallet.import', opts));
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

/** @param {object} opts */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}

/** @param {object} opts */
export function sendAsset(opts) {
    return /** @type {any} */ (sendMessage('action.send', opts));
}

/** @param {object} opts */
export function issueToken(opts) {
    return /** @type {any} */ (sendMessage('action.issue', opts));
}

/** @param {object} opts */
export function mintAsset(opts) {
    return /** @type {any} */ (sendMessage('action.mint', opts));
}

/** @param {object} opts */
export function destroyAsset(opts) {
    return /** @type {any} */ (sendMessage('action.destroy', opts));
}

/** @param {object} opts */
export function broadcastAction(opts) {
    return /** @type {any} */ (sendMessage('action.broadcast', opts));
}

/** @param {object} opts */
export function dispenserAction(opts) {
    return /** @type {any} */ (sendMessage('action.dispenser', opts));
}

/** @param {object} req */
export function getDispensersForSource(req) {
    return /** @type {any} */ (sendMessage('dispensers.forSource', req));
}

/** @param {object} req */
export function getDispensersForAddress(req) {
    return /** @type {any} */ (sendMessage('dispensers.forAddress', req));
}

/** @param {object} req */
export function getDispensersForToken(req) {
    return /** @type {any} */ (sendMessage('dispensers.forToken', req));
}

/** @param {object} req */
export function getDispenserByActionIndex(req) {
    return /** @type {any} */ (sendMessage('dispensers.byActionIndex', req));
}

/** @param {object} req */
export function getDispenses(req) {
    return /** @type {any} */ (sendMessage('dispenses.query', req));
}

/** @param {object} opts */
export function dividendAction(opts) {
    return /** @type {any} */ (sendMessage('action.dividend', opts));
}

/** @param {object} req */
export function getHoldersForToken(req) {
    return /** @type {any} */ (sendMessage('holders.forTick', req));
}

/** @param {object} opts */
export function createList(opts) {
    return /** @type {any} */ (sendMessage('action.createList', opts));
}

/** @param {object} opts */
export function airdropAction(opts) {
    return /** @type {any} */ (sendMessage('action.airdrop', opts));
}

/** @param {object} req */
export function getActionByTxid(req) {
    return /** @type {any} */ (sendMessage('actions.byTxid', req));
}

/** @param {object} req */
export function getListByActionIndex(req) {
    return /** @type {any} */ (sendMessage('lists.byActionIndex', req));
}

/** @param {object} req */
export function savePendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.save', req));
}

/** @param {object} req */
export function listPendingAirdropsForWallet(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.listForWallet', req));
}

/** @param {object} req */
export function updatePendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.update', req));
}

/** @param {object} req */
export function clearPendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.clear', req));
}

/** @param {object} opts */
export function advancedAction(opts) {
    return /** @type {any} */ (sendMessage('action.advanced', opts));
}

/** @param {object} req */
export function listActions(req) {
    return /** @type {any} */ (sendMessage('sdk.listActions', req));
}

/** @param {object} req */
export function getActionFormats(req) {
    return /** @type {any} */ (sendMessage('sdk.getActionFormats', req));
}

/** @param {object} req */
export function getActionFields(req) {
    return /** @type {any} */ (sendMessage('sdk.getActionFields', req));
}

/** @param {object} req */
export function validateAction(req) {
    return /** @type {any} */ (sendMessage('sdk.validateAction', req));
}

/** @param {object} opts */
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

/** @param {object} opts */
export function exportPrivateKey(opts) {
    return /** @type {any} */ (sendMessage('wallet.exportPrivateKey', opts));
}
