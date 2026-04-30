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
import { savePassword, clearPassword } from './sessionPasswordCache.js';

export { sendMessage, getSessionStatus };

/** @param {string} password */
export async function unlockWallet(password) {
    const result = await unlockWalletLocal({ password });
    // Cache the password in sessionStorage so a page reload inside
    // the same tab skips straight to Home instead of the unlock
    // screen. Cleared on lock or tab close.
    savePassword(password);
    return result;
}

export async function lockWallet() {
    // Explicit lock invalidates the cached password — next reload
    // sends the user back through the unlock form.
    clearPassword();
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
export async function createWallet(opts) {
    const result = await createWalletLocal(opts);
    if (opts && typeof opts.password === 'string') savePassword(opts.password);
    return result;
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
export async function importMnemonic(opts) {
    const result = await importMnemonicLocal(opts);
    if (opts && typeof opts.password === 'string') savePassword(opts.password);
    return result;
}

export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/** @param {object} opts */
export function addImportedWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.add.import', opts));
}

/** @param {object} opts */
export function renameWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.rename', opts));
}

/** @param {string} walletId */
export function listAccounts(walletId) {
    return /** @type {any} */ (sendMessage('account.list', { walletId }));
}

/**
 * Create the next BIP44 account under a wallet (max(index)+1). When
 * `opts.signerId` names a paired hardware signer (§17.6 / G023), the
 * account's first addresses are derived by that device.
 *
 * @param {{ walletId: string, password?: string, bip39Passphrase?: string, name?: string, signerId?: string }} opts
 */
export function createAccount(opts) {
    return /** @type {any} */ (sendMessage('account.create', opts));
}

/** @param {string} walletId @param {string} [accountId] */
export function getWalletBalances(walletId, accountId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId, accountId }));
}

/**
 * Single-address balance read — feeds the §21.2 simulator preview on
 * Send.jsx review and SignApproval. Returns the SDK's raw
 * `{ native, assets }` shape; callers convert via
 * `decoder.balancesFromSdk(...)` before feeding `simulateAction`.
 *
 * @param {string} chainId
 * @param {string} address
 * @returns {Promise<unknown>}
 */
export function getAddressBalances(chainId, address) {
    return /** @type {any} */ (sendMessage('balances.address', { chainId, address }));
}

/** @param {string} walletId @param {string} [accountId] */
export function getAddressesByChain(walletId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId, accountId }));
}

/** @param {string} walletId @param {string} chainId @param {string} [accountId] */
export function getNewestAddress(walletId, chainId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.newest', { walletId, chainId, accountId }));
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
 * §20 / G040 — Watcher-mode helper: encode an unsigned PSBT for a SEND
 * action without unlocking the wallet, signing, or broadcasting.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.to
 * @param {string} opts.asset
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @returns {Promise<{ psbtHex: string, encoding: string, actionString: string, action: string, chainId: string, fromAddress: string }>}
 */
export function buildSendPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.send.psbt', opts));
}

/**
 * §20 / Cluster W FOLLOWUP 5 — watcher-mode helper for the non-Send
 * action surface. Builds an unsigned PSBT for any XChain action without
 * unlocking the wallet, calling a signer, or broadcasting.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string, addressId?: string, source?: string, signerId?: string }} opts.from
 * @param {{ action: string, params: object }} opts.actionData
 * @param {object} [opts.encoderOpts]
 * @returns {Promise<{ psbtHex: string, encoding: string, actionString: string, action: string, chainId: string, fromAddress: string }>}
 */
export function buildActionPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.psbt', opts));
}

/**
 * §17.4 / §30.1 / G024 — user-initiated message signing.
 *
 * @param {{ walletId: string, addressId: string, password: string, message: string, bip39Passphrase?: string }} opts
 * @returns {Promise<{ signature: string }>}
 */
export function signMessageRequest(opts) {
    return /** @type {any} */ (sendMessage('auth.signMessage', opts));
}

/**
 * §17.5 / G025 — verify a signature against an address. Pure SDK call.
 *
 * @param {{ chainId: string, address: string, message: string, signature: string }} opts
 * @returns {Promise<{ valid: boolean }>}
 */
export function verifyMessageRequest(opts) {
    return /** @type {any} */ (sendMessage('auth.verifyMessage', opts));
}

/**
 * §49.5 / G154 — queued broadcast list / broadcast / discard.
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
 * Cluster G FOLLOWUP 1 — push a signed-but-unbroadcast tx onto the
 * queue. Action handlers auto-enqueue on broadcast failure server-side;
 * this shim is for explicit caller use (e.g. PsbtSignForm).
 *
 * @param {{ walletId: string, chainId: string, signedTxHex: string, summary?: string, signedAt?: number, txid?: string }} opts
 */
export function enqueueBroadcastRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.enqueue', opts));
}

/**
 * §49.1 / G153 — reachability probe across the supplied chains.
 *
 * @param {{ chainIds: string[], timeoutMs?: number }} opts
 * @returns {Promise<{ overall: 'normal' | 'degraded' | 'offline', perChain: Array<{ chainId: string, mode: 'normal' | 'degraded' | 'offline' | 'not-configured', services: { explorer: string, encoder: string, hub: string } }> }>}
 */
export function checkReachabilityRequest(opts) {
    return /** @type {any} */ (sendMessage('reachability.check', opts));
}

/**
 * §30.4 / G088 — read-only PSBT decompose for the paste-in form preview.
 *
 * @param {{ chainId: string, psbtHex: string }} opts
 * @returns {Promise<{ decomposed: import('@xchain-wallet/core/signers/types').DecomposedPsbt }>}
 */
export function parsePsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('psbt.parse', opts));
}

/**
 * §30.4 / G088 — user-initiated PSBT signing.
 *
 * @param {{ walletId: string, addressId: string, password: string, psbtHex: string, bip39Passphrase?: string }} opts
 * @returns {Promise<{ signedPsbtHex: string, txHex: string, txid: string }>}
 */
export function signPsbtUserInitiated(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt', opts));
}

/**
 * §30.4 / Cluster E FOLLOWUP 1 — HW variant of `signPsbtUserInitiated`.
 *
 * @param {{ walletId: string, addressId: string, psbtHex: string }} opts
 * @returns {Promise<{ signedPsbtHex: string, txHex: string, txid: string }>}
 */
export function signPsbtUserInitiatedHw(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt.hw', opts));
}

/**
 * §20 / G040 FOLLOWUP 1 — broadcast a signed transaction.
 *
 * @param {{ chainId: string, txHex: string }} opts
 * @returns {Promise<{ txid: string }>}
 */
export function broadcastSignedTxRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.signedTx', opts));
}

/**
 * §19.3 — reveal the wallet's seed mnemonic. Returns plaintext;
 * caller is responsible for the reveal-screen guardrails.
 *
 * @param {{ walletId: string, password: string }} opts
 * @returns {Promise<{ mnemonic: string, format: 'bip39' | 'counterwallet-legacy', passphraseEnabled: boolean }>}
 */
export function revealMnemonicRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.revealMnemonic', opts));
}

/**
 * §19.6 — dry-run restore from a candidate mnemonic.
 *
 * @param {{ walletId: string, mnemonic: string, format?: string, bip39Passphrase?: string, gapLimit?: number }} opts
 * @returns {Promise<{ overallMatch: boolean, perChain: Array<object> }>}
 */
export function dryRunRestoreRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.dryRunRestore', opts));
}

/**
 * §19.5.2 / G037 — manual on-chain label publish. Encrypts the wallet's
 * labels + contacts and broadcasts the ciphertext as a FILE action on
 * the chosen chain.
 *
 * Resolves to `{ txid, chainId, discoveryName, sizeBytes, fromAddress }`.
 *
 * @param {{ walletId: string, password: string, chainId: string, bip39Passphrase?: string, fee?: number, feePerKb?: number }} opts
 */
export function publishLabelsRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.publishLabels', opts));
}

/**
 * §15.5 / G020 — add a single imported WIF to an existing HD wallet.
 *
 * @param {{ walletId: string, password: string, chainId: string, wif: string, addressType?: string, label?: string }} opts
 */
export function importWifRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importWif', opts));
}

/**
 * §19.4 / G036 — restore an encrypted backup envelope into the live vault.
 *
 * @param {{ fileContent: string, password: string, onConflict?: 'overwrite' | 'preserve' | 'error' }} opts
 */
export function importBackupRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importBackup', opts));
}

/**
 * §48.3 / G149 — runtime chain activation.
 *
 * @param {{ walletId: string, chainId: string, password: string, bip39Passphrase?: string, signerId?: string | null }} opts
 * @returns {Promise<{ chainId: string, addresses: Array<{ accountId: string, address: any }>, skippedAccounts: number }>}
 */
export function activateChainRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.activateChain', opts));
}

/** §50 / G156 — diagnostic dump for support copy-paste. */
export function getDiagnosticDump() {
    return /** @type {any} */ (sendMessage('diagnostic.dump'));
}

/**
 * HW-wallet variant of sendAsset. No password. Background resolves
 * the `signerId` + routes the sign request through the renderer-side
 * signer bridge. See popup/messaging.js for the full shape.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
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
 * Build, sign, and broadcast a DISPENSER action. See popup messaging.js
 * for prop docs.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
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

// §35 Settings — read + patch the per-vault Settings record. Patch is a
// deep-merge body; see flows/settings.js for the merge semantics.
export function getSettings() {
    return /** @type {any} */ (sendMessage('settings.get'));
}

/** @param {Record<string, unknown>} patch */
export function updateSettings(patch) {
    return /** @type {any} */ (sendMessage('settings.update', { patch }));
}

/**
 * §19.4 encrypted backup. Resolves to `{ fileContent }` — the
 * pretty-printed JSON envelope ready to write to disk.
 *
 * @param {{ walletId: string, password: string, includePendingTxs?: boolean }} opts
 * @returns {Promise<{ fileContent: string }>}
 */
export function exportBackupFile(opts) {
    return /** @type {any} */ (sendMessage('wallet.exportBackup', opts));
}

// §35.1 + §43 connected-sites — list / disconnect. Approvals create
// the records in bridge/handlers.js.
export function listConnectedSites() {
    return /** @type {any} */ (sendMessage('sites.list'));
}
/** @param {{ id: string }} req */
export function deleteConnectedSite(req) {
    return /** @type {any} */ (sendMessage('sites.delete', req));
}
/**
 * §37.2 / Cluster D FOLLOWUP 1 — restore a ConnectedSite from a
 * full record snapshot. Used by the Disconnect-site Undo toast.
 *
 * @param {{ site: object }} req
 */
export function restoreConnectedSite(req) {
    return /** @type {any} */ (sendMessage('sites.restore', req));
}

// §12 / G009 — origin blocklist.
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

/** Cluster S FOLLOWUP 4 — blocklist audit log surface. */
export function listBlocklistAuditLog() {
    return /** @type {Promise<Array<{ at: number, action: 'add' | 'remove', entry: string, evictedSiteIds?: string[] }>>} */ (
        sendMessage('sites.auditLog.list')
    );
}
export function clearBlocklistAuditLog() {
    return /** @type {Promise<{ cleared: number }>} */ (sendMessage('sites.auditLog.clear'));
}

// §9.7 / G007 — runtime chain-registry refresh from hub.
export function getChainRegistryStatus() {
    return /** @type {any} */ (sendMessage('chainRegistry.status'));
}
export function refreshChainRegistry() {
    return /** @type {any} */ (sendMessage('chainRegistry.refresh'));
}

/**
 * Destructively remove a wallet and every record linked to it. Returns
 * a `removed` summary keyed by collection name.
 *
 * @param {{ walletId: string }} req
 */
export function removeWallet(req) {
    return /** @type {any} */ (sendMessage('wallet.remove', req));
}

/**
 * Derive + persist the next unused external address for (wallet, chain).
 * Software signer requires the user's password (re-runs Argon2id KDF
 * on the encrypted seed; §26 — password-never-stored posture). When
 * `opts.signerId` names a paired hardware signer (§17.6 / G023), the
 * password is skipped and the device confirms the derivation locally;
 * the address is persisted with `source: 'trezor' | 'ledger'`.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} [opts.password]
 * @param {string} [opts.bip39Passphrase]
 * @param {string} [opts.addressType]
 * @param {string} [opts.signerId]
 * @returns {Promise<{ id: string, address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}
