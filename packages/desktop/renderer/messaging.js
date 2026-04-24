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
export function sendAssetHw(opts) {
    return /** @type {any} */ (sendMessage('action.send.hw', opts));
}

/** @param {{ signerId: string, chainId?: string }} opts */
export function getSignerStatus(opts) {
    return /** @type {any} */ (sendMessage('signer.status', opts));
}

/** @param {object} opts */
export function issueTokenHw(opts) { return /** @type {any} */ (sendMessage('action.issue.hw', opts)); }
/** @param {object} opts */
export function mintAssetHw(opts) { return /** @type {any} */ (sendMessage('action.mint.hw', opts)); }
/** @param {object} opts */
export function destroyAssetHw(opts) { return /** @type {any} */ (sendMessage('action.destroy.hw', opts)); }
/** @param {object} opts */
export function broadcastActionHw(opts) { return /** @type {any} */ (sendMessage('action.broadcast.hw', opts)); }
/** @param {object} opts */
export function dispenserActionHw(opts) { return /** @type {any} */ (sendMessage('action.dispenser.hw', opts)); }
/** @param {object} opts */
export function dividendActionHw(opts) { return /** @type {any} */ (sendMessage('action.dividend.hw', opts)); }
/** @param {object} opts */
export function createListHw(opts) { return /** @type {any} */ (sendMessage('action.createList.hw', opts)); }
/** @param {object} opts */
export function airdropActionHw(opts) { return /** @type {any} */ (sendMessage('action.airdrop.hw', opts)); }
/** @param {object} opts */
export function advancedActionHw(opts) { return /** @type {any} */ (sendMessage('action.advanced.hw', opts)); }

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

/** @param {object} req */
export function getContractsForSource(req) {
    return /** @type {any} */ (sendMessage('contracts.forSource', req));
}

/** @param {object} req */
export function getContractsForAddress(req) {
    return /** @type {any} */ (sendMessage('contracts.forAddress', req));
}

/** @param {object} req */
export function getContractsBrowseAll(req) {
    return /** @type {any} */ (sendMessage('contracts.browseAll', req));
}

/** @param {object} req */
export function getDepositsForAddress(req) {
    return /** @type {any} */ (sendMessage('deposits.forAddress', req));
}

/** @param {object} req */
export function getWithdrawalsForAddress(req) {
    return /** @type {any} */ (sendMessage('withdrawals.forAddress', req));
}

/** @param {object} req */
export function getContractByActionIndex(req) {
    return /** @type {any} */ (sendMessage('contracts.byActionIndex', req));
}

/** @param {object} req */
export function getActionByIndex(req) {
    return /** @type {any} */ (sendMessage('actions.byIndex', req));
}

/** @param {object} req */
export function getContractState(req) {
    return /** @type {any} */ (sendMessage('contracts.state', req));
}

/** @param {object} req */
export function getContractBalance(req) {
    return /** @type {any} */ (sendMessage('contracts.balance', req));
}

/** @param {object} req */
export function getExecutionsForContract(req) {
    return /** @type {any} */ (sendMessage('executions.forContract', req));
}

/** @param {object} opts */
export function deployAction(opts) {
    return /** @type {any} */ (sendMessage('action.deploy', opts));
}

/** @param {object} opts */
export function deployActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.deploy.hw', opts));
}

/** @param {object} opts */
export function executeAction(opts) {
    return /** @type {any} */ (sendMessage('action.execute', opts));
}

/** @param {object} opts */
export function executeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.execute.hw', opts));
}

/** @param {object} opts */
export function depositAction(opts) {
    return /** @type {any} */ (sendMessage('action.deposit', opts));
}

/** @param {object} opts */
export function depositActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.deposit.hw', opts));
}

/** @param {object} opts */
export function withdrawAction(opts) {
    return /** @type {any} */ (sendMessage('action.withdraw', opts));
}

/** @param {object} opts */
export function withdrawActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.withdraw.hw', opts));
}

/** @param {object} req */
export function getStakesForAddress(req) {
    return /** @type {any} */ (sendMessage('stakes.forAddress', req));
}

/** @param {object} req */
export function getDelegationsForAddress(req) {
    return /** @type {any} */ (sendMessage('delegations.forAddress', req));
}

/** @param {object} req */
export function getRewardsForAddress(req) {
    return /** @type {any} */ (sendMessage('rewards.forAddress', req));
}

/** @param {object} req */
export function getValidatorsForChain(req) {
    return /** @type {any} */ (sendMessage('validators.forChain', req));
}

/** @param {object} opts */
export function stakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.stake', opts));
}

/** @param {object} opts */
export function stakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.stake.hw', opts));
}

/** @param {object} opts */
export function unstakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.unstake', opts));
}

/** @param {object} opts */
export function unstakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.unstake.hw', opts));
}

/** @param {object} opts */
export function claimRewardsAction(opts) {
    return /** @type {any} */ (sendMessage('action.claimRewards', opts));
}

/** @param {object} opts */
export function claimRewardsActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.claimRewards.hw', opts));
}

/** @param {object} opts */
export function delegateAction(opts) {
    return /** @type {any} */ (sendMessage('action.delegate', opts));
}

/** @param {object} opts */
export function delegateActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.delegate.hw', opts));
}

/** @param {object} opts */
export function revokeDelegationAction(opts) {
    return /** @type {any} */ (sendMessage('action.revokeDelegation', opts));
}

/** @param {object} opts */
export function revokeDelegationActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.revokeDelegation.hw', opts));
}

/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getBroadcastsForAddress(req) {
    return /** @type {any} */ (sendMessage('broadcasts.forAddress', req));
}

/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getAddressHistory(req) {
    return /** @type {any} */ (sendMessage('history.address', req));
}

/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getLinksForAddress(req) {
    return /** @type {any} */ (sendMessage('links.address', req));
}

/** @param {object} req */
export function createMultisigConfig(req) {
    return /** @type {any} */ (sendMessage('multisig.create', req));
}

/** @param {{ walletId: string, chainId: string }} req */
export function getMultisigReceiveAddress(req) {
    return /** @type {any} */ (sendMessage('multisig.receiveAddress', req));
}

/** @param {object} req */
export function validateContractCode(req) {
    return /** @type {any} */ (sendMessage('contracts.validate', req));
}

/** @param {object} req */
export function checkContractCodeSize(req) {
    return /** @type {any} */ (sendMessage('contracts.checkCodeSize', req));
}

/** @param {object} req */
export function suggestContractGasLimit(req) {
    return /** @type {any} */ (sendMessage('contracts.suggestGasLimit', req));
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

// §41.2–§41.3 DEX market queries + watchlist CRUD
/** @param {{ chainId: string, tick?: string }} req */
export function getMarkets(req) { return /** @type {any} */ (sendMessage('markets.list', req)); }
/** @param {{ chainId: string, tick1: string, tick2: string }} req */
export function getMarket(req) { return /** @type {any} */ (sendMessage('markets.byPair', req)); }
/** @param {{ chainId: string, tick1: string, tick2: string, address?: string, opts?: object }} req */
export function getMarketHistory(req) { return /** @type {any} */ (sendMessage('markets.history', req)); }
/** @param {{ chainId: string, tick1: string, tick2: string, address?: string, opts?: object }} req */
export function getMarketOrders(req) { return /** @type {any} */ (sendMessage('markets.orders', req)); }
/** @param {{ chainId: string, tick1: string, tick2: string }} req */
export function getOrderbook(req) { return /** @type {any} */ (sendMessage('markets.orderbook', req)); }
/** @param {{ walletId: string }} req */
export function listWatchlistForWallet(req) { return /** @type {any} */ (sendMessage('watchlist.listForWallet', req)); }
/** @param {{ walletId: string, chainId: string, tick1: string, tick2: string }} req */
export function saveWatchlistEntry(req) { return /** @type {any} */ (sendMessage('watchlist.save', req)); }
/** @param {{ id: string }} req */
export function clearWatchlistEntry(req) { return /** @type {any} */ (sendMessage('watchlist.clear', req)); }

// §41.3.4 ORDER + §41.3.5 CANCEL
/** @param {object} opts */
export function orderAction(opts) { return /** @type {any} */ (sendMessage('action.order', opts)); }
/** @param {object} opts */
export function orderActionHw(opts) { return /** @type {any} */ (sendMessage('action.order.hw', opts)); }
/** @param {object} opts */
export function cancelOrder(opts) { return /** @type {any} */ (sendMessage('action.cancelOrder', opts)); }
/** @param {object} opts */
export function cancelOrderHw(opts) { return /** @type {any} */ (sendMessage('action.cancelOrder.hw', opts)); }

// §41.4 COINPAY
/** @param {object} opts */
export function coinpayAction(opts) { return /** @type {any} */ (sendMessage('action.coinpay', opts)); }
/** @param {object} opts */
export function coinpayActionHw(opts) { return /** @type {any} */ (sendMessage('action.coinpay.hw', opts)); }
/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getCoinpayObligationsForAddress(req) { return /** @type {any} */ (sendMessage('coinpays.obligationsForAddress', req)); }
/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getCoinpaysForAddress(req) { return /** @type {any} */ (sendMessage('coinpays.forAddress', req)); }

// §41.5 SWAP
/** @param {object} opts */
export function swapAction(opts) { return /** @type {any} */ (sendMessage('action.swap', opts)); }
/** @param {object} opts */
export function swapActionHw(opts) { return /** @type {any} */ (sendMessage('action.swap.hw', opts)); }

// §42.8.1 LINK
/** @param {object} opts */
export function linkAction(opts) { return /** @type {any} */ (sendMessage('action.link', opts)); }
/** @param {object} opts */
export function linkActionHw(opts) { return /** @type {any} */ (sendMessage('action.link.hw', opts)); }

// §41.7.2 Messaging inbox
/** @param {object} opts */
export function getMessagingInbox(opts) { return /** @type {any} */ (sendMessage('messaging.inbox', opts)); }

// §41.7.3 Compose
/** @param {object} opts */
export function messageAction(opts) { return /** @type {any} */ (sendMessage('action.message', opts)); }
/** @param {object} opts */
export function messageActionHw(opts) { return /** @type {any} */ (sendMessage('action.message.hw', opts)); }
/** @param {{ chainId: string, address: string }} req */
export function getRecipientPubkey(req) { return /** @type {any} */ (sendMessage('messaging.pubkey', req)); }

// §41.7.4 Contacts
export function listContacts() { return /** @type {any} */ (sendMessage('contacts.list', {})); }
/** @param {{ chain: string, address: string }} req */
export function findContactByAddress(req) { return /** @type {any} */ (sendMessage('contacts.findByAddress', req)); }
/** @param {object} opts */
export function saveContact(opts) { return /** @type {any} */ (sendMessage('contacts.save', opts)); }
/** @param {{ id: string }} req */
export function deleteContact(req) { return /** @type {any} */ (sendMessage('contacts.delete', req)); }

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
