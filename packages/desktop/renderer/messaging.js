// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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

/** @param {object} opts */
export function addImportedWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.add.import', opts));
}

/**
 * §15.5 / G020: add a single imported WIF to an existing HD wallet.
 * @param {{ walletId: string, password: string, chainId: string, wif: string, addressType?: string, label?: string }} opts
 */
export function importWifRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importWif', opts));
}

/**
 * §19.4 / G036: restore an encrypted backup envelope.
 * @param {{ fileContent: string, password: string, onConflict?: 'overwrite' | 'preserve' | 'error' }} opts
 */
export function importBackupRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importBackup', opts));
}

/** §48.3 / G149: runtime chain activation. */
export function activateChainRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.activateChain', opts));
}

/** @param {{ walletId: string }} req */
export function removeWallet(req) {
    return /** @type {any} */ (sendMessage('wallet.remove', req));
}

/** §50 / G156: diagnostic dump for support copy-paste. */
export function getDiagnosticDump() {
    return /** @type {any} */ (sendMessage('diagnostic.dump'));
}

/** @param {object} opts */
export function renameWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.rename', opts));
}

/** @param {{ accountId: string, name: string }} opts */
export function renameAccount(opts) {
    return /** @type {any} */ (sendMessage('account.rename', opts));
}

/** @param {string} walletId */
export function listAccounts(walletId) {
    return /** @type {any} */ (sendMessage('account.list', { walletId }));
}

/** @param {object} opts */
export function createAccount(opts) {
    return /** @type {any} */ (sendMessage('account.create', opts));
}

/** @param {string} walletId @param {string} [accountId] */
export function getWalletBalances(walletId, accountId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId, accountId }));
}

/** @param {string} walletId @param {string} [accountId] */
export function getAddressesByChain(walletId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId, accountId }));
}

/** @param {string} walletId @param {string} chainId @param {string} [accountId] */
export function getNewestAddress(walletId, chainId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.newest', { walletId, chainId, accountId }));
}

/** Rename an address (set its label). @param {string} id @param {string} label */
export function setAddressLabel(id, label) {
    return /** @type {any} */ (sendMessage('addresses.setLabel', { id, label }));
}

/** Delete an address record by id. @param {string} id */
export function deleteAddress(id) {
    return /** @type {any} */ (sendMessage('addresses.delete', { id }));
}

/** Resolve the active address per chain for an account. @param {string} walletId @param {string} [accountId] */
export function getActiveAddresses(walletId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.active', { walletId, accountId }));
}

/** Set the active address for one (account, chain). @param {string} accountId @param {string} chainId @param {string} addressId */
export function setActiveAddress(accountId, chainId, addressId) {
    return /** @type {any} */ (sendMessage('addresses.setActive', { accountId, chainId, addressId }));
}

/** @param {object} opts */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}

/**
 * §17.6: confirm a persisted HARDWARE receive address on the device's
 * trusted screen and cross-check it. Rejects on mismatch.
 * @param {{ walletId: string, chainId: string, addressId: string, signerId: string }} opts
 */
export function verifyReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.verifyAddress', opts));
}

/** Derive the next dispenser sub-address (change=2) under an account (§16). @param {object} opts */
export function generateDispenserAddress(opts) {
    return /** @type {any} */ (sendMessage('dispenser.getAddress', opts));
}

/** @param {object} opts */
export function sendToken(opts) {
    return /** @type {any} */ (sendMessage('action.send', opts));
}

/**
 * §20 / G040: Watcher-mode encode-only helper.
 * @param {object} opts
 */
export function buildSendPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.send.psbt', opts));
}

/**
 * §20 / Cluster W FOLLOWUP 5: generic watcher-mode encode-only helper
 * for the non-Send action surface.
 * @param {object} opts
 */
export function buildActionPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.psbt', opts));
}

/**
 * §20 / G040 FOLLOWUP 1: broadcast a signed transaction.
 * @param {{ chainId: string, txHex: string }} opts
 */
export function broadcastSignedTxRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.signedTx', opts));
}

/**
 * §30.4 / G088: read-only PSBT decompose for the paste-in form.
 * @param {{ chainId: string, psbtHex: string }} opts
 */
export function parsePsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('psbt.parse', opts));
}

/**
 * §30.4 / G088: user-initiated PSBT signing (software signers).
 * @param {{ walletId: string, addressId: string, password: string, psbtHex: string, bip39Passphrase?: string }} opts
 */
export function signPsbtUserInitiated(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt', opts));
}

/**
 * §30.4 / Cluster E FOLLOWUP 1: HW variant of `signPsbtUserInitiated`.
 * @param {{ walletId: string, addressId: string, psbtHex: string }} opts
 */
export function signPsbtUserInitiatedHw(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt.hw', opts));
}

/**
 * §49.5 / G154: queued broadcast list / broadcast / discard / enqueue.
 *
 * @param {{ walletId: string }} opts
 */
export function listQueuedBroadcasts(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.list', opts));
}
/** @param {{ walletId: string, id: string }} opts */
export function broadcastQueuedRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.broadcast', opts));
}
/** @param {{ walletId: string, id: string }} opts */
export function discardQueuedRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.discard', opts));
}
/**
 * Cluster G FOLLOWUP 1: push a signed-but-unbroadcast tx onto the
 * queue. Action handlers auto-enqueue on broadcast failure server-
 * side; this shim is for explicit caller use.
 *
 * @param {{ walletId: string, chainId: string, signedTxHex: string, summary?: string, signedAt?: number, txid?: string }} opts
 */
export function enqueueBroadcastRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.enqueue', opts));
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
export function mintToken(opts) {
    return /** @type {any} */ (sendMessage('action.mint', opts));
}

/** @param {object} opts */
export function destroyToken(opts) {
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

/**
 * Phase F: a contract's permissions manifest for the inline consent
 * disclosure. Resolves `{ permissions, maxTakeBps }`; never rejects on
 * a missing/undeclared manifest (host flow degrades to nulls).
 *
 * @param {{ chainId: string, contractActionIndex: string }} req
 */
export function getContractManifest(req) {
    return /** @type {any} */ (sendMessage('contracts.manifest', req));
}

/**
 * Phase F: canonical controller action-class list for the bind form's
 * dropdown. Resolves `{ actionClasses: string[] }`.
 *
 * @param {{ chainId: string }} req
 */
export function getControllerActionClasses(req) {
    return /** @type {any} */ (sendMessage('controller.actionClasses', req));
}

/**
 * Phase F: build the `{ action, params }` for a controller bind/unbind
 * via the SDK's controller helper (host-side). Rejects with a clear
 * message when the installed SDK lacks the controller helper.
 *
 * @param {object} req
 */
export function buildControllerBindParams(req) {
    return /** @type {any} */ (sendMessage('controller.buildParams', req));
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

/** @param {{ chainId: string }} req */
export function getCapabilityThresholds(req) {
    return /** @type {any} */ (sendMessage('capabilities.thresholds', req));
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

/** @param {object} req */
export function getContractStakesForAddress(req) {
    return /** @type {any} */ (sendMessage('contract_stakes.forAddress', req));
}

/** @param {object} req */
export function getContractUnstakesForAddress(req) {
    return /** @type {any} */ (sendMessage('contract_unstakes.forAddress', req));
}

/** @param {object} req */
export function getSlashEventsForAddress(req) {
    return /** @type {any} */ (sendMessage('slash_events.forAddress', req));
}

/** @param {object} opts */
export function contractStakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.contractStake', opts));
}

/** @param {object} opts */
export function contractStakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.contractStake.hw', opts));
}

/** @param {object} opts */
export function collectAction(opts) {
    return /** @type {any} */ (sendMessage('action.collect', opts));
}

/** @param {object} opts */
export function collectActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.collect.hw', opts));
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

// VOTE governance authoring (v0 create poll, v1 cast ballot, v3 delegate / clear).
// Software + .hw twins mirror the delegate lane above.
export function createPollAction(opts) {
    return /** @type {any} */ (sendMessage('action.createPoll', opts));
}

export function createPollActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.createPoll.hw', opts));
}

export function castBallotAction(opts) {
    return /** @type {any} */ (sendMessage('action.castBallot', opts));
}

export function castBallotActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.castBallot.hw', opts));
}

export function delegateVoteAction(opts) {
    return /** @type {any} */ (sendMessage('action.delegateVote', opts));
}

export function delegateVoteActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.delegateVote.hw', opts));
}

export function clearVoteDelegationAction(opts) {
    return /** @type {any} */ (sendMessage('action.clearVoteDelegation', opts));
}

export function clearVoteDelegationActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.clearVoteDelegation.hw', opts));
}

// VOTE governance reads (no signing): poll list / detail / frozen results / ballots.
export function governancePolls(req) {
    return /** @type {any} */ (sendMessage('governance.polls', req));
}

export function governancePoll(req) {
    return /** @type {any} */ (sendMessage('governance.poll', req));
}

export function governancePollResults(req) {
    return /** @type {any} */ (sendMessage('governance.pollResults', req));
}

export function governanceVotes(req) {
    return /** @type {any} */ (sendMessage('governance.votes', req));
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

// §22 / P4 passive co-signer (agent account) management.
/** @param {object} req */
export function provisionCoSignerAccount(req) {
    return /** @type {any} */ (sendMessage('coSigner.provision', req));
}

/** @param {{ walletId: string }} req */
export function listCoSignerAccounts(req) {
    return /** @type {any} */ (sendMessage('coSigner.list', req));
}

/** @param {{ id: string }} req */
export function getCoSignerAccount(req) {
    return /** @type {any} */ (sendMessage('coSigner.get', req));
}

/** @param {{ id: string, patch: object }} req */
export function updateCoSignerAccount(req) {
    return /** @type {any} */ (sendMessage('coSigner.update', req));
}

/** @param {{ walletId: string, chainId: string }} req */
export function getMultisigReceiveAddress(req) {
    return /** @type {any} */ (sendMessage('multisig.receiveAddress', req));
}

/** @param {{ walletId: string, chainId: string }} req */
export function listMultisigReceiveAddresses(req) {
    return /** @type {any} */ (sendMessage('multisig.listAddresses', req));
}

// §22.3 + §42.9 multisig sign-round persistence (Phase 4 Step 19).
/** @param {object} req */
export function startMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.start', req));
}

/** @param {{ sessionId: string }} req */
export function getMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.get', req));
}

/** @param {{ walletId: string }} req */
export function listMultisigSigningSessions(req) {
    return /** @type {any} */ (sendMessage('multisigSign.list', req));
}

/** @param {{ sessionId: string }} req */
export function cancelMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.cancel', req));
}

/** @param {{ sessionId: string, pubkey: string, publicNonceHex: string }} req */
export function contributeMultisigNonce(req) {
    return /** @type {any} */ (sendMessage('multisigSign.contributeNonce', req));
}

/** @param {{ sessionId: string, pubkey: string, signatureHex: string }} req */
export function contributeMultisigSignature(req) {
    return /** @type {any} */ (sendMessage('multisigSign.contributeSignature', req));
}

/** @param {{ sessionId: string }} req */
export function aggregateMultisigSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.aggregate', req));
}

/** @param {{ sessionId: string, finalizedTxHex: string, txid?: string }} req */
export function finalizeMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.finalize', req));
}

/** @param {{ sessionId: string, password: string, bip39Passphrase?: string }} req */
export function signMultisigLocally(req) {
    return /** @type {any} */ (sendMessage('multisigSign.signLocally', req));
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

/** @param {{ chainId: string, tick: string }} req */
export function getTokenInfo(req) {
    return /** @type {any} */ (sendMessage('token.info', req));
}

/** @param {{ chainId: string, query: string, limit?: number }} req */
export function searchTokens(req) {
    return /** @type {any} */ (sendMessage('tokens.search', req));
}

/** @param {{ chainId: string, address: string, limit?: number }} req */
export function getOwnedTokens(req) {
    return /** @type {any} */ (sendMessage('tokens.owned', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getOrdersForToken(req) {
    return /** @type {any} */ (sendMessage('orders.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getSwapsForToken(req) {
    return /** @type {any} */ (sendMessage('swaps.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getHistoryForToken(req) {
    return /** @type {any} */ (sendMessage('history.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getGenesisForToken(req) {
    return /** @type {any} */ (sendMessage('genesis.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getSubassetsForToken(req) {
    return /** @type {any} */ (sendMessage('tokens.subassets', req));
}

/** @param {{ chainId: string, tick: string }} req */
export function listGatedContent(req) {
    return /** @type {any} */ (sendMessage('gatedContent.list', req));
}

/** @param {{ walletId: string, password: string, bip39Passphrase?: string, addressId: string, actionIndex: string | number, keyHash: string }} req */
export function unlockGatedContent(req) {
    return /** @type {any} */ (sendMessage('gatedContent.unlock', req));
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
// §46 price-alert CRUD
/** @param {{ walletId: string }} req */
export function listPriceAlertsForWallet(req) { return /** @type {any} */ (sendMessage('priceAlert.listForWallet', req)); }
/** @param {{ walletId: string, chainId: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }} req */
export function savePriceAlert(req) { return /** @type {any} */ (sendMessage('priceAlert.save', req)); }
/** @param {{ id: string }} req */
export function clearPriceAlert(req) { return /** @type {any} */ (sendMessage('priceAlert.clear', req)); }
/** @param {{ id: string }} req */
export function rearmPriceAlert(req) { return /** @type {any} */ (sendMessage('priceAlert.rearm', req)); }

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
// Watcher-mode COINPAY : verifies the obligation, then encodes. Use this
// rather than buildActionPsbtRequest, which would skip the verification.
/** @param {object} opts */
export function buildCoinpayPsbtRequest(opts) { return /** @type {any} */ (sendMessage('action.coinpay.psbt', opts)); }
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

// FILE: public on-chain file upload (NFT artwork attachment)
/** @param {object} opts */
export function fileAction(opts) { return /** @type {any} */ (sendMessage('action.file', opts)); }
/** @param {object} opts */
export function fileActionHw(opts) { return /** @type {any} */ (sendMessage('action.file.hw', opts)); }

// Project registry: current roster lookup
/** @param {object} opts */
export function getProjectForToken(opts) { return /** @type {any} */ (sendMessage('projects.byTick', opts)); }

// §41.7.2 Messaging inbox
/** @param {object} opts */
export function getMessagingInbox(opts) { return /** @type {any} */ (sendMessage('messaging.inbox', opts)); }
export function getMessagingInboxSweep(opts) { return /** @type {any} */ (sendMessage('messaging.inboxSweep', opts)); }
/** Whether the active wallet can sign without a password right now (unlocked session with a pooled signer). */
export function signerReady(opts) { return /** @type {any} */ (sendMessage('wallet.signerReady', opts)); }

// §41.7.3 Compose
/** @param {object} opts */
export function messageAction(opts) { return /** @type {any} */ (sendMessage('action.message', opts)); }
/** @param {object} opts */
export function messageActionHw(opts) { return /** @type {any} */ (sendMessage('action.message.hw', opts)); }
export function sendHandshake(opts) { return /** @type {any} */ (sendMessage('messaging.handshake', opts)); }
export function sendHandshakeHw(opts) { return /** @type {any} */ (sendMessage('messaging.handshake.hw', opts)); }
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

// §12 / G009: origin blocklist.
export function listBlockedOrigins() {
    return /** @type {Promise<string[]>} */ (sendMessage('sites.listBlocked'));
}
/** @param {{ origin: string }} req */
export function blockOrigin(req) {
    return /** @type {any} */ (sendMessage('sites.block', req));
}
/** @param {{ origin: string }} req */
export function unblockOrigin(req) {
    return /** @type {any} */ (sendMessage('sites.unblock', req));
}

// §9.7 / G007: runtime chain-registry refresh from hub.
export function getChainRegistryStatus() {
    return /** @type {any} */ (sendMessage('chainRegistry.status'));
}
export function refreshChainRegistry() {
    return /** @type {any} */ (sendMessage('chainRegistry.refresh'));
}

// §9.7 / Cluster Q FOLLOWUP 2: Developer Mode custom chain registry.
export function listCustomChains() {
    return /** @type {Promise<{ descriptors: object[] }>} */ (sendMessage('chainRegistry.listCustomChains'));
}
export function addCustomChain(req) {
    return /** @type {Promise<{ descriptor: object }>} */ (sendMessage('chainRegistry.addCustomChain', req));
}
export function removeCustomChain(req) {
    return /** @type {Promise<{ removed: boolean }>} */ (sendMessage('chainRegistry.removeCustomChain', req));
}

// §31.4 / Cluster O FOLLOWUP 2: DIVIDEND / AIRDROP recipient resolution.
export function getDividendRecipients(req) {
    return /** @type {Promise<{ recipients: object[], tick: string, source?: string | null, snapshotNote: string }>} */ (
        sendMessage('history.getDividendRecipients', req)
    );
}
export function getAirdropRecipients(req) {
    return /** @type {Promise<{ recipients: object[], listActionIndex: string, listType: string | null }>} */ (
        sendMessage('history.getAirdropRecipients', req)
    );
}

/**
 * Native-coin price oracle (see web shell for shape). Gated on
 * settings.privacy.priceDataEnabled; returns `{ disabled: true }` when
 * the user has opted out.
 *
 * @param {{ chainIds: string[], includeSparkline?: boolean }} opts
 */
export function getNativePricesRequest(opts) {
    return /** @type {any} */ (sendMessage('prices.native', opts));
}
