// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// createBackgroundHost: factory that returns a MessageHost with the
// Phase 1 flow handlers registered. Shells instantiate this once at
// service-worker startup.
//
// Handler surface mirrors the core flows API; requests are the same
// object shape, minus the dependency fields (vault / chainRegistry /
// sdkRegistry), which the host injects from its constructor deps.
//
// Sensitive-field projection: `wallet.list` and flows that return
// Wallet records strip the encryptedSeed / kdfParams / importedKeys
// before returning: even though the popup is same-extension and
// therefore trusted, keeping that data off the wire narrows the blast
// radius of any future logging or telemetry bug in the popup layer.

import { crypto as coreCrypto, decoder, flows, notifications, registry, schemas } from '@xchain-wallet/core';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import { sharedListDirectory } from '@xchain-wallet/core/flows/sharedLists.js';
import { listTickCoinSupport } from '@xchain-wallet/core/flows/listTickCoinSupport.js';
import { listAnyCoinItemsSupport } from '@xchain-wallet/core/flows/listAnyCoinItemsSupport.js';
import { sdkSupportedAddressTypes } from '@xchain-wallet/core/flows/sdkAddressTypes.js';
import { supplyHistoryFor } from '@xchain-wallet/core/flows/supplyHistory.js';
import { walletHistoryBatch, walletNativeHistoryBatch } from '@xchain-wallet/core/flows/walletValueReads.js';
import { getSignerRecord } from '@xchain-wallet/core/flows/registerSigner.js';
import { accountDeviceSignerId } from '@xchain-wallet/core/flows/addressCustody/accountCustody.js';
import { mintedAmountForAddress } from '@xchain-wallet/core/flows/mintedAmount.js';
import { capRbfToDescriptor } from '@xchain-wallet/core/flows/rbfCap.js';
import { assertWalletUnlockedForReveal } from '@xchain-wallet/core/flows/revealAccess.js';
import {
    handleDiscardPendingFileUpload,
    handleFileMultipart,
    handleListPendingFileUploads,
} from '@xchain-wallet/core/flows/fileMultipartRoutes.js';
import { publishMultipartFile } from '@xchain-wallet/core/flows/publishMultipartFile.js';
import { multipartPairSizes } from '@xchain-wallet/core/flows/uploadMethod.js';
import { createFileRefResolver } from '@xchain-wallet/core/flows/fileRefSource.js';
import {
    buildEditFeedListsParams,
    buildBetActionPsbt,
    editBetFeedListsAction,
} from '@xchain-wallet/core/flows/betActions.js';
import {
    createErrorRingBuffer,
    installShellErrorCapture,
} from '@xchain-wallet/core/flows/diagnosticDump.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import { getDefaultAlertInbox } from '@xchain-wallet/core/shared/alertInbox.js';
import { rawTxid } from '@xchain-wallet/core/signers/verifySignedTx.js';
import { PREVOUT_NOT_UNSPENT, assertBroadcastSignaturesVerify } from '@xchain-wallet/core/signers/verifyTxSignatures.js';
import { spentInputsVerdict } from '@xchain-wallet/core/flows/deployLegWait.js';
import { MessageHost } from './MessageHost.js';
import { registerBridgeHandlers } from '../bridge/handlers.js';
import {
    notifyAccountsChanged,
    notifyDisconnectedSites,
    notifyNetworkChanged,
} from '../bridge/bridgeEvents.js';
import { AUTO_LOCK_UNSAVED, applyAutoLockSignal } from './autoLockState.js';
import * as signerBridge from './signerBridge.js';
import { createBroadcastQueueStorage } from './broadcastQueueStorage.js';
import { createBroadcastQueueStore } from './broadcastQueueStore.js';
import { createBroadcastQueueEngine } from './broadcastQueueEngine.js';
import {
    createHoldBeforeBroadcast,
    createSendHoldRegistry,
} from './sendHold.js';
import {
    claimingSdkRegistry,
    createOwnSpendLedger,
    createRouteClaims,
    psbtOutpoints,
    rawTxOutpoints,
    soldNames,
} from './ownSpends.js';
import { createLockedSendOutcomeStore, finishPatchFor } from './lockedSendOutcomes.js';
import { createSignThrottleStorage } from './signThrottleStorage.js';
import { createLogConsoleStorage } from './logConsoleStorage.js';
import { createPendingFileBlobs } from '../storage/pendingFileBlobs.js';
import {
    createActionSafetySessionStorage,
    ownSpendStoreFrom,
    reservationStoreFrom,
} from './actionSafetySessionStorage.js';
import {
    DEFAULT_ACTIVE_CHAIN_IDS,
    hardwareWalletInput,
    hardwareWalletResult,
} from './walletCreate.js';
import {
    addHardwareWallet,
    HardwareWalletHasNoSeedError,
    isHardwareWallet,
} from '@xchain-wallet/core/flows/hardwareWallet.js';
// Shared with the PRE-HOST fresh-install restore lane, which never reaches this
// host: one resolver so the two lanes cannot drift on what they will fetch.
import { resolveBackupPointerContent } from './backupPointerResolver.js';
import {
    startLabelSyncRestoreTask,
    waitForLabelSyncRestoreTask,
} from './labelSyncRestoreTasks.js';
import { createAddressDiscoveryTask } from './addressDiscoveryTask.js';
import { createReleaseFeedHandler } from './releaseFeedFetch.js';

const {
    importedAddressIdsFor,
    importedAddressIdsForStrict,
    importedAddressIdsOfWallet,
    createAccount,
    activateChain,
    renameWallet,
    renameAccount,
    importMnemonic,
    restoreLabelSyncAfterImport,
    rekeyWalletRecord,
    labelSyncSearchChainIds,
    unlockWallet,
    receiveAddress,
    ensureNetworkAddresses,
    ensureSettings,
    seedChainIdsForVault,
    verifyReceiveAddress,
    dispenserAddress,
    resolveActiveAddresses,
    setActiveAddress,
    sendToken,
    normalizeSource,
    composeActionForConfirm,
    createReservationLedger,
    buildSendPsbt,
    buildActionPsbt,
    buildCoinpayPsbtRequest,
    sweepToken,
    sweepPreview,
    escrowedTokens,
    issueToken,
    mintToken,
    destroyToken,
    callbackAction,
    tokenHolderSummary,
    sleepAction,
    sleepStateFor,
    broadcastAction,
    oraclePriceAction,
    myOracleFeeds,
    oracleConsumers,
    addressPreferencesAction,
    currentAddressPreferences,
    planChunkedDeploy,
    deployChunkedRun,
    listPendingDeploysForWallet,
    clearPendingDeploy,
    dispenserAction,
    orderAction,
    cancelOrder,
    editOrder,
    coinpayAction,
    swapAction,
    linkAction,
    fileAction,
    gatedPublishAction,
    buildGatedPublishPsbtRequest,
    composeGatedPublishForConfirm,
    getProjectForTick,
    getCoinpayObligationsForAddress,
    getCoinpayMatchSides,
    getCoinpaysForAddress,
    listAutopayOrders,
    setAutopayEnabled,
    autopayExposureBase,
    resolveOrderActionIndexes,
    getMessagingInbox,
    getMessagingInboxSweep,
    unlockGatedFileForAddress,
    listGatedFiles,
    recoverGatedKeysForTick,
    copyGatedKeysToWallet,
    prepareGatedSend,
    gatedSendReadiness,
    normalizeSendLegs,
    buildSendParams,
    assertMultiSendSupported,
    assertNoGatedLegs,
    messageAction,
    buildMessageParams,
    handshakeAction,
    getRecipientPubkey,
    listContacts,
    findContactByAddress,
    saveContact,
    saveContacts,
    deleteContact,
    dispensersForSource,
    dispensersForAddress,
    dispensersForToken,
    dispenserByActionIndex,
    dispensesFor,
    dispenserLifecycleFor,
    contractsForSource,
    contractsForAddress,
    contractsBrowseAll,
    depositsForAddress,
    withdrawalsForAddress,
    contractByActionIndex,
    actionByIndex,
    contractState,
    contractBalance,
    executionsForContract,
    contractManifestFor,
    controllerBindParams,
    controllerActionClasses,
    deployAction,
    executeAction,
    depositAction,
    withdrawAction,
    stakesForAddress,
    delegationsForAddress,
    rewardsForAddress,
    rewardClaimsForAddress,
    validatorsForChain,
    capabilityThresholds,
    contractStakesForAddress,
    contractUnstakesForAddress,
    slashEventsForAddress,
    stakeAction,
    unstakeAction,
    collectAction,
    delegateAction,
    revokeDelegationAction,
    createPollAction,
    castBallotAction,
    delegateVoteAction,
    clearVoteDelegationAction,
    createMarketAction,
    placeBetAction,
    resolveMarketAction,
    cancelMarketAction,
    betFeedsForChain,
    betFeedDetail,
    betsForQuery,
    oracleStats,
    projectBetPayout,
    projectBetFeedCreateFee,
    pollsForChain,
    pollDetail,
    pollResults,
    votesForQuery,
    voteDelegationsForAddress,
    contractStakeAction,
    broadcastsForAddress,
    linksForAddress,
    tokenInfoFor,
    searchPlatformTokens,
    listOwnedTokens,
    createMultisigConfig,
    getMultisigCosignerInfo,
    receiveMultisigAddress,
    listMultisigReceiveAddresses,
    startMultisigSigningSession,
    startMultisigSend,
    getMultisigSigningSession,
    listMultisigSigningSessions,
    cancelMultisigSigningSession,
    contributeMultisigNonce,
    contributeMultisigSignature,
    aggregateMultisigSession,
    finalizeMultisigSigningSession,
    signMultisigLocally,
    importMultisigSigningRequest,
    contractValidate,
    contractCheckCodeSize,
    contractSuggestGasLimit,
    contractExportedMeta,
    dividendAction,
    holdersFor,
    createList,
    airdropAction,
    actionByTxid,
    listByActionIndex,
    listsForSource,
    savePendingAirdrop,
    listPendingAirdropsForWallet,
    updatePendingAirdrop,
    clearPendingAirdrop,
    advancedAction,
    buildBatchCommand,
    listActions,
    getActionFormats,
    getActionFields,
    validateActionDryRun,
    registerSigner,
    listSignersForWallet,
    unregisterSigner,
    resolveSigner,
    buildRemoteSigner,
    exportPrivateKey,
    walletBalances,
    addressBalances,
    addressHistory,
    addressMempool,
    livePendingTxs,
    chainTipBlockTime,
    indexerWatermark,
    verifyAddressBalance,
    verifyAddressAction,
    getActiveNetwork,
    filterChainIdsByActiveNetwork,
    createPriceOracle,
    isFiatRateSourceUrl,
    getMarkets,
    getMarket,
    getMarketHistory,
    getMarketOrders,
    getOrderbook,
    ordersForToken,
    ordersForAddress,
    orderCancelsForAddress,
    orderDetail,
    swapsForToken,
    swapsForAddress,
    swapCancelsForAddress,
    swapDetail,
    orderLifecycleFor,
    swapLifecycleFor,
    historyForToken,
    genesisForToken,
    subtokensForTick,
    listWatchlistForWallet,
    saveWatchlistEntry,
    clearWatchlistEntry,
    listAlertsForWallet,
    saveAlert,
    clearAlert,
    rearmAlert,
    getSettings,
    updateSettings,
    collectPairingKeys,
    buildPairingPayload,
    encodePairingPayload,
    pairPartner,
    exportBackupFile,
    importBackupFile,
    restoreFromBackupPointer,
    removeWallet,
    signMessageFlow,
    signPsbtFlow,
    checkReachability,
    revealMnemonic,
    dryRunRestore,
    prepareLabelsPublication,
    submitLabelsPublication,
    publishLabelsNow,
    createLabelSyncScheduler,
    importWif,
    diagnosticDump,
    listBlockedOrigins,
    addBlockedOrigin,
    removeBlockedOrigin,
    isOriginBlocked,
    listBlocklistAuditLog,
    clearBlocklistAuditLog,
    refreshChainRegistry,
    createChainRegistryStatus,
    listCustomChains,
    addCustomChain,
    removeCustomChain,
    getDividendRecipients,
    getAirdropRecipients,
    createSignThrottle,
    planRbfReplacement,
} = flows;

/**
 * §19.5.2 restore half, run right after an import while the password is in
 * scope, and never allowed to fail the import around it. The flow already
 * swallows explorer errors per chain; this guard covers the rest (a vault
 * write refused, a wallet record the flow cannot open) and turns it into a
 * `null` the import screen reads as "nothing restored", not "import failed".
 *
 * @param {{ vault: any, walletId: string, password: unknown, bip39Passphrase?: unknown, chainIds?: unknown, sdkRegistry: any, onConflict: 'overwrite' | 'preserve' }} opts
 */
async function restoreLabelSyncBestEffort({ vault, walletId, password, bip39Passphrase, chainIds, sdkRegistry, onConflict }) {
    if (typeof password !== 'string' || password.length === 0) return null;
    try {
        return await restoreLabelSyncAfterImport({
            vault,
            walletId,
            password,
            bip39Passphrase: typeof bip39Passphrase === 'string' ? bip39Passphrase : '',
            chainIds: Array.isArray(chainIds) ? chainIds : [],
            sdkRegistry,
            onConflict,
        });
    } catch (err) {
        console.error('[xchain-wallet/host] label-sync restore skipped:', err);
        return null;
    }
}

/**
 * Group a wallet's addresses by chainId. No SDK calls, no password:
 * used by the Receive view to know which chains have existing addresses
 * before the user picks one. Returns `{}` when the wallet has no
 * accounts yet (fresh-import edge case).
 *
 * @param {{ walletId: string }} req
 * @param {{ vault: import('@xchain-wallet/core').storage.Vault, chainRegistry: import('@xchain-wallet/core').registry.ChainRegistry }} deps
 * @returns {Promise<Record<string, import('@xchain-wallet/core').schemas.Address[]>>}
 */
async function addressesByChain(req, { vault, chainRegistry }) {
    const walletId = /** @type {any} */ (req)?.walletId;
    const accountId = /** @type {any} */ (req)?.accountId;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('addresses.byChain: walletId is required');
    }
    const accounts = await vault.accounts.findBy('walletId', walletId);
    let accountIds;
    if (typeof accountId === 'string' && accountId.length > 0) {
        if (!accounts.some((a) => a.id === accountId)) {
            throw new Error(`addresses.byChain: account "${accountId}" does not belong to wallet "${walletId}"`);
        }
        accountIds = new Set([accountId]);
    } else {
        accountIds = new Set(accounts.map((a) => a.id));
    }
    // Imported-WIF addresses carry accountId=null by design (§11.3.3),
    // so the account filter below drops them and the key becomes
    // invisible on every surface this map feeds. The wallet's
    // importedKeys array is the link that scopes them to THIS wallet.
    // They are wallet-scoped, not account-scoped, so they belong in the
    // result even when one account was asked for - AddressList always
    // passes the active account id, and its "Imported" filter exists to
    // show exactly these.
    //
    // The rule lives in flows/_importedAddressIds.js and is read from
    // there, never restated here: this is the query AddressList
    // actually calls, so an inline copy is the one that would keep
    // shipping the D-63 defect while the shared resolver looked correct.
    const importedAddressIds = await importedAddressIdsFor(vault, walletId);
    if (accountIds.size === 0 && importedAddressIds.size === 0) return {};
    // Read activeNetwork once per call so every UI surface that consumes
    // this map (Home, History, AddressList, Send, every action form's
    // chain picker) sees the same filtered set without each having to
    // re-implement the filter. A failure to read settings (vault not
    // open, corrupted record) falls through to the unfiltered behavior
    // so this code path never blocks the wallet from booting.
    let activeNetwork = null;
    try {
        const settings = await vault.settings.get();
        activeNetwork = getActiveNetwork(settings);
    } catch {
        // pass through unfiltered
    }
    const all = await vault.addresses.list();
    /** @type {Record<string, any[]>} */
    const byChain = {};
    for (const a of all) {
        const belongs = a.accountId
            ? accountIds.has(a.accountId)
            : importedAddressIds.has(a.id);
        if (!belongs) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        if (activeNetwork) {
            const descriptor = chainRegistry.descriptorFor(chainId);
            if (!descriptor || descriptor.networkKind !== activeNetwork) continue;
        }
        if (!byChain[chainId]) byChain[chainId] = [];
        byChain[chainId].push(a);
    }
    return byChain;
}

/**
 * Every wallet's public addresses in one answer, for the My Wallets search.
 * The count of vault reads is fixed (wallets, accounts, addresses, settings),
 * never one per wallet. An address belongs to a wallet through its account, or
 * through the wallet's importedKeys for an imported-WIF record with no account,
 * and the active-network filter matches `addresses.byChain`. Public address
 * strings only: no label, key, path or other record field leaves the host.
 *
 * @param {unknown} _req
 * @param {{ vault: import('@xchain-wallet/core').storage.Vault, chainRegistry: import('@xchain-wallet/core').registry.ChainRegistry }} deps
 * @returns {Promise<Record<string, string[]>>} walletId to its address strings
 */
async function addressesByWallet(_req, { vault, chainRegistry }) {
    const [wallets, accounts, all] = await Promise.all([
        vault.wallets.list(),
        vault.accounts.list(),
        vault.addresses.list(),
    ]);
    let activeNetwork = null;
    try {
        activeNetwork = getActiveNetwork(await vault.settings.get());
    } catch {
        // pass through unfiltered, as addresses.byChain does
    }
    /** @type {Map<string, string>} */
    const walletOfAccount = new Map();
    for (const account of accounts) walletOfAccount.set(account.id, account.walletId);
    /** @type {Map<string, string>} */
    const walletOfImported = new Map();
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const wallet of wallets) {
        out[wallet.id] = [];
        const keys = Array.isArray(wallet.importedKeys) ? wallet.importedKeys : [];
        for (const key of keys) {
            if (typeof key?.addressId === 'string' && key.addressId.length > 0) {
                walletOfImported.set(key.addressId, wallet.id);
            }
        }
    }
    for (const a of all) {
        const walletId = a.accountId ? walletOfAccount.get(a.accountId) : walletOfImported.get(a.id);
        if (!walletId || !out[walletId] || typeof a.address !== 'string' || a.address.length === 0) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        if (activeNetwork) {
            const descriptor = chainRegistry.descriptorFor(chainId);
            if (!descriptor || descriptor.networkKind !== activeNetwork) continue;
        }
        out[walletId].push(a.address);
    }
    return out;
}

/**
 * confirm-path preamble shared by every `*.composeForConfirm` route:
 * settle where the change output pays, then collect the wallet's own
 * addresses on that chain for the tamper check.
 *
 * Both halves in ONE place because they are coupled. Settings > Privacy's
 * "fresh change address for every send" rotates change onto a newly derived
 * internal address, and `buildExpectedOutputs` treats a payment to an
 * address the wallet does not claim as tampering. Deriving the address
 * after the own-address list was built would make every rotated send fail
 * its own confirm check.
 *
 * The rotation happens HERE rather than in submitAction because the
 * single-encode pipeline builds the PSBT at this step and signs
 * those exact bytes on Approve; a change address chosen later would never
 * reach the wire.
 *
 * Needs an unlocked signer to derive, so it is a no-op on a locked wallet
 * (per-op-password flows), which `resolveChangeAddress` degrades to the
 * spending address for.
 *
 * @param {Object} args
 * @param {any} args.req
 * @param {import('@xchain-wallet/core').storage.Vault} args.vault
 * @param {import('@xchain-wallet/core').registry.ChainRegistry} args.chainRegistry
 * @param {import('@xchain-wallet/core').signers.SignerPool} [args.signerPool]
 * @param {string} args.chainId              the chain the tx is funded and broadcast on
 * @param {string} args.sourceAddress
 * @returns {Promise<{ change: string, ownAddresses: string[] }>}
 */
async function confirmChangeAndOwnAddresses({
    req, vault, chainRegistry, signerPool, chainId, sourceAddress,
}) {
    let change = sourceAddress;
    try {
        const signer = signerPool && typeof signerPool.get === 'function'
            ? signerPool.get(req?.walletId)
            : null;
        if (signer) {
            const resolved = await flows.resolveChangeAddress({
                vault,
                walletId: req?.walletId,
                signer,
                chainRegistry,
                chainId,
                sourceAddress,
                settings: await vault.settings.get(),
            });
            if (resolved?.address) change = resolved.address;
        }
    } catch {
        // Fail open to the spending address: a privacy preference must never
        // be why a transaction cannot be composed.
    }

    // Own addresses on this chain: change back to any of them is not a
    // tamper. Best-effort - the source and change addresses are always
    // added, so a resolve failure only loosens change detection to those.
    let ownAddresses = [sourceAddress];
    try {
        const byChain = await addressesByChain(req, { vault, chainRegistry });
        const rows = byChain?.[chainId] || [];
        ownAddresses = rows.map((r) => r.address).filter(Boolean);
    } catch {
        // fall through to [sourceAddress]
    }
    if (!ownAddresses.includes(sourceAddress)) ownAddresses.push(sourceAddress);
    if (!ownAddresses.includes(change)) ownAddresses.push(change);
    return { change, ownAddresses };
}

/**
 * Second half of that preamble: harden the encoder opts for a device source.
 *
 * A device source needs each segwit input's FULL previous transaction in the
 * PSBT. Ledger takes the outpoint it signs from those bytes rather than from
 * the PSBT's own txid, so a witnessUtxo-only input - which is what the encoder
 * builds by default, for the default address type - cannot be signed on
 * hardware at all.
 *
 * Requested HERE, at the single compose, rather than hydrated later: §5.3's
 * guarantee is that the PSBT the user previewed is the one that gets signed,
 * and adding inputs' prev txs after the tamper check would mean signing bytes
 * nobody checked. Software sources do not ask for it, so they keep today's
 * PSBT size on a path that crosses the messaging boundary and now also lands
 * in storage.session (§5.4).
 *
 * Shared rather than inlined, because inlined it was copied by two routes and
 * forgotten by the three per-action clones of the preamble, which left a
 * VOTE, MESSAGE or BET from a device address composing an unsignable PSBT.
 *
 * The device decision reads the vault's own record of the spending address
 * as well as the request's claim: a request that omits or misstates `source`
 * for a device address would otherwise compose a PSBT the device cannot sign.
 * Either side naming a device hardens, since the extra bytes cost size only.
 *
 * @param {any} vault
 * @param {any} req
 * @param {Object} encoderOpts
 * @returns {Promise<Object>}
 */
async function deviceHardenedEncoderOpts(vault, req, encoderOpts) {
    const stored = await envelopeSignerOf(vault, req);
    if (isDeviceSource(stored?.source) || isDeviceSource(req?.from?.source)) {
        return { ...encoderOpts, attachPrevTx: true };
    }
    return encoderOpts;
}

function isDeviceSource(source) {
    return schemas.isDeviceAddressSource(source);
}

/**
 * The spending Address record that decides whether an oversized payload may
 * ride the Taproot envelope: the vault's own record when the request names one,
 * else the request's `from`. A wrong claim cannot strand coin, because the
 * submit path signs the reveal before it broadcasts the commit.
 *
 * @param {any} vault
 * @param {any} req
 * @returns {Promise<{ source?: string }|null>}
 */
async function envelopeSignerOf(vault, req) {
    const id = req?.from?.addressId;
    if (typeof id === 'string' && id.length > 0) {
        // An unreadable record falls back to the request, never to a guess.
        try {
            const record = await vault.addresses.get(id);
            if (record) return record;
        } catch { /* fall through */ }
    }
    return req?.from && typeof req.from === 'object' ? req.from : null;
}

/**
 * Look up the Address record a `action.*.hw` handler needs to resolve
 * the right SignerRecord. The request carries `from.addressId` (the
 * Address record's id, filled by the form) OR a plain `from` triple
 * from the form. We fetch the live Address so `resolveSigner` has
 * the canonical `source` + `signerId` fields.
 *
 * The record must belong to an account of the request's wallet: the vault
 * holds every wallet's addresses, and a record found by id or by string from
 * another wallet would bind that wallet's device to this wallet's spend.
 *
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @param {any} req
 * @param {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @returns {Promise<import('@xchain-wallet/core').schemas.Address>}
 */
async function loadAddressForHwSigning(vault, req, chainRegistry) {
    const walletId = req?.walletId;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('action.*.hw: walletId is required');
    }
    const fromAddressId = req?.from?.addressId;
    if (typeof fromAddressId === 'string' && fromAddressId.length > 0) {
        const addr = await vault.addresses.get(fromAddressId);
        if (addr) {
            await assertAddressInWallet(vault, addr, walletId);
            if (!addressOnRequestChain(addr, req, chainRegistry)) {
                throw new Error('action.*.hw: source address is not on the request chain');
            }
            assertRequestMatchesStoredSource(req, addr);
            return addr;
        }
    }
    // Fallback: find by address string within this wallet and chain, for a
    // form that omits addressId. The vault lists every wallet's addresses, so
    // a string shared with another wallet, network or watch-only copy is
    // filtered out and more than one survivor is refused rather than picked.
    if (req?.from?.address) {
        const all = await vault.addresses.list();
        const matches = [];
        for (const a of all) {
            if (a.address !== req.from.address) continue;
            if (!(await addressInWallet(vault, a, walletId))) continue;
            if (!addressOnRequestChain(a, req, chainRegistry)) continue;
            matches.push(a);
        }
        if (matches.length === 1) {
            assertRequestMatchesStoredSource(req, matches[0]);
            return matches[0];
        }
        if (matches.length > 1) {
            throw new Error('action.*.hw: more than one address in this wallet matches; pick the address by id');
        }
    }
    throw new Error('action.*.hw: could not resolve source address record');
}

/** True when the Address belongs to an account of the wallet. */
async function addressInWallet(vault, address, walletId) {
    if (typeof address?.accountId !== 'string' || address.accountId.length === 0) return false;
    const account = await vault.accounts.get(address.accountId);
    return account?.walletId === walletId;
}

async function assertAddressInWallet(vault, address, walletId) {
    if (!(await addressInWallet(vault, address, walletId))) {
        throw new Error('hardware signing: the source address is not in this wallet');
    }
}

// A message is funded on the delivery chain, which is not always the chain
// the request names for the recipient.
function addressOnRequestChain(address, req, chainRegistry) {
    const chainId = req?.broadcastChainId || req?.chainId;
    if (typeof chainId !== 'string' || chainId.length === 0) return true;
    return chainRegistry.chainIdFor(address.chain, address.network) === chainId;
}

function assertRequestMatchesStoredSource(req, record) {
    const from = req?.from;
    if (!from || typeof from !== 'object') return;
    if (typeof from.addressId === 'string' && typeof from.id === 'string'
        && from.addressId !== from.id) {
        throw new Error('signing request names two different source address ids');
    }
    for (const field of ['address', 'publicKey']) {
        if (from[field] != null && from[field] !== record[field]) {
            throw new Error(`signing request's from.${field} does not match stored address "${record.id}"`);
        }
    }
    const requestedPath = from.derivationPath == null || from.derivationPath === '' ? '' : from.derivationPath;
    const storedPath = record.derivationPath == null || record.derivationPath === '' ? '' : record.derivationPath;
    if (requestedPath !== storedPath && Object.prototype.hasOwnProperty.call(from, 'derivationPath')) {
        throw new Error(`signing request's from.derivationPath does not match stored address "${record.id}"`);
    }
}

/**
 * Pick the right Signer instance for an HD-derive request (account.create,
 * receive.getAddress) given an optional `signerId` on the request.
 * §17.6 / G023.
 *
 *   - signerId omitted / null → use the SignerPool's pre-unlocked
 *     SoftwareSigner for this wallet (no password). When the pool has
 *     no entry, returns null and the calling flow falls back to the
 *     password-unlock path it already supports.
 *   - signerId names a paired HW SignerRecord → look up the record,
 *     fetch the renderer-side transport from the signer bridge, and
 *     return a RemoteSigner. Throws when the record is unknown,
 *     belongs to a different wallet, or the bridge isn't connected.
 *
 * @param {object} args
 * @param {import('@xchain-wallet/core').storage.Vault} args.vault
 * @param {string} args.walletId
 * @param {string | null} [args.signerId]
 * @param {import('@xchain-wallet/core').signers.SignerPool} [args.signerPool]
 * @returns {Promise<import('@xchain-wallet/core').signers.Signer | null>}
 */
async function pickSignerFromRequest({ vault, walletId, signerId, signerPool }) {
    if (typeof walletId !== 'string' || walletId.length === 0) return null;
    if (typeof signerId === 'string' && signerId.length > 0) {
        // The vault's collections answer `get`; `find` was never one of them.
        const record = await getSignerRecord(vault, signerId);
        if (!record) {
            throw new Error(`signerId "${signerId}" is not a paired signer.`);
        }
        if (record.walletId !== walletId) {
            throw new Error(`signerId "${signerId}" belongs to a different wallet.`);
        }
        if (!schemas.isDeviceSignerKind(record.kind)) {
            throw new Error(`signerId "${signerId}" is not a hardware wallet.`);
        }
        // Throws with code HW_NOT_CONNECTED when the device has no live transport.
        const transport = signerBridge.requireTransport(record.id);
        const descriptor = { kind: record.kind, address: null, signerRecord: record };
        return buildRemoteSigner(descriptor, transport);
    }
    if (signerPool && typeof signerPool.get === 'function') {
        return signerPool.get(walletId) || null;
    }
    return null;
}

/**
 * The stored hardware address a receive.verifyAddress request names and a
 * RemoteSigner for the device that address is linked to. A request's own
 * `signerId` may only repeat that link; an address with no device link
 * (a migrated record whose signerId is still null) is refused, not handed
 * to another signer.
 *
 * @param {any} req
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @returns {Promise<{ address: any, signer: import('@xchain-wallet/core').signers.Signer }>}
 */
async function linkedDeviceSignerForVerify(req, vault) {
    const walletId = req?.walletId;
    const addressId = req?.addressId;
    if (typeof walletId !== 'string' || !walletId) throw new Error('receive.verifyAddress: walletId is required');
    if (typeof addressId !== 'string' || !addressId) throw new Error('receive.verifyAddress: addressId is required');
    const address = await vault.addresses.get(addressId);
    if (!address) throw new Error(`receive.verifyAddress: address "${addressId}" not found`);
    await assertAddressInWallet(vault, address, walletId);
    if (!isDeviceSource(address.source)) {
        throw new Error('receive.verifyAddress: on-device verification is only for hardware addresses');
    }
    if (!address.signerId) {
        throw new Error('receive.verifyAddress: this address is not linked to a paired hardware wallet; re-pair it');
    }
    const descriptor = await resolveSigner({ vault, address });
    if (!schemas.isDeviceSignerKind(descriptor.kind)) {
        throw new Error('receive.verifyAddress: on-device verification is only for hardware addresses');
    }
    const requested = req?.signerId;
    if (typeof requested === 'string' && requested.length > 0 && requested !== descriptor.signerRecord.id) {
        throw new Error('receive.verifyAddress: the request names a different device than this address is linked to');
    }
    // Throws with code HW_NOT_CONNECTED when the device has no live transport.
    const transport = signerBridge.requireTransport(descriptor.signerRecord.id);
    return { address, signer: buildRemoteSigner(descriptor, transport) };
}

/**
 * The unlocked session's software signer for a wallet and its vault master
 * key, when the request carries no password and the pool holds that signer;
 * null otherwise (a typed password always wins). The label-sync routes use
 * it to open the seed and sign without asking again, as wallet.importWif
 * does (operator preference 2026-11-14). The key is the signer's own buffer:
 * the flows copy it and never zero it.
 *
 * @param {import('@xchain-wallet/core').signers.SignerPool | undefined} signerPool
 * @param {unknown} walletId
 * @param {unknown} password
 * @returns {{ signer: any, masterKey: Uint8Array } | null}
 */
function pooledSoftwareSession(signerPool, walletId, password) {
    if (typeof password === 'string' && password.length > 0) return null;
    if (typeof walletId !== 'string' || !walletId) return null;
    const pooled = signerPool && typeof signerPool.get === 'function' ? signerPool.get(walletId) : null;
    if (!pooled || pooled.kind !== 'software' || typeof pooled.getMasterKey !== 'function') return null;
    let masterKey = null;
    try { masterKey = pooled.getMasterKey(); } catch { return null; }
    return masterKey instanceof Uint8Array && masterKey.length > 0 ? { signer: pooled, masterKey } : null;
}

/**
 * The unlocked session's software signer for an extended public key export,
 * or null. A typed password always wins (the caller then unlocks with it),
 * and a device signer is never returned: the export reads only account-level
 * public keys from the seed the session already holds.
 *
 * @param {import('@xchain-wallet/core').signers.SignerPool | undefined} signerPool
 * @param {string} walletId
 * @param {unknown} password
 * @returns {any | null}
 */
function publicExportSigner(signerPool, walletId, password) {
    if (typeof password === 'string' && password.length > 0) return null;
    const pooled = signerPool && typeof signerPool.get === 'function' ? signerPool.get(walletId) : null;
    if (!pooled || pooled.kind !== 'software' || typeof pooled.getAccountXpub !== 'function') return null;
    return pooled;
}

/**
 * Refuse the label-sync routes for a hardware wallet with the typed no-seed
 * error: the on-chain label copy is sealed with a seed-derived key, which a
 * wallet whose keys live on a device does not have.
 *
 * @param {any} vault
 * @param {unknown} walletId
 */
async function refuseHardwareLabelSync(vault, walletId) {
    if (typeof walletId !== 'string' || !walletId || typeof vault?.wallets?.get !== 'function') return;
    if (isHardwareWallet(await vault.wallets.get(walletId))) throw new HardwareWalletHasNoSeedError();
}

/**
 * Resolve the signer to pass into a signing/decrypt action flow:
 *   - HW request (req.signerId) → the paired RemoteSigner.
 *   - Unlocked software session → the pre-unlocked pooled SoftwareSigner,
 *     so the flow skips the password prompt ("password only at unlock").
 *   - Otherwise `undefined` → the flow falls back to its `req.password`
 *     path (locked, passphrase wallet, or a worker restart that couldn't
 *     rehydrate the pool).
 *
 * @param {any} req
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @param {import('@xchain-wallet/core').signers.SignerPool} [signerPool]
 * @returns {Promise<import('@xchain-wallet/core').signers.Signer | undefined>}
 */
// The software-signed action routes whose transaction spends this wallet's
// coins. Each one claims them before it signs (see withSpendClaim).
const SPENDING_ACTION_TYPES = [
    'sweep', 'issue', 'mint', 'destroy', 'callback', 'sleep', 'broadcast', 'oraclePrice', 'addressPrefs',
    'deployChunked', 'dispenser', 'dividend', 'createList', 'airdrop', 'advanced', 'order', 'cancelOrder',
    'editOrder', 'coinpay', 'swap', 'link', 'file', 'fileMultipart', 'gatedPublish', 'message', 'deploy',
    'execute', 'deposit',
    'withdraw', 'stake', 'unstake', 'collect', 'delegate', 'revokeDelegation', 'createPoll', 'castBallot',
    'delegateVote', 'createMarket', 'placeBet', 'resolveMarket', 'cancelMarket', 'editBetFeedLists',
    'clearVoteDelegation', 'contractStake',
].map((name) => `action.${name}`);

// Software-signed routes outside the action.* namespace that spend coins and
// broadcast; each claims them like the action routes above.
const SPENDING_ROUTES_OUTSIDE_ACTIONS = ['messaging.handshake', 'wallet.publishLabels'];

/**
 * The stored Address a signing request names: by id when that resolves, else by
 * the `from.address` string among the request wallet's own addresses, so a
 * request that omits or misstates the id cannot dodge the checks below. Records
 * of one kind sharing the string (a network copy) resolve to the first; records
 * that disagree on source or device are refused rather than picked between.
 * The string lookup applies the id lookup's ownership rule: an account-linked
 * record belongs to its account's wallet, an imported key to the wallet whose
 * importedKeys lists it, and a watch-only record with no account to no wallet,
 * so it is returned for the caller to refuse.
 *
 * @param {any} req
 * @param {any} vault
 * @returns {Promise<any | null>} null when nothing stored matches
 */
async function storedRecordForSigning(req, vault) {
    const named = req?.from?.addressId ?? req?.from?.id ?? req?.addressId;
    if (typeof named === 'string' && named.length > 0) {
        const byId = await vault.addresses.get(named);
        if (byId) {
            if (byId.source !== 'watch-only') {
                const walletId = req?.walletId;
                // Count an imported key through the wallet's importedKeys (it has no account).
                const inWallet = byId.accountId
                    ? await addressInWallet(vault, byId, walletId)
                    : (await importedAddressIdsFor(vault, walletId)).has(byId.id);
                if (!inWallet) {
                    throw new Error('signing request source address is not in this wallet');
                }
            }
            assertRequestMatchesStoredSource(req, byId);
            return byId;
        }
    }
    const walletId = req?.walletId;
    const text = req?.from?.address;
    if (typeof walletId !== 'string' || walletId.length === 0) return null;
    if (typeof text !== 'string' || text.length === 0) return null;
    const matches = [];
    let importedIds = null;
    for (const a of await vault.addresses.list()) {
        if (a.address !== text) continue;
        if (typeof a.accountId === 'string' && a.accountId.length > 0) {
            if (await addressInWallet(vault, a, walletId)) matches.push(a);
        } else if (a.source === 'watch-only') {
            // Owned by no wallet, so no wallet may sign for it: returning it is what refuses it.
            matches.push(a);
        } else {
            // Strict: an unreadable wallet must refuse, not drop the record and skip the source check.
            importedIds ??= await importedAddressIdsForStrict(vault, walletId);
            if (importedIds.has(a.id)) matches.push(a);
        }
    }
    if (matches.every((m) => m.source === matches[0].source && m.signerId === matches[0].signerId)) {
        const record = matches[0] ?? null;
        if (record) assertRequestMatchesStoredSource(req, record);
        return record;
    }
    throw new Error(`address "${text}" matches stored addresses of different kinds in this wallet; pick it by id`);
}

/**
 * Check a signing request's signer choice against the vault's own record of
 * the address it names. The request carries `signerId` and the address id
 * separately, and nothing else ties them: a software address sent with a
 * device `signerId` would be signed by that device, a device address sent
 * with another device's id by the wrong device, and a device address sent with
 * no `signerId` by the wallet's pooled software key.
 *
 * Contradictions throw, and so do a watch-only address and a device address
 * that names no device: the flow would fall back to unlocking the wallet's
 * software seed and sign the address's path with the wrong key. A route whose
 * flow refuses those two itself, or that signs nothing, passes `leaveToFlow`
 * and gets back true for a device address that names no device, which means
 * "hand the flow no signer". A record that cannot be found is left to the
 * flow, which reports the missing address. A request with no id is resolved by
 * its address string within the request wallet before that rule applies.
 *
 * @param {any} req
 * @param {any} vault
 * @param {boolean} leaveToFlow
 * @returns {Promise<boolean>} true when the pooled signer must not be used
 */
async function checkSignerAgainstStoredAddress(req, vault, leaveToFlow) {
    const record = await storedRecordForSigning(req, vault);
    if (!record) return false;
    const named = record.id;
    const signerId = typeof req?.signerId === 'string' && req.signerId.length > 0 ? req.signerId : null;
    if (record.source === 'watch-only') {
        if (leaveToFlow) return false;
        throw new Error(`address "${named}" is watch-only; it has no signer`);
    }
    if (isDeviceSource(record.source)) {
        if (signerId === null && leaveToFlow) return true;
        if (signerId !== record.signerId) {
            throw new Error(`address "${named}" is a ${record.source} address; sign it with its own device`);
        }
        await resolveSigner({ vault, address: record });
        return false;
    }
    if (signerId !== null) {
        throw new Error(`address "${named}" is not a hardware address; \`signerId\` does not apply`);
    }
    return false;
}

/** sessionSigner for a route whose flow refuses device and watch-only addresses itself, or signs nothing. */
function flowCheckedSigner(req, vault, signerPool) {
    return sessionSigner(req, vault, signerPool, { leaveToFlow: true });
}

async function sessionSigner(req, vault, signerPool, { leaveToFlow = false } = {}) {
    if (await checkSignerAgainstStoredAddress(req, vault, leaveToFlow)) return undefined;
    const signer = await pickSignerFromRequest({
        vault,
        walletId: req?.walletId,
        signerId: req?.signerId,
        signerPool,
    });
    return signer || undefined;
}

/**
 * sessionSigner for a route that names its addresses in `addressIds`: each
 * one gets the stored-address check a single-address route gets, so the
 * pooled signer is never handed out for an address the host would refuse.
 */
async function sessionSignerForAddressIds(req, vault, signerPool) {
    const ids = Array.isArray(req?.addressIds) ? req.addressIds : [];
    for (const addressId of ids) {
        if (typeof addressId !== 'string' || addressId.length === 0) continue;
        await checkSignerAgainstStoredAddress({ walletId: req?.walletId, signerId: req?.signerId, addressId }, vault, false);
    }
    return sessionSigner(req, vault, signerPool);
}

function hwId(address, deps) {
    const chainId = deps.chainRegistry.chainIdFor(address.chain, address.network);
    if (!chainId) {
        throw new Error(`auth.signPsbt.hw: no chain id for chain "${address.chain}" and network "${address.network}"`);
    }
    return chainId;
}

async function softwarePsbtAddress({ vault, addressId, walletId, signerId }) {
    const address = await vault.addresses.get(addressId);
    if (!address) throw new Error(`auth.signPsbt: address "${addressId}" not found`);
    const descriptor = await resolveSigner({ vault, address });
    if (descriptor.kind !== 'software') {
        throw new Error(
            `auth.signPsbt: address "${addressId}" is a ${descriptor.kind} hardware address; use auth.signPsbt.hw`,
        );
    }
    if (typeof signerId === 'string' && signerId.length > 0) {
        throw new Error('auth.signPsbt: signerId is not accepted; hardware signing uses auth.signPsbt.hw');
    }
    const isHd = address.source === 'hd' && typeof address.derivationPath === 'string';
    if (isHd) {
        const account = typeof address.accountId === 'string' && address.accountId
            ? await vault.accounts.get(address.accountId)
            : null;
        if (!account || account.walletId !== walletId) {
            throw new Error(`auth.signPsbt: address "${addressId}" is not in this wallet`);
        }
    }
    return { address, isHd };
}

/**
 * Return the newest (highest external index) derivable address for a wallet
 * and chain, or `null` if no address exists. External = change = 0 in the
 * BIP44-style derivation path. Skips imported WIFs because those have no
 * "receive next" concept.
 *
 * @param {{ walletId: string, chainId: string, addressType?: string }} req
 * @param {{ vault: import('@xchain-wallet/core').storage.Vault, chainRegistry: import('@xchain-wallet/core').registry.ChainRegistry }} deps
 * @returns {Promise<import('@xchain-wallet/core').schemas.Address | null>}
 */
async function newestAddress(req, { vault, chainRegistry }) {
    const walletId = /** @type {any} */ (req)?.walletId;
    const accountId = /** @type {any} */ (req)?.accountId;
    const chainId = /** @type {any} */ (req)?.chainId;
    const addressType = /** @type {any} */ (req)?.addressType;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('addresses.newest: walletId is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('addresses.newest: chainId is required');
    }
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`addresses.newest: unknown chain "${chainId}"`);
    }
    // Not `descriptor.defaultAddressType`: a counterwallet-legacy wallet
    // stores p2pkh addresses, so the chain default matches none of them
    // and Receive would report the wallet as having no address at all
    const type = addressType
        ?? await flows.defaultAddressTypeForWallet(vault, walletId, descriptor);

    const accounts = await vault.accounts.findBy('walletId', walletId);
    let accountIds;
    if (typeof accountId === 'string' && accountId.length > 0) {
        if (!accounts.some((a) => a.id === accountId)) {
            throw new Error(`addresses.newest: account "${accountId}" does not belong to wallet "${walletId}"`);
        }
        accountIds = new Set([accountId]);
    } else {
        accountIds = new Set(accounts.map((a) => a.id));
    }
    if (accountIds.size === 0) return null;

    const all = await vault.addresses.list();
    let winner = null;
    let winnerIdx = -1;
    for (const a of all) {
        if (!accountIds.has(a.accountId)) continue;
        if (a.chain !== descriptor.coin) continue;
        if (a.network !== descriptor.networkKind) continue;
        if (a.addressType !== type) continue;
        if (!['hd', 'watch-only'].includes(a.source) && !schemas.isDeviceAddressSource(a.source)) continue;
        if (typeof a.derivationPath !== 'string') continue;
        const parts = a.derivationPath.split('/');
        if (parts.length < 2) continue;
        if (parts[parts.length - 2] !== '0') continue;  // external only
        const idx = Number(parts[parts.length - 1]);
        if (!Number.isFinite(idx)) continue;
        if (idx > winnerIdx) {
            winner = a;
            winnerIdx = idx;
        }
    }
    return winner;
}

/**
 * Strip sensitive fields before handing a Wallet record to the popup/UI.
 * @param {import('@xchain-wallet/core').schemas.Wallet} w
 */
function pickHubUrlFromRegistry(chainRegistry) {
    if (!chainRegistry || typeof chainRegistry.supportedChains !== 'function') return null;
    const chains = chainRegistry.supportedChains();
    for (const d of chains) {
        if (d?.networkKind === 'mainnet' && d?.hub?.defaultUrl) {
            const port = d.hub.defaultPort;
            const base = d.hub.defaultUrl.replace(/\/+$/, '');
            return port && port !== 443 && port !== 80 ? `${base}:${port}` : base;
        }
    }
    return null;
}

/**
 * The PendingTx patch a permanent queue-retry verdict writes: 'failed', unless the
 * entry is a reveal or phase-2 whose commit landed, which stays 'broadcast' on the
 * commit's txid (the rule submitAction applies, so the commit's spend stays netted).
 *
 * @param {{ commitLanded?: boolean, commitTxid?: string, txid?: string }} entry
 * @param {string} failure
 * @returns {object}
 */
function permanentReleasePatch(entry, failure) {
    if (entry?.commitLanded !== true) return { status: 'failed', error: failure };
    return {
        status: 'broadcast',
        broadcastAt: new Date().toISOString(),
        txid: entry.commitTxid ?? entry.txid ?? null,
        error: failure,
    };
}

/**
 * The refusal a queued entry settles with when its inputs are spent and the chain,
 * not a node, said why. `conflict` retires the entry as permanent, `unknown` backs
 * it off as transient. The settlement reads the same text classifier it applies to
 * a node's refusal, so each wording is chosen to land on its side of that split
 * (spent-conflict wording is permanent; a network-read failure is transient), and
 * neither reads as "already on the network".
 *
 * @param {'conflict'|'unknown'} verdict
 * @returns {Error}
 */
function spentInputsError(verdict) {
    return new Error(verdict === 'conflict'
        ? 'The coins this transaction spends were already spent by another transaction, so it can never confirm. Compose a fresh transaction.'
        : 'The coins this transaction spends appear spent, but the network could not confirm whether this transaction landed. Check your history before discarding it.');
}

const QUEUED_BROADCAST_RETRY_BASE_MS = 1_000;
const QUEUED_BROADCAST_RETRY_MAX_MS = 60_000;

function queuedBroadcastRetryDelay(attempt) {
    const exponent = Math.max(0, Math.min(16, attempt - 1));
    return Math.min(QUEUED_BROADCAST_RETRY_MAX_MS, QUEUED_BROADCAST_RETRY_BASE_MS * (2 ** exponent));
}

async function retainReplacementPlan(vault, result, fallbackPsbtHex, requestedRbf, descriptor) {
    // Record the RBF the encoder was allowed to signal, not the one the caller asked for.
    const rbf = capRbfToDescriptor(descriptor, { rbf: requestedRbf }).rbf;
    const pendingTxId = result?.pendingTxId;
    const psbtHex = result?.signed?.signedPsbtHex || fallbackPsbtHex;
    if (typeof pendingTxId !== 'string' || !pendingTxId
        || typeof psbtHex !== 'string' || !psbtHex
        || typeof vault?.pendingTxs?.get !== 'function') return result;
    try {
        const record = await vault.pendingTxs.get(pendingTxId);
        const coreOwnsPlan = typeof record?.psbtHex === 'string' && record.psbtHex
            && Object.prototype.hasOwnProperty.call(record, 'rbf');
        if (coreOwnsPlan) return result;
        if (record) await vault.pendingTxs.put({
            ...record,
            psbtHex,
            ...(typeof rbf === 'boolean' ? { rbf } : {}),
        });
    } catch { /* non-critical after a successful broadcast */ }
    return result;
}

function assertReplacementPsbt({ replacement, plan, actionString, decodeActionStringFromPsbt, psbtHex }) {
    const exact = (value, label) => {
        if (typeof value === 'bigint' && value >= 0n) return value;
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
        if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
        throw new Error(`tx.replace: replacement ${label} is not an exact satoshi amount`);
    };
    if (!replacement || !Array.isArray(replacement.inputs) || !Array.isArray(replacement.outputs)) {
        throw new Error('tx.replace: replacement PSBT could not be inspected');
    }
    const expectedInputs = plan.encoderOpts.utxos;
    if (replacement.inputs.length !== expectedInputs.length) {
        throw new Error('tx.replace: encoder changed the replacement input count');
    }
    for (let i = 0; i < expectedInputs.length; i += 1) {
        const got = replacement.inputs[i];
        const want = expectedInputs[i];
        if (String(got?.prevTxHash || '').toLowerCase() !== want.txid
            || Number(got?.prevTxIndex) !== want.vout
            || exact(got?.value, `input ${i}`) !== exact(want.value, `planned input ${i}`)
            || String(got?.scriptPubKeyHex || '').toLowerCase() !== want.scriptPubKey
            || !Number.isInteger(got?.sequence)
            || got.sequence >= 0xfffffffe) {
            throw new Error(`tx.replace: encoder changed replacement input ${i}`);
        }
    }

    const consumed = new Set();
    for (const wanted of plan.encoderOpts.customOutputs) {
        const index = replacement.outputs.findIndex((output, candidate) => (
            !consumed.has(candidate)
            && output?.address === wanted.address
            && exact(output?.value, `output ${candidate}`) === exact(wanted.value, 'planned output')
        ));
        if (index < 0) throw new Error('tx.replace: encoder changed a replacement payment');
        consumed.add(index);
    }
    let changeTotal = 0n;
    let changeCount = 0;
    let carrierCount = 0;
    for (let i = 0; i < replacement.outputs.length; i += 1) {
        if (consumed.has(i)) continue;
        const output = replacement.outputs[i];
        const value = exact(output?.value, `output ${i}`);
        const carrier = actionString && value === 0n
            && String(output?.scriptPubKeyHex || '').toLowerCase().startsWith('6a');
        if (carrier) {
            carrierCount += 1;
            continue;
        }
        if (output?.address !== plan.encoderOpts.change) {
            throw new Error(`tx.replace: encoder added unexpected output ${i}`);
        }
        changeCount += 1;
        changeTotal += value;
    }

    const inputTotal = expectedInputs.reduce((sum, input) => sum + exact(input.value, 'planned input'), 0n);
    const fixedTotal = plan.encoderOpts.customOutputs
        .reduce((sum, output) => sum + exact(output.value, 'planned output'), 0n);
    const expectedChange = inputTotal - fixedTotal - BigInt(plan.replacementFeeSats);
    const expectedChangeCount = expectedChange > 0n ? 1 : 0;
    if (changeTotal !== expectedChange || changeCount !== expectedChangeCount) {
        throw new Error('tx.replace: encoder changed the replacement fee or change amount');
    }
    if (actionString) {
        if (carrierCount !== 1) {
            throw new Error('tx.replace: encoder changed the replacement action carrier');
        }
        const decoded = decodeActionStringFromPsbt(psbtHex);
        const encodedAction = typeof decoded === 'string' ? decoded : decoded?.actionString;
        if (decoded?.ok === false || encodedAction !== actionString) {
            throw new Error('tx.replace: encoder changed the replacement action');
        }
    }
}

const NETWORK_SWITCH_CANCEL_REASON = 'Network changed, request cancelled';

async function cancelMatchingApprovals(approvals, matches) {
    if (typeof approvals?.cancelOriginsMatching !== 'function') return 0;
    return approvals.cancelOriginsMatching(matches);
}

async function emitSiteDisconnect(bridgeEvents, origin, reason = 'user-requested') {
    if (typeof bridgeEvents?.disconnect !== 'function') return;
    await bridgeEvents.disconnect(origin, reason);
}

/**
 * Read the selected wallet's accounts and the connected sites straight from
 * the vault and hand both to the bridge broadcaster.
 */
async function announceWalletSwitch(req, vault, bridgeEvents) {
    const walletId = req?.walletId;
    // Refuse a missing or unknown wallet id instead of announcing nothing as a switch.
    if (typeof walletId !== 'string' || !walletId) {
        throw new Error('wallet.setActive: walletId is required');
    }
    if ((await vault.wallets.get(walletId)) === null) {
        throw new Error('wallet.setActive: unknown walletId');
    }
    // Shells with no dApp bridge (web, desktop) have nothing to notify.
    if (typeof bridgeEvents?.walletSwitched !== 'function') return { ok: true };
    const accounts = [...(await vault.accounts.findBy('walletId', walletId))]
        .sort((a, b) => a.index - b.index);
    const sites = await vault.connectedSites.list();
    await bridgeEvents.walletSwitched(accounts, sites);
    return { ok: true };
}

async function announceNetworkChange(previous, next, vault, chainRegistry, bridgeEvents, approvals) {
    if (getActiveNetwork(previous) === getActiveNetwork(next)) return;
    // An open approval was composed for the network it was requested on, so a
    // switch rejects every one of them (the dApp sees USER_REJECTED) and closes
    // the windows before the new network is announced.
    if (typeof approvals?.cancelAll === 'function') {
        await approvals.cancelAll(NETWORK_SWITCH_CANCEL_REASON);
    }
    if (typeof bridgeEvents?.chainChanged !== 'function') return;
    const activeChainIds = filterChainIdsByActiveNetwork(
        Object.keys(next?.fees ?? {}),
        next,
        chainRegistry,
    );
    const sites = await vault.connectedSites.list();
    await notifyNetworkChanged({ events: bridgeEvents, sites, activeChainIds });
}

async function announceAccountChange(vault, bridgeEvents, changedAccountIds, sites) {
    if (typeof bridgeEvents?.accountsChanged !== 'function') return;
    const [accounts, connectedSites] = await Promise.all([
        vault.accounts.list(),
        sites ? Promise.resolve(sites) : vault.connectedSites.list(),
    ]);
    await notifyAccountsChanged({
        events: bridgeEvents,
        accounts,
        sites: connectedSites,
        changedAccountIds,
    });
}

function toSafeWallet(w) {
    return {
        schemaVersion: w.schemaVersion,
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        origin: w.origin,
        format: w.format,
        passphraseEnabled: schemas.wallet.usesBip39Passphrase(w),
        // Derived, never the ciphertext itself: lets the UI tell "stored"
        // (unlock needs nothing) apart from "needs its passphrase once"
        // (passphraseEnabled but not yet captured) without ever seeing
        // encryptedPassphrase.
        passphraseStored: typeof w.encryptedPassphrase === 'string' && w.encryptedPassphrase.length > 0,
        multisigs: Array.isArray(w.multisigs) ? w.multisigs : [],
        walletMode: schemas.wallet.walletModeOf(w),
    };
}

/**
 * What the `psbt.parse` handler below answers. Declared once here so every
 * shell's wrapper points at it rather than restating a subset.
 *
 * @typedef {object} ParsedPsbtResult
 * @property {import('../../../core/src/signers/types.js').DecomposedPsbt} decomposed
 * @property {ParsedPsbtAction | null} action   the XChain action carried inside, best-effort; null when it could not be read
 * @property {string | null} actionDecodeReason   why `action` is null (a decoder punt or failure); null when it decoded
 *
 * @typedef {object} ParsedPsbtAction
 * @property {string} actionString
 * @property {string | null} action
 * @property {number | null} version
 * @property {object | null} params
 */

/**
 * @typedef {object} DiagnosticEnv
 * @property {'extension' | 'web' | 'desktop'} [shell]
 * @property {string} [userAgent]
 * @property {string} [platform]
 *
 * @typedef {object} DiagnosticBuild
 * @property {string} [walletVersion]
 * @property {string} [gitSha]
 * @property {string} [target]
 *
 * @typedef {object} DiagnosticSigner
 * @property {string} id
 * @property {string} vendor
 * @property {string} model
 * @property {string | null} firmwareVersion
 *
 * @callback DiagnosticContext
 * @returns {Promise<{
 *   env?: DiagnosticEnv,
 *   build?: DiagnosticBuild,
 *   signers?: DiagnosticSigner[],
 * }>}
 *
 * @param {import('./MessageHost.js').MessageHostDeps & {
 *   approvals?: import('../bridge/Approvals.js').Approvals,
 *   getDiagnosticContext?: DiagnosticContext,
 *   surfaceStateEvents?: { publish: (kind: 'wallet' | 'wallets' | 'accounts' | 'network' | 'custom-chains', payload: Record<string, unknown>) => Promise<unknown> | unknown },
 * }} deps
 * @returns {MessageHost}
 */
export function createBackgroundHost(deps) {
    const {
        approvals,
        getDiagnosticContext,
        bridgeEvents,
        surfaceStateEvents,
        // Called after a settings.update whose patch touches
        // `privacy`, so a shell that routes requests itself can re-apply
        // before the next one. Desktop uses it for Tor routing; the web
        // and extension shells cannot proxy their own traffic and pass
        // nothing, which is why this is a dep rather than shared logic.
        onPrivacySettingsChanged,
        // Called with the chain ids whose SDK instance a saved endpoint
        // override dropped, so a shell holding a live socket on one can
        // re-sync it.
        onSdkEndpointsChanged,
        // Resolver that turns a web-accessible-resource path into a URL a
        // dApp can load (getSupportedChains uses it for chain icons).
        // Defaults inside registerBridgeHandlers to chrome.runtime.getURL;
        // web/desktop shells and tests can inject their own.
        getAssetUrl,
        // Cluster G FOLLOWUP 2: pluggable broadcast-queue persistence.
        // Default adapter picks chrome.storage.local (extension SW) or
        // localStorage (web renderer), and finds neither in desktop main;
        // pass `null` explicitly to opt out (in-memory only, the v0.292.0 behaviour).
        broadcastQueueStorage = createBroadcastQueueStorage(),
        // Shell-wide queue store, so a locked host cannot clobber its successor's.
        broadcastQueueStore,
        // Cluster S FOLLOWUP 2: pluggable sign-throttle persistence.
        // Same shape as the broadcast-queue adapter; pass null to opt
        // out (in-memory only, the v0.219.0 behavior).
        signThrottleStorage = createSignThrottleStorage(),
        // Cluster Q FOLLOWUP 5: pluggable logConsole mirror. Default
        // adapter picks chrome.storage.local (extension SW) or
        // localStorage (web/desktop renderers); pass `null` explicitly
        // to opt out (in-memory only, the v0.321.0 behavior). The mirror
        // honors a strict source whitelist (vault / signer / encoder /
        // bridge: never `console`) so arbitrary console.* args from
        // third-party content-script code can't reach disk.
        logConsoleStorage = createLogConsoleStorage(),
        // One host-level send hold shared by beforeBroadcast and the cancel route.
        // Injectable so timer and cancellation behavior can be tested without delays.
        sendHold: injectedSendHold,
        // Locks the wallet when storage refuses the auto-lock arm (the
        // session.autolock route). The extension passes its lock backstop.
        onAutoLockArmRefused,
        // Outcomes of sends that settled after a lock closed the vault. Every
        // host in one process reads the same store (lockedSendOutcomes.js).
        lockedSendOutcomes = createLockedSendOutcomeStore(),
        fileBlobs = createPendingFileBlobs(),
        resolveFileRef: injectedResolveFileRef,
        // Returns the SDK's amount validators (flows.amountRulesFromSdk). Each shell
        // loads them from its own SDK import; absent, pre-flight reports pass through.
        loadAmountRules,
        ...hostDeps
    } = deps ?? {};
    // Resolved here, not as a destructuring default, so the default stays bound to fileBlobs.
    const resolveFileRef = injectedResolveFileRef === undefined
        ? createFileRefResolver({ blobStore: fileBlobs })
        : injectedResolveFileRef;
    const host = new MessageHost(hostDeps);
    if (hostDeps.vault && !Object.prototype.hasOwnProperty.call(hostDeps.vault, 'pendingFileBlobs')) {
        Object.defineProperty(hostDeps.vault, 'pendingFileBlobs', {
            value: fileBlobs,
            configurable: true,
        });
    }

    // A lock closes the vault while an approved send is still signing or
    // broadcasting; the send finishes and its last write to its pending record
    // fails. Every action route is wrapped so that outcome is noted outside the
    // vault, and the next host to open the vault finishes the record from it.
    // The route's own result or error goes back untouched.
    const registerRoute = host.register.bind(host);
    host.register = (type, handler) => registerRoute(
        type,
        typeof type === 'string' && type.startsWith('action.') && typeof handler === 'function'
            ? keepOutcomeAcrossLock(handler)
            : handler,
    );

    function keepOutcomeAcrossLock(handler) {
        return async (req, ctx) => {
            let result;
            try {
                result = await handler(req, ctx);
            } catch (err) {
                await noteLockedOutcome(req, ctx?.vault, null, err);
                throw err;
            }
            await noteLockedOutcome(req, ctx?.vault, result, null);
            return result;
        };
    }

    async function noteLockedOutcome(req, vault, result, err) {
        try {
            const settled = err ?? result;
            if (!settled || typeof settled !== 'object' || !settled.pendingTxWriteError) return;
            // A write refused for another reason (a full disk) has no unlock to wait for.
            if (vault?.isOpen !== false) return;
            const pendingTxId = settled.pendingTxId;
            const walletId = req?.walletId;
            if (typeof pendingTxId !== 'string' || !pendingTxId || typeof walletId !== 'string' || !walletId) return;
            let kind = 'sent';
            if (err) {
                if (err.name === flows.BROADCAST_FAILED_TRANSIENT_NAME) kind = 'queued';
                else if (err.name === flows.BROADCAST_FAILED_PERMANENT_NAME) kind = 'failed';
                else kind = 'unsent';
            } else if (result.queued) {
                kind = 'queued';
            }
            const leg = Array.isArray(req?.legs) && req.legs.length === 1 ? req.legs[0] : req;
            const commitMark = err
                && (err.name === flows.BROADCAST_FAILED_TRANSIENT_NAME
                    || err.name === flows.BROADCAST_FAILED_PERMANENT_NAME)
                && err.commitLanded === true
                ? {
                    commitLanded: true,
                    commitTxid: typeof err.commitTxid === 'string' ? err.commitTxid : null,
                }
                : {};
            await lockedSendOutcomes.record({
                id: pendingTxId,
                pendingTxId,
                walletId,
                chainId: typeof req?.chainId === 'string' ? req.chainId : null,
                txid: typeof settled.txid === 'string' ? settled.txid : null,
                amount: leg?.amount == null ? null : String(leg.amount),
                tick: typeof leg?.tick === 'string' ? leg.tick : null,
                kind,
                at: Date.now(),
                finished: false,
                ...commitMark,
            });
        } catch (noteErr) {
            console.error('[xchain] could not keep a send outcome across the lock:', noteErr);
        }
    }

    // Finish every pending record a locked send left behind, against this
    // host's open vault. An outcome whose wallet is gone is dropped with it.
    async function finishLockedSendOutcomes(vault) {
        if (!vault || vault.isOpen === false) return;
        await lockedSendOutcomes.update(async (entries) => {
            const kept = [];
            for (const entry of entries) {
                if (entry.finished) { kept.push(entry); continue; }
                try {
                    const wallet = typeof vault.wallets?.get === 'function'
                        ? await vault.wallets.get(entry.walletId)
                        : null;
                    if (!wallet) continue;
                    let summary = null;
                    await vault.pendingTxs.update(entry.pendingTxId, (record) => {
                        if (!record) return null;
                        summary = typeof record.actionSummary === 'string' ? record.actionSummary : null;
                        const patch = finishPatchFor(entry, record);
                        return patch ? { ...record, ...patch } : null;
                    });
                    kept.push({ ...entry, finished: true, summary });
                } catch {
                    // The vault could not answer; the next list retries this one.
                    kept.push(entry);
                }
            }
            return kept;
        });
    }
    let lockedOutcomesFinished = finishLockedSendOutcomes(hostDeps.vault).catch(() => {});
    const sendHold = injectedSendHold ?? createSendHoldRegistry();
    // Popup and side panel share this host. Matching semantic sends stay
    // exclusive through signing and broadcast while unrelated sends proceed.
    const activeSendIntents = new Set();

    async function publishSurfaceState(kind, payload) {
        if (typeof surfaceStateEvents?.publish !== 'function') return;
        try {
            await surfaceStateEvents.publish(kind, payload);
        } catch {
            // Surface notification is best-effort after the vault mutation commits.
        }
    }

    // A send composed on one network must not sign or broadcast after the
    // wallet switched to another: the undo hold and a second window both
    // leave time for a switch between compose and broadcast.
    async function assertActiveSendNetwork(
        { chainId, vault, chainRegistry },
        reviewAgain = 'Return to Send and review the payment again.',
    ) {
        const descriptor = chainRegistry?.get?.(chainId);
        if (!descriptor) return;
        const activeNetwork = getActiveNetwork(await vault.settings.get());
        if (descriptor.networkKind !== activeNetwork) {
            // Named so the form shows this sentence instead of its generic failure line.
            throw Object.assign(new Error(`The active network changed to ${activeNetwork}. ${reviewAgain}`), {
                name: 'ActiveNetworkChangedError',
            });
        }
    }

    // LIST and AIRDROP can stay open while their network state changes, so
    // they take the same network check before signing.
    const REVIEW_ACTION_AGAIN = 'Go back and review the action again.';

    async function sendWithHold(req, flowDeps) {
        await assertActiveSendNetwork({ ...req, ...flowDeps });
        const legs = Array.isArray(req?.legs) && req.legs.length > 0
            ? req.legs
            : [{ to: req?.to, tick: req?.tick, amount: req?.amount, memo: req?.memo }];
        const intentKey = JSON.stringify([
            req?.walletId ?? null,
            req?.chainId ?? null,
            req?.from?.address ?? null,
            legs.map((leg) => [
                leg?.to ?? null,
                typeof leg?.tick === 'string' ? leg.tick.toUpperCase() : null,
                leg?.amount == null ? null : String(leg.amount),
                leg?.memo ?? null,
            ]),
        ]);
        if (activeSendIntents.has(intentKey)) {
            const err = new Error('A matching send is already in progress in another wallet window.');
            err.name = 'SendAlreadyInProgressError';
            throw err;
        }
        activeSendIntents.add(intentKey);
        try {
            // The hardware lane passes its deps inside req.
            return await withSpendClaim(req, flowDeps ?? req, (claimDeps) => sendHeld(req, {
                ...flowDeps,
                ...(claimDeps?.sdkRegistry ? { sdkRegistry: claimDeps.sdkRegistry } : {}),
            }));
        } finally {
            activeSendIntents.delete(intentKey);
        }
    }

    // The send itself, once its coins are claimed: the undo hold and the network
    // check run before the signed transaction leaves the wallet.
    async function sendHeld(req, flowDeps) {
        const opts = { ...req, ...flowDeps };
        const holdBeforeBroadcast = createHoldBeforeBroadcast({
            sendHold,
            holdId: opts.holdId,
            undoSeconds: opts.undoSeconds,
        });
        // The network check runs again after any hold, the last moment
        // before the signed transaction leaves the wallet.
        const beforeBroadcast = async (...args) => {
            if (holdBeforeBroadcast) await holdBeforeBroadcast(...args);
            await assertActiveSendNetwork(opts);
        };
        return sendToken({ ...opts, beforeBroadcast });
    }

    // Every action the background signs claims the coins its reviewed PSBT
    // spends (see ownSpends.js), so a review another surface built over the same
    // coins is refused before anything is signed. A PSBT the route builds itself
    // (a dApp send, an action built at submit time, each leg of a chunked
    // deploy) claims its coins the moment the encoder returns it, through the
    // registry `run` receives. The claim holds while the transaction signs, for
    // a while after it goes out, and, through the queue entry itself, while it
    // waits in the broadcast queue; any other end frees it. An order or a
    // dispenser that sells a name claims the name too, so another sale of it
    // from this wallet is refused before signing.
    async function withSpendClaim(req, deps, run) {
        const chainId = req?.chainId;
        const route = createRouteClaims(ownSpends, queuedOutpoints);
        let sdk = null;
        try { sdk = deps?.sdkRegistry?.get?.(chainId) ?? null; } catch { sdk = null; }
        const names = soldNames(req?.params);
        const nameClaim = names.length > 0
            ? await ownSpends.claim(chainId, [], { names, queuedNames: await queuedNames(chainId) })
            : '';
        try {
            await route.claim(chainId, psbtOutpoints(sdk, req?.prebuiltPsbt?.psbtHex));
        } catch (err) {
            if (nameClaim) await ownSpends.release(nameClaim);
            throw err;
        }
        const claimDeps = deps?.sdkRegistry
            ? {
                ...deps,
                sdkRegistry: claimingSdkRegistry(deps.sdkRegistry, {
                    onBuilt: (builtChain, builtSdk, psbtHex) => route.claim(builtChain, psbtOutpoints(builtSdk, psbtHex)),
                    onSent: (sentChain, txHex) => route.sent(sentChain, rawTxOutpoints(txHex), txidOfRaw(txHex)),
                }),
            }
            : deps;
        let wentOut = false;
        try {
            const result = await run(claimDeps);
            wentOut = Boolean(result?.txid) && !result?.queued;
            return result;
        } catch (err) {
            // A refused envelope reveal or second-phase spend follows a commit that did go out.
            wentOut = /^broadcast failed \((?:phase2|envelope_reveal)\)/i.test(String(err?.message || '').trim());
            throw err;
        } finally {
            await route.settle(wentOut);
            if (nameClaim) {
                if (wentOut) await ownSpends.keep(nameClaim);
                else await ownSpends.release(nameClaim);
            }
        }
    }

    // Read the durable half directly because restoring a record first requires
    // decrypting its wallet. Admission still has to hold its inputs when that
    // wallet is unreadable. A table read failure refuses the claim rather than
    // treating an unknown inventory as empty.
    async function durableQueuedRecords() {
        const findBy = hostDeps.vault?.pendingTxs?.findBy;
        // Lightweight vault adapters without a PendingTx collection cannot
        // contain durable queued records. A present collection that refuses a
        // read is different and must fail closed below.
        if (typeof findBy !== 'function') return [];
        try {
            const queued = await findBy.call(hostDeps.vault.pendingTxs, 'status', 'queued');
            const broadcasting = await findBy.call(hostDeps.vault.pendingTxs, 'status', 'broadcasting');
            return [
                ...(Array.isArray(queued) ? queued : []),
                ...(Array.isArray(broadcasting) ? broadcasting : []),
            ];
        } catch (cause) {
            throw Object.assign(new Error('Queued transactions could not be checked. Try again.'), {
                name: 'QueuedSendCheckFailedError',
                cause,
            });
        }
    }

    function durableRecordChainId(record) {
        return hostDeps.chainRegistry?.chainIdFor?.(record?.chain, record?.network) ?? '';
    }

    // The coins waiting in either the live queue or durable queued records, for
    // every wallet. `exceptTxid` leaves out the queued copy of the transaction
    // being sent.
    async function queuedOutpoints(chainId, exceptTxid = '') {
        await ensureQueueLoaded();
        const except = String(exceptTxid || '').toLowerCase();
        const live = [...queueStore.queues.values()]
            .flatMap((entries) => (Array.isArray(entries) ? entries : []))
            .filter((entry) => entry?.chainId === chainId)
            .filter((entry) => !except || txidOfRaw(entry?.signedTxHex) !== except)
            .flatMap((entry) => rawTxOutpoints(entry?.signedTxHex));
        const durable = (await durableQueuedRecords())
            .filter((record) => durableRecordChainId(record) === chainId)
            .filter((record) => !except || txidOfRaw(record?.txHex) !== except)
            .flatMap((record) => rawTxOutpoints(record?.txHex));
        return [...live, ...durable];
    }

    async function queuedNames(chainId) {
        await ensureQueueLoaded();
        const live = [...queueStore.queues.values()]
            .flatMap((entries) => (Array.isArray(entries) ? entries : []))
            .filter((entry) => entry?.chainId === chainId)
            .flatMap((entry) => (Array.isArray(entry?.soldNames) ? entry.soldNames : []));
        const durable = (await durableQueuedRecords())
            .filter((record) => durableRecordChainId(record) === chainId)
            .flatMap((record) => soldNames(record?.params));
        return [...live, ...durable];
    }

    // The id of signed transaction bytes, '' for bytes that do not parse.
    function txidOfRaw(txHex) {
        try { return String(rawTxid(txHex) || '').toLowerCase(); } catch { return ''; }
    }

    // ONE reservation ledger per host, shared across every
    // approval window. A single background SW serves all popup windows, so
    // an in-memory ledger already closes the two-window same-balance race
    // (both windows' preflights net each other's approved-but-unbroadcast
    // amounts).
    //
    // In-memory alone is not enough on MV3. Chrome may kill this worker
    // after ~30s of perceived idle - well inside the window where a user is
    // reading warnings, typing a password or waking a hardware device - and a
    // kill would silently drop every reservation, so a second window would
    // then see the full balance again and the race would be back. Backing the
    // ledger with chrome.storage.session makes the reservations survive that
    // restart; the store returns null outside an extension (Node tests, web
    // and desktop shells), where the ledger stays in-memory.
    // Crash hook: uncaught errors and rejections feed the dump's recent_errors.
    const errorBuffer = createErrorRingBuffer();
    installShellErrorCapture(globalThis, errorBuffer);

    const actionSafetyStorage = createActionSafetySessionStorage();
    const reservationLedger = createReservationLedger(
        actionSafetyStorage ? { store: reservationStoreFrom(actionSafetyStorage) } : undefined,
    );
    // Different sends over the same coins stay exclusive too (see ownSpends.js).
    const ownSpends = createOwnSpendLedger(
        actionSafetyStorage ? { store: ownSpendStoreFrom(actionSafetyStorage) } : undefined,
    );

    // Cluster Q FOLLOWUP 5: hydrate + start mirroring as early as
    // possible so a worker crash mid-boot still leaves the next session
    // with whatever was buffered before the crash. Order matters:
    // restore() runs before attachMirror() so the first save() writes
    // the merged buffer (persisted + any synthetic record() calls that
    // landed during boot). The persisted load itself is async; if a
    // record() fires before it resolves, the live buffer keeps that
    // entry and the next debounced flush picks it up.
    if (logConsoleStorage) {
        void (async () => {
            try {
                const persisted = await logConsoleStorage.load();
                if (Array.isArray(persisted) && persisted.length > 0) {
                    logConsole.restore(persisted);
                }
            } catch {
                // Hydration failed: start fresh.
            }
            logConsole.attachMirror({
                save: (entries) => logConsoleStorage.save(entries),
            });
        })();
    }

    // The throttle reads limits from a synchronous closure cache. The host
    // fills that cache from settings and signing waits for the first attempt,
    // so a restart cannot briefly substitute the default limits.
    let cachedThrottleLimits = /** @type {{ burst?: number, windowMs?: number } | null} */ (null);
    /** @type {import('@xchain-wallet/core').storage.Vault | null} */
    let throttleVault = hostDeps?.vault ?? null;
    let throttleLimitsLoaded = false;
    /** @type {Promise<void> | null} */
    let throttleLimitsLoadPromise = null;
    let throttleLimitsLoadIsForced = false;
    // Cluster Q FOLLOWUP 2: track whether we've already seeded the
    // chainRegistry instance with the persisted custom chains. The
    // registry is module-scoped in the shell entry (extension/web/
    // desktop) and survives host teardown across lock/unlock cycles,
    // so the boot pass runs once per registry instance (hydration skips an
    // id the registry already holds, so a re-run is harmless but wasted
    // reads). A settings restore hydrates again through
    // rehydrateAfterSettingsRestore. Only a COMPLETED read
    // latches: the popup's first settings.get lands while the vault is
    // still locked, and a read that fails there leaves the registry
    // unseeded so the next settings.get retries. Concurrent callers share
    // the in-flight promise, which keeps the pass single-flight.
    let customChainsSeeded = false;
    /** @type {Promise<void> | null} */
    let customChainsSeedPromise = null;
    async function seedCustomChainsFromVault(vault, chainRegistry) {
        if (customChainsSeeded) return;
        if (customChainsSeedPromise) return customChainsSeedPromise;
        if (!vault || !chainRegistry) return;
        customChainsSeedPromise = (async () => {
            try {
                const settings = await vault.settings.get();
                // Share the UI realms' install loop; it skips a corrupt or
                // invalid row rather than throwing, so one bad row never
                // crashes the boot path.
                registry.hydrateCustomChainsFromSettings(chainRegistry, settings);
                // Last statement in the try, so a throwing read never latches.
                customChainsSeeded = true;
            } catch {
                // Vault not open / read failed: boot continues and the next
                // settings.get runs the pass again.
            }
        })();
        try {
            await customChainsSeedPromise;
        } finally {
            customChainsSeedPromise = null;
        }
    }
    // Settings -> Network & Endpoints is the surface an operator
    // uses to point the wallet at their OWN explorer / encoder / hub, and
    // until this ran the record was written, read back by the summary row,
    // and consumed by nothing: every SDK instance kept the bundled
    // defaults. Applied here (one host, all three shells) at construction,
    // opportunistically on settings.get, and after any settings.update
    // that touches sdkEndpoints. The registry no-ops when the effective
    // endpoints are unchanged, so unrelated saves never drop live SDK
    // instances.
    async function applyEndpointOverridesFromVault(vault, sdkRegistry) {
        if (!vault) return [];
        if (typeof sdkRegistry?.applyEndpointOverridesFromSettings !== 'function') return [];
        try {
            const settings = await vault.settings.get();
            const applied = settings
                ? sdkRegistry.applyEndpointOverridesFromSettings(settings)
                : null;
            return Array.isArray(applied?.changed) ? applied.changed : [];
        } catch {
            // Vault not open yet or read failed: the bundled defaults keep
            // serving and the next trigger tries again.
            return [];
        }
    }
    // A restore that replaces the Settings record can bring custom chains and
    // endpoint overrides the latched boot pass never saw. Hydrate straight from
    // a fresh read instead of through the latch. The restored record replaces
    // the old one outright, so the registry is reconciled to it (chains the
    // record dropped or changed leave or swap, and their cached SDK clients
    // go with them), after any boot pass still in flight has finished adding
    // from the pre-restore record. Seed first, overrides second, for the
    // reason above.
    async function rehydrateAfterSettingsRestore(vault, chainRegistry, sdkRegistry) {
        if (!vault || !chainRegistry) return;
        let moved = false;
        const droppedSdkIds = new Set();
        try {
            if (customChainsSeedPromise) await customChainsSeedPromise;
            const restored = await vault.settings.get();
            // A record that never held a custom chain carries no list at all,
            // and the reconcile treats a missing list as "unknown"; after a
            // restore the stored record is the truth, so it reads as empty.
            const result = registry.reconcileCustomChainsFromSettings(
                chainRegistry,
                restored && typeof restored === 'object' && !Array.isArray(restored.customChains)
                    ? { ...restored, customChains: [] }
                    : restored,
            );
            for (const id of [...result.removed, ...result.replaced]) {
                droppedSdkIds.add(id);
                try { sdkRegistry?.invalidate?.(id); } catch { /* a cache drop never fails the restore */ }
            }
            moved = result.added.length + result.removed.length + result.replaced.length > 0;
        } catch {
            // The restore already committed; a failed re-read must not fail it.
        }
        for (const id of await applyEndpointOverridesFromVault(vault, sdkRegistry)) {
            droppedSdkIds.add(id);
        }
        if (droppedSdkIds.size > 0 && typeof onSdkEndpointsChanged === 'function') {
            try {
                await onSdkEndpointsChanged([...droppedSdkIds]);
            } catch (err) {
                console.error('[xchain] endpoint change follow-up failed:', err);
            }
        }
        if (throttleVault !== vault) {
            throttleVault = vault;
            throttleLimitsLoaded = false;
        }
        await refreshThrottleLimitsFromVault({ force: true });
        if (moved) await publishSurfaceState('custom-chains', {});
    }
    // Seed BEFORE the override pass, and seed here rather than only on
    // settings.get. A host can start with no UI attached at all: an MV3
    // worker restored after eviction with the popup closed, or the desktop
    // main process with no renderer window. Nothing issues settings.get on
    // those paths, so the registry held only the bundled chains while the
    // bridge answered dApps from it (getSupportedChains) and the
    // notification watchers dropped every address whose chain id would not
    // resolve (getActiveAddresses skips them silently). The latch and the
    // single-flight guard make this pass idempotent, and a read that throws
    // (vault still locked at construction) does not latch, so the
    // settings.get pass remains the retry.
    void (async () => {
        await seedCustomChainsFromVault(hostDeps?.vault, hostDeps?.chainRegistry);
        await applyEndpointOverridesFromVault(hostDeps?.vault, hostDeps?.sdkRegistry);
    })();

    async function refreshThrottleLimitsFromVault({ force = false } = {}) {
        let vault = throttleVault;
        if (!vault || (!force && throttleLimitsLoaded)) return;
        if (throttleLimitsLoadPromise) {
            const inFlightWasForced = throttleLimitsLoadIsForced;
            await throttleLimitsLoadPromise;
            if ((!force && throttleLimitsLoaded) || (force && inFlightWasForced)) return;
            vault = throttleVault;
            if (!vault) return;
        }
        if (throttleLimitsLoadPromise) return throttleLimitsLoadPromise;
        const load = (async () => {
            try {
                const settings = await vault.settings.get();
                if (throttleVault !== vault) return;
                cachedThrottleLimits = settings?.signThrottle ?? null;
                throttleLimitsLoaded = true;
            } catch {
                // A failed read does not latch, so the next trigger retries.
            }
        })();
        throttleLimitsLoadPromise = load;
        throttleLimitsLoadIsForced = force;
        try {
            await load;
        } finally {
            if (throttleLimitsLoadPromise === load) {
                throttleLimitsLoadPromise = null;
                throttleLimitsLoadIsForced = false;
            }
        }
    }
    const signThrottleLimitsHydrated = refreshThrottleLimitsFromVault();
    // Bucket state is persisted across worker restarts. The saved timestamps
    // are merged before a signing route can make its first throttle check.
    const signThrottle = createSignThrottle({
        getLimits: () => cachedThrottleLimits || {},
        onPersist: signThrottleStorage
            ? (snapshot) => signThrottleStorage.save(snapshot)
            : undefined,
    });
    const signThrottleHydrated = signThrottleStorage
        ? (async () => {
            try {
                const snapshot = await signThrottleStorage.load();
                signThrottle.seed(snapshot?.buckets || {});
            } catch {
                // Hydration failed: start fresh.
            }
        })()
        : Promise.resolve();

    async function whenSignThrottleReady(vault) {
        await Promise.all([signThrottleHydrated, signThrottleLimitsHydrated]);
        if (vault && throttleVault !== vault) {
            throttleVault = vault;
            throttleLimitsLoaded = false;
        }
        if (!throttleLimitsLoaded && throttleVault) {
            await refreshThrottleLimitsFromVault();
        }
    }

    // §19.5.2 label auto-sync. One scheduler per host, and a host IS an
    // unlock window: the shells build it on unlock and tear it down on
    // lock, so "one publish per unlock window" needs no extra plumbing
    // here. Every label / contact vault write notifies it; when the
    // edits stop it raises ONE pending publish, which the Backup panel
    // surfaces as a prompt. The background deliberately cannot publish
    // by itself - that would need the seed, and the decided shape keeps
    // prompting for it instead of caching it.
    //
    // Scope note: the pending batch lives in memory for the length of the
    // host, so a lock forgets that the on-chain copy is behind. The labels
    // themselves are already safe in the vault; the user loses a reminder,
    // not data, and the next label edit (or "Publish now") re-raises it.
    // The scheduler's begin/endUnlockWindow pair carries a batch across a
    // lock for shells that keep one host alive instead.
    let labelSyncPending = /** @type {object | null} */ (null);
    /** @type {import('@xchain-wallet/core').storage.Vault | null} */
    let labelSyncVault = null;
    const labelSyncScheduler = createLabelSyncScheduler({
        isEnabled: async () => {
            const v = labelSyncVault ?? hostDeps?.vault ?? null;
            if (!v) return false;
            try {
                const settings = await v.settings.get();
                return settings?.privacy?.labelsSurviveRestore === true;
            } catch {
                return false;
            }
        },
        requestPublish: (batch) => { labelSyncPending = batch; },
        onError: () => { /* best-effort: a failed gate read just skips this cycle */ },
    });
    /** @param {{ vault?: unknown }} ctx @param {string | null} [walletId] */
    function noteLabelChange(ctx, walletId) {
        if (ctx?.vault && !labelSyncVault) labelSyncVault = ctx.vault;
        try {
            labelSyncScheduler.noteLabelChange(
                typeof walletId === 'string' && walletId ? { walletId } : {},
            );
        } catch {
            // Never let sync bookkeeping fail the edit the user asked for.
        }
    }

    host.register('wallet.list', async (_req, { vault }) => {
        const wallets = await vault.wallets.list();
        return wallets.map(toSafeWallet);
    });

    host.register('wallet.labelSyncRestoreResult', (req) => (
        waitForLabelSyncRestoreTask(req?.token)
    ));

    // Used-address discovery (§15.4). A restore or the Settings action
    // starts it; it runs in the background over the unlocked software
    // signers, on the active network only, and screens poll its status.
    const addressDiscovery = createAddressDiscoveryTask();
    host.register('wallet.discoverAddresses', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const requested = typeof req?.walletId === 'string' && req.walletId
            ? [req.walletId]
            : (await vault.wallets.list()).map((w) => w.id);
        const signerFor = (walletId) => {
            const signer = signerPool && typeof signerPool.get === 'function' ? signerPool.get(walletId) : null;
            return signer && signer.kind === 'software' ? signer : null;
        };
        const walletIds = requested.filter((id) => signerFor(id));
        if (walletIds.length === 0) {
            throw new Error('Unlock the wallet, then check for used addresses again.');
        }
        let activeNetwork = null;
        try {
            activeNetwork = getActiveNetwork(await vault.settings.get());
        } catch { /* every network the wallet holds addresses on */ }
        return addressDiscovery.start({
            walletIds,
            chainName: (chainId) => chainRegistry.descriptorFor(chainId)?.displayName ?? chainId,
            countChains: async (walletId) => (
                await flows.discoveryChainIds({ vault, walletId, chainRegistry, activeNetwork: activeNetwork ?? undefined })
            ).length,
            run: (walletId, onProgress) => {
                const signer = signerFor(walletId);
                if (!signer) throw new Error('The wallet locked before the check finished.');
                return flows.discoverWalletAddresses({
                    vault,
                    walletId,
                    signer,
                    chainRegistry,
                    sdkRegistry,
                    activeNetwork: activeNetwork ?? undefined,
                    onProgress,
                });
            },
        });
    });
    host.register('wallet.addressDiscoveryStatus', () => addressDiscovery.status());
    host.register('wallet.addressDiscoveryDismiss', (req) => addressDiscovery.dismiss(req?.id));

    host.register('wallet.exists', async (req, { vault }) => {
        const id = req?.walletId;
        if (typeof id !== 'string' || !id) return { exists: false };
        return { exists: (await vault.wallets.get(id)) !== null };
    });

    // The wallet UI names the wallet the user just selected, so connected
    // sites can get accountsChanged with that wallet's granted accounts.
    host.register('wallet.setActive', async (req, { vault }) => {
        const result = await announceWalletSwitch(req, vault, bridgeEvents);
        await publishSurfaceState('wallet', { walletId: req.walletId });
        return result;
    });

    // Add a wallet to an already-open vault; the Add Wallet create and import
    // screens both land here. `wallet.create` / `wallet.import` are not
    // registered on this host: they are the pre-host fresh-install lane
    // (sessionMeta PRE_HOST_MESSAGE_TYPES), which the extension and desktop
    // transports divert before the host sees them and web answers in-page,
    // so a copy here could never run.
    host.register('wallet.add.import', async (req, { vault, chainRegistry, sdkRegistry, signerPool, vaultKeyring }) => {
        // Seed from the vault's active chain set, not the mainnet
        // constant. A wallet added while the app sits on regtest/testnet
        // used to get mainnet-only addresses, which the active-network
        // filter hides everywhere - an inert wallet with no in-app way to
        // give itself an address.
        const activeChainIds = await seedChainIdsForVault({
            vault,
            chainRegistry,
            requested: req?.activeChainIds,
            fallback: DEFAULT_ACTIVE_CHAIN_IDS,
        });
        const r = await importMnemonic({
            ...req,
            activeChainIds,
            vault,
            chainRegistry,
            sdkRegistry,
        });
        // Stash the new wallet's signer in the pool while the password
        // is in scope: keeps "no password on accounts" working for
        // the wallet that was just added, and lets auto-pay, which signs
        // with no prompt, act for it (getSigner(walletId) is null otherwise).
        if (signerPool && req?.password) {
            try {
                await signerPool.unlockOne({
                    wallet: r.wallet,
                    password: req.password,
                    bip39Passphrase: req.bip39Passphrase,
                    chainRegistry,
                    sdkRegistry,
                });
            } catch { /* best-effort: fallback is per-op password prompt */ }
        }
        // 'preserve': the vault already holds the other wallets' contacts and
        // labels, and an added wallet's published copy must not overwrite a
        // record the user edited here since.
        const labelSyncToken = r.wallet.origin === 'created'
            ? null
            : startLabelSyncRestoreTask({
                walletId: r.wallet.id,
                run: () => restoreLabelSyncBestEffort({
                    vault,
                    walletId: r.wallet.id,
                    password: req?.password,
                    bip39Passphrase: req?.bip39Passphrase,
                    chainIds: labelSyncSearchChainIds(chainRegistry, activeChainIds),
                    sdkRegistry,
                    onConflict: 'preserve',
                }),
            });
        await publishSurfaceState('wallets', { change: 'added', walletId: r.wallet.id });
        refreshPhraseRecoveryAfterAdd({ vault, vaultKeyring }, req?.password);
        return {
            format: r.format,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
            labelSyncToken,
        };
    });

    // Add a hardware wallet to the open vault: the connect flow's last step
    // when a wallet already exists (a fresh install takes the pre-host
    // `wallet.create.hardware`). The keys stay on the device, so there is no
    // signer to pool and no seed to restore labels from. The signer record's
    // id in the answer is what the renderer registers the device transport
    // under. Unlinking reuses `wallet.remove`, which drops the signer rows.
    host.register('wallet.hardware.add', async (req, { vault, chainRegistry }) => {
        const r = await addHardwareWallet({ ...hardwareWalletInput(req), vault, chainRegistry });
        await publishSurfaceState('wallets', { change: 'added', walletId: r.wallet.id });
        return { wallet: toSafeWallet(r.wallet), ...hardwareWalletResult(r) };
    });

    // §3.4: the one-time capture of a legacy wallet's 25th word. A
    // wallet created before the passphrase was stored opens only when the user
    // supplies it, so the unlock screen asks once, sends it here, and the
    // record carries an encrypted copy from then on.
    //
    // Registered here rather than per shell because this is the one host every
    // shell runs: the web bridge imports `createBackgroundHost` instead of
    // reimplementing it, so a second copy would only be a second thing to
    // drift. The vault this reads is the host's own, opened for the session,
    // not the short-lived one the pre-host unlock handler closes.
    host.register('wallet.passphrase.capture', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('wallet.passphrase.capture: walletId is required');
        }
        if (!signerPool) {
            throw new Error('wallet.passphrase.capture: this session has no signer pool');
        }
        const wallet = await vault.wallets.get(walletId);
        if (!wallet) {
            throw new Error(`wallet.passphrase.capture: wallet "${walletId}" not found`);
        }
        // captureOne verifies the passphrase against the wallet's stored
        // addresses before writing anything, and throws PassphraseMismatchError
        // when it does not own them. Let that reach the caller unchanged: the
        // unlock screen branches on it to mark the field.
        const record = await signerPool.captureOne({
            vault,
            wallet,
            password: req?.password,
            bip39Passphrase: req?.bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
        // The safe projection carries `passphraseStored: true`, which is the
        // whole answer the UI needs: this wallet no longer asks for anything
        // but the password.
        return { wallet: toSafeWallet(record) };
    });

    host.register('wallet.rename', async (req, { vault }) => {
        const updated = await renameWallet({ ...req, vault });
        await publishSurfaceState('wallets', { change: 'renamed', walletId: updated.id });
        return { wallet: toSafeWallet(updated) };
    });

    host.register('account.rename', async (req, { vault }) => {
        const previous = await vault.accounts.get(req?.accountId);
        const updated = await renameAccount({ ...req, vault });
        if (previous?.name !== updated.name) {
            await announceAccountChange(vault, bridgeEvents, [updated.id]);
        }
        await publishSurfaceState('accounts', {
            change: 'renamed',
            walletId: updated.walletId,
            accountId: updated.id,
        });
        return { account: updated };
    });

    host.register('account.list', async (req, { vault }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) return [];
        const accounts = await vault.accounts.findBy('walletId', walletId);
        return [...accounts].sort((a, b) => a.index - b.index);
    });

    // Create the next BIP44 account under a wallet (max(index)+1) +
    // first address per active chain. When the host has a SignerPool
    // (populated at unlock time), no password is needed: the
    // pre-unlocked signer is reused. When `req.signerId` names a
    // paired hardware SignerRecord (§17.6 / G023), build a
    // RemoteSigner against the renderer-side device transport and use
    // that instead: no password, addresses persist with
    // `source: 'trezor' | 'ledger'`. Falls back to a password-based
    // unlock for shells/sessions that don't pre-populate the pool.
    host.register('account.create', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        // Same seeding rule as wallet.add.import - a new account
        // created on regtest/testnet must land on the chains the vault is
        // actually active on, not on the mainnet constant.
        const activeChainIds = await seedChainIdsForVault({
            vault,
            chainRegistry,
            requested: req?.activeChainIds,
            fallback: DEFAULT_ACTIVE_CHAIN_IDS,
        });
        const walletId = req?.walletId;
        const signer = await pickSignerFromRequest({
            vault,
            walletId,
            signerId: req?.signerId,
            signerPool,
        });
        const r = await createAccount({
            ...req,
            signer: signer || undefined,
            activeChainIds,
            vault,
            chainRegistry,
            sdkRegistry,
        });
        await announceAccountChange(vault, bridgeEvents, [r.account.id]);
        await publishSurfaceState('accounts', {
            change: 'added',
            walletId: r.account.walletId,
            accountId: r.account.id,
        });
        // A hardware wallet's networks left waiting for their Ledger app go
        // back with the account, so Add account can show each one with the
        // connect step's line and Try again.
        return Array.isArray(r.waitingChains) && r.waitingChains.length
            ? { account: r.account, addresses: r.addresses, waitingChains: [...r.waitingChains] }
            : { account: r.account, addresses: r.addresses };
    });

    host.register('wallet.checkPassword', async (req, { vault, chainRegistry, sdkRegistry }) => {
        // Quick check: can we unlock this wallet with the supplied password?
        // Returns boolean; never holds the signer beyond this call.
        const signer = await unlockWallet({ ...req, vault, chainRegistry, sdkRegistry });
        signer.lock();
        return { ok: true };
    });

    host.register('wallet.changePassword', async (req, flowDeps) => (
        changeWalletPassword(req, flowDeps)
    ));

    // Can this wallet sign WITHOUT a password right now? True iff the
    // unlocked session has a pre-unlocked SoftwareSigner for it in the
    // pool. The UI uses this to hide the per-action password input
    // ("password only at unlock"): and correctly keeps prompting in the
    // rare empty-pool cases (passphrase wallet, or a worker restart that
    // couldn't rehydrate the pool).
    //
    // A hardware wallet never enters the pool (its keys are on the device),
    // so it answers `{ ready: false, hardware: true }` without asking the
    // pool: its forms sign through the device lane, which needs no password,
    // and `hardware` lets a screen say so instead of prompting.
    host.register('wallet.signerReady', async (req, { vault, signerPool }) => {
        const walletId = req?.walletId;
        if (typeof walletId === 'string' && walletId && typeof vault?.wallets?.get === 'function') {
            let wallet = null;
            try { wallet = await vault.wallets.get(walletId); } catch { wallet = null; }
            if (isHardwareWallet(wallet)) return { ready: false, hardware: true };
        }
        const ready = typeof walletId === 'string'
            && !!signerPool
            && typeof signerPool.has === 'function'
            && signerPool.has(walletId);
        return { ready };
    });

    // §48.3 / G149: runtime chain activation. Seeds settings.fees
    // for the chainId, then derives the first address on
    // that chain for every existing account in the wallet. Idempotent:
    // re-activating a chain that already has fee + address records is
    // a no-op. HW-aware (§17.4 / FOLLOWUP 1): when req.signerId names a
    // paired hardware signer, pickSignerFromRequest builds a RemoteSigner
    // against the device transport and no password is required. With
    // req.accountId it fills the chain into that one account only: a
    // hardware wallet's Add network on its Accounts tab and in Add account.
    host.register('wallet.activateChain', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        const signer = await pickSignerFromRequest({
            vault,
            walletId,
            signerId: req?.signerId,
            signerPool,
        });
        return activateChain({
            walletId,
            chainId: req?.chainId,
            accountId: typeof req?.accountId === 'string' && req.accountId ? req.accountId : undefined,
            password: req?.password,
            bip39Passphrase: req?.bip39Passphrase,
            signer: signer || undefined,
            vault,
            chainRegistry,
            sdkRegistry,
        });
    });


    host.register('settings.get', async (_req, { vault, chainRegistry, sdkRegistry }) => {
        // Retry a failed construction-time read once settings are available.
        if (throttleVault !== vault) {
            throttleVault = vault;
            throttleLimitsLoaded = false;
        }
        if (!throttleLimitsLoaded) {
            void refreshThrottleLimitsFromVault();
        }
        // Cluster Q FOLLOWUP 2: opportunistic custom-chain re-seed,
        // followed by the same opportunistic trigger for custom endpoints.
        // Single-flight per host instance via the customChainsSeeded
        // guard. Settings.get is the natural trigger because the popup
        // calls it shortly after unlock, before any chain-aware UI
        // mounts. The endpoint pass covers the web shell, where the
        // module-scoped SDKRegistry is replaced once the real SDK factory
        // resolves and the fresh instance would otherwise start with an
        // empty override map.
        //
        // The two run in sequence rather than side by side: the SDK
        // registry drops overrides for chain ids the chain registry does
        // not know, and REPLACES the whole override map instead of merging
        // it, so an endpoint pass that reaches the vault first discards a
        // user-added chain's endpoints for the rest of the session.
        void (async () => {
            await seedCustomChainsFromVault(vault, chainRegistry);
            await applyEndpointOverridesFromVault(vault, sdkRegistry);
        })();
        return getSettings(vault);
    });

    // Switch the active network AND make sure the wallet actually has
    // addresses on it. `settings.update` alone only flips a filter, which is
    // how a network switch used to strand a wallet with no addresses and no UI
    // path to create one. Address derivation is best-effort and reported, never
    // thrown: the setting is already persisted by the time it runs, so failing
    // loudly here would leave the user in exactly the state this prevents.
    host.register('settings.setActiveNetwork', async (req, deps) => {
        const { vault, chainRegistry, sdkRegistry, signerPool } = deps;
        const network = req?.network;
        if (typeof network !== 'string' || !network) {
            throw new Error('settings.setActiveNetwork: network is required');
        }
        const previousSettings = await getSettings(vault);
        let settings = await updateSettings(vault, { activeNetwork: network });

        let addresses = { created: [], existing: [], failed: [], skipped: 'no-wallet' };
        const walletId = req?.walletId;
        if (typeof walletId === 'string' && walletId.length > 0) {
            const signer = await pickSignerFromRequest({
                vault, walletId, signerId: req?.signerId, signerPool,
            }).catch(() => null);
            addresses = await ensureNetworkAddresses({
                vault, chainRegistry, sdkRegistry, walletId, network, signer: signer || undefined,
            });
            // Switching the active network must also seed per-chain
            // Settings (fees) for that network's chains, the
            // same contract activateChain honours ("consumers key off
            // settings.fees"). ensureNetworkAddresses derives addresses only,
            // so without this a host-driven switch - the extension's ONLY path
            // to regtest, since it has no Settings UI - leaves
            // settings.fees mainnet-only. useReachability then derives an empty
            // active-chain set on regtest and reachability.check maps empty ->
            // offline, so a second popup shows a false "You're offline" and its
            // confirm pre-flight never runs. ensureSettings is idempotent and
            // never overwrites a user's customized fee strategy.
            const networkChainIds = chainRegistry.byNetworkKind(network).map((d) => d.id);
            if (networkChainIds.length > 0) {
                settings = await ensureSettings(vault, chainRegistry, networkChainIds);
            }
        }
        await announceNetworkChange(
            previousSettings,
            settings,
            vault,
            chainRegistry,
            bridgeEvents,
            approvals,
        );
        await publishSurfaceState('network', { settings });
        return { settings, addresses };
    });

    host.register('settings.update', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const patch = req && typeof req === 'object' && 'patch' in req
            ? /** @type {Record<string, unknown>} */ (req.patch)
            : /** @type {Record<string, unknown>} */ (req ?? {});
        const previousSettings = patch
            && Object.prototype.hasOwnProperty.call(patch, 'activeNetwork')
            ? await getSettings(vault)
            : null;
        const result = await updateSettings(vault, patch);
        // A saved endpoint takes effect on the next request, not
        // at the next wallet restart. Invalidates only the chains whose
        // endpoints actually moved.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'sdkEndpoints')
            && typeof sdkRegistry?.applyEndpointOverridesFromSettings === 'function') {
            const applied = sdkRegistry.applyEndpointOverridesFromSettings(result);
            // Live sockets were opened on the instances just dropped; a shell
            // that holds them re-syncs here. A network event is not used: it
            // remounts the popup's network state.
            if (applied?.changed?.length > 0 && typeof onSdkEndpointsChanged === 'function') {
                try {
                    await onSdkEndpointsChanged(applied.changed);
                } catch (err) {
                    console.error('[xchain] endpoint change follow-up failed:', err);
                }
            }
        }
        // Cluster S FOLLOWUP 1: refresh the sign-throttle limit cache
        // when the patch touches signThrottle so users see the change
        // take effect on the very next sign request.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'signThrottle')) {
            throttleVault = vault;
            await refreshThrottleLimitsFromVault({ force: true });
        }
        // Privacy settings that change how requests are MADE
        // have to take effect on the next request, not the next restart.
        // Tor routing is the case in point: a user flips it on, keeps
        // browsing their balances, and every one of those requests would
        // otherwise still go direct while the UI says the toggle is on.
        // Only the desktop shell supplies this; the others have no host
        // capable of proxying and pass nothing.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'privacy')
            && typeof onPrivacySettingsChanged === 'function') {
            try {
                await onPrivacySettingsChanged(result, { sdkRegistry });
            } catch (err) {
                // A failure here must not swallow the user's saved
                // setting, but it must be loud: it means the wallet is
                // not routing the way the UI now claims.
                console.error('[xchain] privacy settings apply failed:', err);
            }
        }
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'activeNetwork')) {
            await announceNetworkChange(
                previousSettings,
                result,
                vault,
                chainRegistry,
                bridgeEvents,
                approvals,
            );
            await publishSurfaceState('network', { settings: result });
        }
        return result;
    });

    // §20.5: watcher <-> signer auto-pairing over a shared seed.
    //
    // `pairing.payload` exports THIS wallet's account-level public material
    // (never any seed or private key) for the partner to scan or paste.
    // `pairing.pair` takes the partner's payload back, proves both halves
    // derive from one recovery phrase, and persists the verified partner
    // record at `settings.partnerPairing`.
    //
    // Both routes resolve their signer the same way every other key-touching
    // route does: the pre-unlocked pooled session signer when one exists,
    // otherwise a password unlock we lock again on the way out. The
    // onboarding lane hits the password path (it just imported the shared
    // phrase and still has the password in hand); a later re-pair from
    // Settings hits the pooled path with no prompt.
    async function withPairingSigner(req, deps, fn) {
        const { vault, chainRegistry, sdkRegistry, signerPool } = deps;
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || walletId.length === 0) {
            throw new Error('pairing: walletId is required');
        }
        let wallet = await vault.wallets.get(walletId);
        if (!wallet) {
            throw new Error(`pairing: no wallet with id "${walletId}"`);
        }
        // Pairing sets this wallet's watcher or signer mode on its record here,
        // so a payload always reports the mode that is actually persisted.
        if ((req?.walletMode === 'watcher' || req?.walletMode === 'signer')
            && wallet.walletMode !== req.walletMode) {
            wallet = { ...wallet, walletMode: req.walletMode };
            await vault.wallets.put(wallet);
        }
        // A standalone xpub export reads the unlocked session's software
        // signer with no password re-entry (operator ruling 2026-11-15):
        // public keys cannot spend, and the wallet is already unlocked. It
        // never takes a device signer, and a typed password still wins. With
        // no pooled signer and no password it refuses instead of guessing.
        const publicExport = req?.publicExport === true;
        if (publicExport && isHardwareWallet(wallet)) throw new HardwareWalletHasNoSeedError();
        const pooled = publicExport
            ? publicExportSigner(signerPool, walletId, req?.password)
            : await sessionSigner(req, vault, signerPool);
        if (publicExport && !pooled && !(typeof req?.password === 'string' && req.password.length > 0)) {
            const locked = new Error('Unlock this wallet again to show its extended public keys.');
            locked.code = 'WALLET_SESSION_LOCKED';
            throw locked;
        }
        const signer = pooled
            || await unlockWallet({
                vault,
                walletId,
                password: req?.password,
                bip39Passphrase: req?.bip39Passphrase,
                chainRegistry,
                sdkRegistry,
            });
        try {
            return await fn(signer, await getSettings(vault), wallet);
        } finally {
            // The pool owns the lifecycle of a pooled signer; only a signer
            // we unlocked ourselves gets locked here.
            if (!pooled) signer.lock();
        }
    }

    // Chains to publish in a pairing payload: the wallet's active chains
    // (settings.fees is seeded per active chain by ensureSettings, the same
    // derivation useReachability uses), narrowed to the active network so a
    // mainnet payload never advertises regtest keys.
    function pairingChainIds(req, settings, chainRegistry) {
        if (Array.isArray(req?.chainIds) && req.chainIds.length > 0) return req.chainIds;
        const network = settings?.activeNetwork || 'mainnet';
        return Object.keys(settings?.fees || {})
            .filter((id) => chainRegistry.descriptorFor(id)?.networkKind === network)
            .sort();
    }

    host.register('pairing.payload', async (req, deps) => {
        const { chainRegistry } = deps;
        return withPairingSigner(req, deps, async (signer, settings, wallet) => {
            const keys = await collectPairingKeys({
                signer,
                chainRegistry,
                chainIds: pairingChainIds(req, settings, chainRegistry),
                accountIndex: Number.isInteger(req?.accountIndex) && req.accountIndex >= 0
                    ? req.accountIndex
                    : 0,
                // Match SoftwareSigner's fallback for records written before format was stored.
                format: wallet.format ?? 'bip39',
            });
            if (req?.publicExport === true) {
                const publicKeys = keys
                    .filter((key) => /^(?:xpub|tpub)[1-9A-HJ-NP-Za-km-z]+$/.test(key?.xpub || ''))
                    .map((key) => ({
                        chainId: key.chainId,
                        addressType: key.addressType,
                        path: key.path,
                        xpub: key.xpub,
                    }));
                if (publicKeys.length === 0) {
                    throw new Error('pairing.payload: this wallet has no extended public keys to export');
                }
                return { payload: { keys: publicKeys }, encoded: null };
            }
            const payload = buildPairingPayload({
                walletMode: wallet.walletMode,
                keys,
                label: typeof req?.label === 'string' ? req.label : '',
            });
            return { payload, encoded: encodePairingPayload(payload) };
        });
    });

    host.register('pairing.pair', async (req, deps) => {
        const { vault, chainRegistry } = deps;
        return withPairingSigner(req, deps, async (signer, settings, wallet) => {
            const keys = await collectPairingKeys({
                signer,
                chainRegistry,
                chainIds: pairingChainIds(req, settings, chainRegistry),
                // Match SoftwareSigner's fallback for records written before format was stored.
                format: wallet.format ?? 'bip39',
            });
            const local = buildPairingPayload({
                walletMode: wallet.walletMode,
                keys,
                label: typeof req?.label === 'string' ? req.label : '',
            });
            const { verification, patch } = pairPartner({ local, partner: req?.partner });
            const updated = await updateSettings(vault, patch);
            return { verification, partnerPairing: updated.partnerPairing, settings: updated };
        });
    });

    host.register('pairing.unpair', async (_req, { vault }) => {
        const updated = await updateSettings(vault, { partnerPairing: null });
        return { settings: updated };
    });

    // §26: background auto-lock arm/disarm. The foreground `useAutoLock`
    // hook owns the decision of WHETHER auto-lock applies (it skips demo
    // wallets and honours the shell) and the idle threshold; it reports that
    // here so the service worker can lock the wallet after the popup closes,
    // when the foreground timer no longer runs. Sender-gated to the trusted
    // extension UI by the transport (not a `bridge.*` type).
    // Forward the foreground `activity` flag: an activity report restarts the
    // idle window and can never re-arm a disarmed record.
    // An arm storage refuses locks the wallet: a worker restart would find no
    // record and leave the session open for good. The reply tells the surface
    // that armed it, so it can say why the wallet locked.
    host.register('session.autolock', async (req) => {
        const { saved } = await applyAutoLockSignal(
            {
                armed: req?.armed === true,
                idleMs: req?.idleMs,
                activity: req?.activity === true,
                issuedAt: req?.issuedAt,
            },
            Date.now(),
        );
        if (saved) return { ok: true };
        try {
            await onAutoLockArmRefused?.();
        } catch (err) {
            console.error('[xchain] lock after a refused auto-lock arm failed:', err);
        }
        return { ok: false, reason: AUTO_LOCK_UNSAVED };
    });

    // §19.6: dry-run restore. Derive the first N addresses per active
    // chain from a candidate mnemonic and compare against the current
    // wallet. Nothing persists. The flow zeroes the seed material on
    // exit; we forward the comparison report verbatim.
    host.register('wallet.dryRunRestore', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return dryRunRestore({
            vault,
            walletId: req?.walletId,
            mnemonic: req?.mnemonic,
            format: req?.format,
            bip39Passphrase: req?.bip39Passphrase,
            activeChainIds: req?.activeChainIds,
            gapLimit: req?.gapLimit,
            accountIndex: req?.accountIndex,
            change: req?.change,
            chainRegistry,
            sdkRegistry,
        });
    });

    // §19.3: reveal seed mnemonic. Decrypts the wallet's encrypted
    // seed blob (the AEAD tag check doubles as the password probe) and
    // returns the plaintext mnemonic for display. The shell UX owns
    // tap-to-reveal, auto-hide on blur, no clipboard write: this
    // handler is the pure primitive.
    host.register('wallet.revealMnemonic', async (req, { vault }) => {
        assertWalletUnlockedForReveal(vault, 'revealMnemonic');
        return revealMnemonic({
            vault,
            walletId: req?.walletId,
            password: req?.password,
        });
    });

    // §19.5.2 / G037: manual on-chain label publish. Encrypts the
    // wallet's labels + contacts under the seed-derived commitment key
    // and broadcasts the ciphertext as a FILE action on the chosen
    // chain. Auto-sync (debounced on label change) and fetch-on-restore
    // are tracked in FOLLOWUPS.md; this handler powers the user-visible
    // "Publish now" button only.
    // §50 / G156: diagnostic dump. Returns a JSON-shaped support packet
    // (wallet metadata + chain registry + endpoint config + record counts +
    // recent errors). The shell is responsible for surfacing it (Copy
    // button on About panel, etc.) so users can paste it into a bug
    // report. No secrets included: this passes the diagnosticDump flow's
    // own redaction.
    host.register('diagnostic.dump', async (req, { vault, chainRegistry }) => {
        // §50 / Cluster L FOLLOWUP 4: fill env / build / signers so the
        // dump tells support which shell + build + paired devices were
        // running. The shell-supplied callback contributes env + build
        // (it's the only place that knows shell / UA / manifest /
        // electron version). The signers list is computed here from the
        // open vault so each shell doesn't have to duplicate the
        // per-wallet iteration.
        let ctx = {};
        try {
            ctx = (await getDiagnosticContext?.()) || {};
        } catch {
            ctx = {};
        }
        let signers = [];
        try {
            const wallets = await vault.wallets.list();
            for (const w of wallets) {
                const rows = await listSignersForWallet(vault, w.id);
                for (const r of rows) {
                    signers.push({
                        id: r.id,
                        vendor: r.vendor,
                        model: r.model,
                        firmwareVersion: r.firmwareVersion ?? null,
                    });
                }
            }
        } catch {
            signers = [];
        }
        // Cluster Q FOLLOWUP 5: surface the background process's
        // logConsole entries in the dump. The SW process records vault
        // / signer / encoder / bridge events under typed `source` tags
        // (Cluster Q FOLLOWUP 4): no key material, no addresses, just
        // operational events. Capped at 100 entries; per-line copy
        // capped at 500 chars. logConsole is its own ESM singleton, so
        // a load failure here just yields an empty log array and never
        // breaks the dump itself.
        let recentLogs = [];
        try {
            recentLogs = logConsole.snapshot({ limit: 100, messageLimit: 500 });
        } catch {
            recentLogs = [];
        }
        return diagnosticDump({
            vault,
            chainRegistry,
            walletVersion: WALLET_VERSION,
            env: ctx.env,
            build: ctx.build,
            signers,
            // Shell-side crashes arrive with the request; merge them with the
            // background's own buffer, oldest first (the dump keeps the tail).
            recentErrors: [
                ...(Array.isArray(req?.recentErrors) ? req.recentErrors : []),
                ...errorBuffer.list(),
            ],
            recentLogs,
        });
    });

    // §15.5 / G020: add a single imported WIF (private key) to an existing
    // HD wallet. Caller (shell) is responsible for surfacing the
    // §15.5.3 backup-implications warning before invoking this handler.
    host.register('wallet.importWif', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        // Unlocked session: pull the vault master key from the pooled
        // signer so the UI does not have to re-prompt for the password.
        let sessionMasterKey = null;
        const pooled = signerPool && typeof signerPool.get === 'function'
            ? signerPool.get(req?.walletId)
            : null;
        if (!req?.password && pooled && typeof pooled.getMasterKey === 'function') {
            try { sessionMasterKey = pooled.getMasterKey(); } catch { /* locked: fall through */ }
        }
        const r = await importWif({
            vault,
            walletId: req?.walletId,
            password: req?.password,
            masterKey: sessionMasterKey || undefined,
            chainId: req?.chainId,
            wif: req?.wif,
            addressType: req?.addressType,
            label: req?.label,
            chainRegistry,
            sdkRegistry,
        });
        // The unlocked signer read its imported keys at unlock, so hand it
        // the new one; otherwise every send or sweep from this address fails
        // until a relock. A locked signer reads it from the vault at the next
        // unlock, so a refusal here never fails an import the vault holds.
        if (pooled && typeof pooled.addImportedWif === 'function' && r?.address?.id) {
            try { pooled.addImportedWif(r.address.id, req.wif); } catch { /* locked: next unlock reads it */ }
        }
        return { wallet: toSafeWallet(r.wallet), address: r.address };
    });

    host.register('wallet.prepareLabels', async (req, { vault, chainRegistry, signerPool }) => {
        await refuseHardwareLabelSync(vault, req?.walletId);
        // Fund the FILE tx from the same address Send would use.
        // Same walletId-only resolution useActionForm/Send use for
        // `addresses.active` (no accountId), so the source lines up with
        // whatever Home/Send show as this wallet's chain balance instead of
        // the highest-index HD address, which is very often unfunded.
        const active = await resolveActiveAddresses({ vault, walletId: req?.walletId, chainRegistry });
        // Unlocked session: open the seed with the pooled signer's master
        // key, so the Backup page asks for no password (2026-11-14).
        const session = pooledSoftwareSession(signerPool, req?.walletId, req?.password);
        return prepareLabelsPublication({
            vault,
            walletId: req?.walletId,
            password: req?.password,
            masterKey: session?.masterKey,
            bip39Passphrase: req?.bip39Passphrase,
            chainId: req?.chainId,
            chainRegistry,
            activeEntry: active?.[req?.chainId],
            fee: req?.fee,
            feePerKb: req?.feePerKb,
        });
    });

    host.register('wallet.publishLabels', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        await refuseHardwareLabelSync(vault, req?.walletId);
        // Unlocked session: sign with the pooled signer and open the seed
        // with its master key, so no password is asked (2026-11-14). The
        // pool owns the signer, so submitAction leaves it unlocked.
        const session = pooledSoftwareSession(signerPool, req?.walletId, req?.password);
        const common = {
            vault,
            walletId: req?.walletId,
            password: req?.password,
            masterKey: session?.masterKey,
            signer: session?.signer,
            bip39Passphrase: req?.bip39Passphrase,
            chainRegistry,
            sdkRegistry,
            // Queue the signed bytes on a transient broadcast failure, as the
            // action.* routes do; the throw skips the batch clear below.
            onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId),
        };
        const r = req?.preparation
            ? await submitLabelsPublication({
                ...common,
                preparation: req.preparation,
                prebuiltPsbt: req?.prebuiltPsbt,
            })
            : await publishLabelsNow({
                ...common,
                chainId: req?.chainId,
                // Same active-address preference as wallet.prepareLabels
                // This branch runs when the caller skipped the
                // separate prepare/confirm step and asked publishLabelsNow
                // to prepare AND submit in one call.
                activeEntry: (await resolveActiveAddresses({
                    vault,
                    walletId: req?.walletId,
                    chainRegistry,
                }))?.[req?.chainId],
                fee: req?.fee,
                feePerKb: req?.feePerKb,
            });
        // The payload just published carries every pending edit,
        // whether the user got here from the auto-sync prompt or hit
        // "Publish now" by hand. Either way the batch is satisfied.
        labelSyncPending = null;
        labelSyncScheduler.markPublished();
        return r;
    });

    // §19.5.2 auto-sync state for the Backup panel. Returns the pending
    // batch (edits waiting on a publish) plus the scheduler status, so
    // the shell can raise ONE prompt per unlock window. Read-only: the
    // publish itself still runs through `wallet.publishLabels`, with the
    // pooled signer when the session holds one and a typed password
    // otherwise.
    host.register('wallet.labelSyncStatus', async (_req, { vault }) => {
        if (vault && !labelSyncVault) labelSyncVault = vault;
        return {
            ...labelSyncScheduler.status(),
            due: labelSyncPending !== null,
            batch: labelSyncPending,
        };
    });

    // Dismiss the pending auto-sync prompt for this unlock window. The
    // edits stay dirty, so the next unlock window re-raises rather than
    // silently dropping the user's labels.
    host.register('wallet.labelSyncDismiss', async () => {
        labelSyncPending = null;
        return { ok: true };
    });

    // §19.5.2 restore, on-demand half: the Backup panel's "Check chain for
    // backed-up contacts" button. The automatic restore only ever runs once,
    // inside a from-seed import; a wallet that already exists (or that
    // published from a different device since) has no other way to re-pull
    // that payload. 'preserve' because, unlike the fresh vault an import
    // writes into, this wallet may already hold edits made since the last
    // publish that a stale chain copy must not clobber. Password errors and
    // bad arguments throw here (unlike `restoreLabelSyncBestEffort`, which
    // swallows everything for the best-effort import path) so the panel can
    // show the user why the check failed.
    host.register('wallet.restoreLabels', async (req, { vault, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        const chainId = req?.chainId;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('wallet.restoreLabels: walletId is required');
        }
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('wallet.restoreLabels: chainId is required');
        }
        await refuseHardwareLabelSync(vault, walletId);
        // Unlocked session: the pooled signer's master key opens the seed.
        // It was derived under the wallet record's kdfParams at unlock, which
        // the flow checks before it uses the key (2026-11-14).
        const session = pooledSoftwareSession(signerPool, walletId, req?.password);
        const sessionKdfParams = session ? (await vault.wallets.get(walletId))?.kdfParams : undefined;
        return restoreLabelSyncAfterImport({
            vault,
            walletId,
            password: req?.password,
            masterKey: session?.masterKey,
            masterKeyKdfParams: sessionKdfParams,
            bip39Passphrase: req?.bip39Passphrase,
            chainIds: [chainId],
            sdkRegistry,
            onConflict: 'preserve',
        });
    });

    // §19.4 encrypted backup: returns the pretty-printed JSON envelope
    // string. The renderer is responsible for triggering the download.
    host.register('wallet.exportBackup', async (req, { vault }) => {
        const r = await exportBackupFile({
            vault,
            walletId: req?.walletId,
            password: req?.password,
            includePendingTxs: req?.includePendingTxs,
        });
        return { fileContent: r.fileContent };
    });

    // §19.4 / G036: restore an encrypted backup envelope into the live
    // vault. The renderer hands the raw JSON string + decrypt password
    // + conflict policy. Returns the imported walletId + write/skip
    // counts so the shell can surface "Imported wallet 'X' with N
    // addresses" copy.
    host.register('wallet.importBackup', async (req, { vault, vaultKeyring, chainRegistry, sdkRegistry }) => {
        await assertRestoreDevicePassword(req?.devicePassword, vault, vaultKeyring);
        // The re-seal's key, lent so the recovery record needs no second derivation.
        let lentKey = null;
        try {
            const r = await importBackupFile({
                onDeviceKey: (key) => {
                    if (lentKey) lentKey.fill(0);
                    lentKey = new Uint8Array(key);
                },
                vault,
                fileContent: req?.fileContent,
                password: req?.password,
                // `password` opens the FILE. These two move the
                // wallet's own seal onto this device, and without them a
                // restored wallet lands unsignable and says nothing.
                walletPassword: req?.walletPassword,
                devicePassword: req?.devicePassword,
                onConflict: req?.onConflict,
                mode: req?.mode,
                chainRegistry,
            });
            if (r.writes?.settings) await rehydrateAfterSettingsRestore(vault, chainRegistry, sdkRegistry);
            await publishSurfaceState('wallets', { change: 'added', walletId: r.walletId });
            // Copied synchronously inside, so the finally below may zero ours.
            refreshPhraseRecoveryAfterAdd({ vault, vaultKeyring }, req?.devicePassword,
                lentKey && r.walletId ? new Map([[r.walletId, lentKey]]) : undefined);
            return {
                walletId: r.walletId,
                writes: r.writes,
                skipped: r.skipped,
                rekeyed: r.rekeyed,
                walletName: r.payload?.wallet?.name,
            };
        } finally {
            // An import that fails after the re-seal (a conflict, a write)
            // has already lent the key; it is zeroed on that path too.
            if (lentKey) lentKey.fill(0);
        }
    });

    // §15.4: QR-from-backup-pointer restore. The renderer hands the
    // parsed pointer (from `detectQrContent`) + the backup password.
    // The host injects the resolver: it fetches the encrypted §19.4
    // envelope from the pointer's `location` and hands it to the same
    // `importBackupFile` merge path the file lane uses. Only https(s)
    // locations are fetched; on-chain FILE references are a follow-up
    // that needs SDK wiring and are rejected explicitly rather than
    // silently ignored.
    host.register('wallet.importBackupPointer', async (req, { vault, vaultKeyring, chainRegistry, sdkRegistry }) => {
        await assertRestoreDevicePassword(req?.devicePassword, vault, vaultKeyring);
        const r = await restoreFromBackupPointer({
            vault,
            pointer: req?.pointer,
            password: req?.password,
            walletPassword: req?.walletPassword,     // As wallet.importBackup above
            devicePassword: req?.devicePassword,
            onConflict: req?.onConflict,
            mode: req?.mode,
            chainRegistry,
            resolveBackupContent: resolveBackupPointerContent,
        });
        if (r.writes?.settings) await rehydrateAfterSettingsRestore(vault, chainRegistry, sdkRegistry);
        await publishSurfaceState('wallets', { change: 'added', walletId: r.walletId });
        refreshPhraseRecoveryAfterAdd({ vault, vaultKeyring }, req?.devicePassword);
        return {
            walletId: r.walletId,
            writes: r.writes,
            skipped: r.skipped,
            rekeyed: r.rekeyed,
            walletName: r.payload?.wallet?.name,
            pointer: r.pointer,
        };
    });

    // §35.1: destructively remove a wallet and all its descendants.
    // The host clears the wallet's SignerPool entry too so a removed
    // wallet doesn't linger as an unlocked-key reference.
    host.register('wallet.remove', async (req, { vault, signerPool, vaultKeyring }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('wallet.remove: walletId is required');
        }
        const [removedAccounts, sitesBefore] = await Promise.all([
            vault.accounts.findBy('walletId', walletId),
            vault.connectedSites.list(),
        ]);
        const result = await removeWallet({ vault, walletId });
        // A removed wallet's recovery phrase must stop resetting this vault.
        await refreshPhraseRecoveryAfterRemove({ vault, vaultKeyring }, walletId);
        if (signerPool && typeof signerPool.evict === 'function') {
            try { signerPool.evict(walletId); } catch { /* best-effort */ }
        }
        // The queued-broadcast surface is keyed by walletId on its own storage
        // key, so `removeWallet`'s PendingTx prune does not reach it. Left
        // alone, the removed wallet's entries keep their signed spends in the
        // blob and rehydrate into every later boot, and no route can list them
        // again because the banner only ever asks for the active wallet.
        await pruneWalletFromQueue(walletId);
        await publishSurfaceState('wallets', {
            change: 'removed',
            walletId,
            ...(typeof req?.surfaceId === 'string' && req.surfaceId ? { originSurface: req.surfaceId } : {}),
        });
        const removedAccountIds = new Set(removedAccounts.map((account) => account.id));
        const affectedOrigins = new Set(sitesBefore
            .filter((site) => {
                if (removedAccountIds.size === 0) return false;
                const grants = Array.isArray(site?.permissions?.accounts)
                    ? site.permissions.accounts
                    : [];
                return grants.length === 0 || grants.some((id) => removedAccountIds.has(id));
            })
            .map((site) => site.origin));
        const sitesAfter = await vault.connectedSites.list();
        const survivingOrigins = new Set(sitesAfter.map((site) => site.origin));
        await notifyDisconnectedSites({
            events: bridgeEvents,
            sites: sitesBefore.filter((site) => (
                affectedOrigins.has(site.origin) && !survivingOrigins.has(site.origin)
            )),
            reason: 'wallet-removed',
        });
        await announceAccountChange(
            vault,
            bridgeEvents,
            [],
            sitesAfter.filter((site) => affectedOrigins.has(site.origin)),
        );
        return result;
    });

    // §35.1 + §43 connected-sites maintenance. The approval-flow record
    // creation lives in bridge/handlers.js.
    host.register('sites.list', async (_req, { vault }) => {
        const sites = await vault.connectedSites.list();
        return [...sites].sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
    });
    host.register('sites.delete', async (req, { vault }) => {
        const id = req?.id;
        if (typeof id !== 'string' || !id) {
            throw new Error('sites.delete: id is required');
        }
        let site = null;
        if (typeof vault.connectedSites.get === 'function') {
            site = await vault.connectedSites.get(id);
        } else if (typeof vault.connectedSites.list === 'function') {
            site = (await vault.connectedSites.list()).find((candidate) => candidate.id === id);
        }
        const cancellation = site
            ? cancelMatchingApprovals(approvals, (origin) => origin === site.origin)
            : Promise.resolve(0);
        await vault.connectedSites.delete(id);
        if (site) {
            await Promise.all([
                cancellation,
                emitSiteDisconnect(bridgeEvents, site.origin, 'user-revoked'),
            ]);
        }
        return { ok: true };
    });

    // §37.2 / Cluster D FOLLOWUP 1: restore a ConnectedSite from a
    // snapshot. Used by the Disconnect-site Undo toast: the renderer
    // hangs onto the full site record before calling sites.delete and
    // posts it back here when the user taps Undo. The handler is
    // intentionally permissive about shape: it accepts the schema
    // record verbatim: so a future edit to the ConnectedSite schema
    // won't silently break the undo round-trip.
    host.register('sites.restore', async (req, { vault }) => {
        const site = req?.site;
        if (!site || typeof site !== 'object') {
            throw new Error('sites.restore: site is required');
        }
        if (typeof site.id !== 'string' || !site.id) {
            throw new Error('sites.restore: site.id is required');
        }
        if (typeof site.origin !== 'string' || !site.origin) {
            throw new Error('sites.restore: site.origin is required');
        }
        const settings = await vault.settings.get().catch(() => null);
        if (isOriginBlocked(settings?.blockedOrigins, site.origin)) {
            // The code lets the Undo toast explain the refusal without reading this message.
            throw Object.assign(new Error('sites.restore: origin is blocked'), { code: 'BLOCKED_BY_USER' });
        }
        // The site may have reconnected after the disconnect. Its new grant is
        // the one the user last chose, and a second record for the origin would
        // leave two grants with the bridge reading whichever comes back first.
        const existing = await vault.connectedSites.findBy('origin', site.origin);
        if (existing.some((candidate) => candidate.id !== site.id)) {
            return { ok: true, restored: false };
        }
        await vault.connectedSites.put(site);
        return { ok: true, restored: true };
    });

    // Settings > Connected Sites > Options: the live sign-request throttle in
    // one read, the limits in force plus each site's used count and wait.
    host.register('sites.throttleStatus', async () => signThrottle.status());

    // §12 / G009: origin blocklist. listBlockedOrigins reads from
    // settings.blockedOrigins; addBlockedOrigin also evicts any
    // ConnectedSite record on the same origin so an in-flight session
    // can't keep signing.
    host.register('sites.listBlocked', async (_req, { vault }) => {
        return listBlockedOrigins({ vault });
    });
    host.register('sites.block', async (req, { vault }) => {
        const origin = req?.origin;
        if (typeof origin !== 'string' || !origin) {
            throw new Error('sites.block: origin is required');
        }
        const cancelPending = () => cancelMatchingApprovals(
            approvals,
            (candidate) => typeof candidate === 'string'
                && isOriginBlocked([origin], candidate),
        );
        const initialCancellation = cancelPending();
        const sitesBeforeBlock = typeof vault.connectedSites.list === 'function'
            ? await vault.connectedSites.list()
            : [];
        const result = await addBlockedOrigin({ vault, origin });
        const evictedIds = new Set(result.evictedSiteIds);
        let evictedOrigins = [...new Set(
            sitesBeforeBlock
                .filter((site) => evictedIds.has(site.id))
                .map((site) => site.origin),
        )];
        if (evictedOrigins.length === 0
            && evictedIds.size > 0
            && !result.blocked.startsWith('*.')) {
            evictedOrigins = [result.blocked];
        }
        await Promise.all([
            initialCancellation,
            cancelPending(),
            ...evictedOrigins.map((evictedOrigin) => (
                emitSiteDisconnect(bridgeEvents, evictedOrigin, 'blocked-by-user')
            )),
        ]);
        return result;
    });
    host.register('sites.unblock', async (req, { vault }) => {
        const origin = req?.origin;
        if (typeof origin !== 'string' || !origin) {
            throw new Error('sites.unblock: origin is required');
        }
        return removeBlockedOrigin({ vault, origin });
    });

    // Cluster S FOLLOWUP 4: blocklist audit-log surface.
    host.register('sites.auditLog.list', async (_req, { vault }) => {
        return listBlocklistAuditLog({ vault });
    });
    host.register('sites.auditLog.clear', async (_req, { vault }) => {
        return clearBlocklistAuditLog({ vault });
    });

    // §9.7 / G007: runtime chain-registry refresh from hub. Wallet-side
    // scaffolding only today; the hub-side `/api/v1/chain-registry`
    // endpoint is pending (tracked as Cluster U FOLLOWUP). On boot we
    // try once with a short timeout; failures fall back silently to
    // the bundled descriptors. Settings → Network surfaces the status.
    const chainRegistryStatus = createChainRegistryStatus();
    host.register('chainRegistry.status', async () => chainRegistryStatus.get());
    host.register('chainRegistry.refresh', async (_req, { chainRegistry: cr }) => {
        const hubUrl = pickHubUrlFromRegistry(cr);
        if (!hubUrl) {
            const result = {
                ok: false,
                hubUrl: '',
                lastRefreshedAt: null,
                descriptorCount: 0,
                error: 'no hub URL configured for any active chain',
            };
            chainRegistryStatus.update(result);
            return result;
        }
        const result = await refreshChainRegistry({ hubUrl });
        chainRegistryStatus.update(result);
        return result;
    });
    // Boot-time refresh is disabled until the hub-side
    // `/api/v1/chain-registry` endpoint ships (Cluster U FOLLOWUP).
    // The Settings → Network manual refresh path still works for
    // testing against a hub that does serve the endpoint. Flip this
    // back on once hub.xchain.io is live.
    const BOOT_REFRESH_ENABLED = false;
    if (BOOT_REFRESH_ENABLED && typeof setTimeout === 'function') {
        setTimeout(async () => {
            try {
                const hubUrl = pickHubUrlFromRegistry(deps.chainRegistry);
                if (!hubUrl) return;
                const result = await refreshChainRegistry({ hubUrl });
                chainRegistryStatus.update(result);
            } catch { /* swallow: never crash boot on a refresh */ }
        }, 3_000);
    }

    // §9.7 / G007: periodic background refresh. The boot refresh above
    // fires once; this keeps long-running instances current so they pick
    // up fresh descriptors within a day of the hub endpoint going live,
    // without a manual Settings → Network refresh. Gated by the same
    // BOOT_REFRESH_ENABLED switch as the boot refresh: flipping that flag
    // on (once `/api/v1/chain-registry` ships) activates both, so there is
    // no separate "wire the periodic refresh" step left to do. Reuses the
    // same refreshChainRegistry + status-update path, so the graceful
    // bundled-descriptor fallback applies unchanged.
    //
    // Lifetime: in the MV3 service worker the interval lives only as long
    // as the worker (Chrome tears it down when idle: chrome.alarms is the
    // durable mechanism there, see background/index.js); the web shell
    // (one host per tab) and desktop shell (one host per main process) are
    // long-lived, so it fires there. `host.stopChainRegistryRefresh()`
    // clears it for shells/tests that own a teardown path.
    const PERIODIC_REFRESH_MS = 24 * 60 * 60 * 1_000;
    let chainRegistryRefreshTimer = null;
    if (BOOT_REFRESH_ENABLED && typeof setInterval === 'function') {
        chainRegistryRefreshTimer = setInterval(async () => {
            try {
                const hubUrl = pickHubUrlFromRegistry(deps.chainRegistry);
                if (!hubUrl) return;
                const result = await refreshChainRegistry({ hubUrl });
                chainRegistryStatus.update(result);
            } catch { /* swallow: never crash on a refresh */ }
        }, PERIODIC_REFRESH_MS);
        // Don't let the refresh timer alone keep a Node main process
        // (desktop) alive at exit.
        if (chainRegistryRefreshTimer && typeof chainRegistryRefreshTimer.unref === 'function') {
            chainRegistryRefreshTimer.unref();
        }
    }
    host.stopChainRegistryRefresh = () => {
        if (chainRegistryRefreshTimer !== null) {
            clearInterval(chainRegistryRefreshTimer);
            chainRegistryRefreshTimer = null;
        }
    };

    // §9.7 / Cluster Q FOLLOWUP 2: custom (user-added) chain registry.
    // Persisted under settings.customChains; re-seeded into the running
    // ChainRegistry at boot via seedCustomChainsFromVault(). The three
    // routes below are the runtime mutation surface: Developer Mode UI
    // calls them.
    host.register('chainRegistry.listCustomChains', async (_req, { vault }) => {
        const descriptors = await listCustomChains({ vault });
        return { descriptors };
    });
    // Both mutators take `sdkRegistry` so the chain's cached SDK client is
    // dropped along with its descriptor. Without it, removing a chain and
    // re-adding the same id with different endpoints kept every request,
    // signed submissions included, pointed at the ORIGINAL node for the
    // rest of the session.
    host.register('chainRegistry.addCustomChain', async (req, { vault, chainRegistry, sdkRegistry }) => {
        if (!req || typeof req !== 'object' || !req.descriptor) {
            throw new Error('A network description is required.');
        }
        const added = await addCustomChain({ vault, chainRegistry, sdkRegistry, descriptor: req.descriptor });
        await publishSurfaceState('custom-chains', {});
        return added;
    });
    host.register('chainRegistry.removeCustomChain', async (req, { vault, chainRegistry, sdkRegistry }) => {
        if (!req || typeof req !== 'object' || typeof req.chainId !== 'string') {
            throw new Error('chainRegistry.removeCustomChain: chainId required');
        }
        const outcome = await removeCustomChain({ vault, chainRegistry, sdkRegistry, chainId: req.chainId });
        if (outcome?.removed) await publishSurfaceState('custom-chains', {});
        return outcome;
    });

    // §31.4 / Cluster O FOLLOWUP 2: recipient resolution for DIVIDEND
    // and AIRDROP history rows. Both action kinds carry a *derived*
    // recipient set that History needs to surface for the §31.4
    // save-as-contact affordance. DIVIDEND walks holders of TICK at
    // the snapshot block; AIRDROP walks the referenced LIST's ITEM
    // array.
    host.register('history.getDividendRecipients', async (req, { sdkRegistry }) => {
        return getDividendRecipients({
            sdkRegistry,
            chainId: req?.chainId,
            actionIndex: req?.actionIndex,
            tick: req?.tick,
        });
    });
    host.register('history.getAirdropRecipients', async (req, { sdkRegistry }) => {
        return getAirdropRecipients({
            sdkRegistry,
            chainId: req?.chainId,
            actionIndex: req?.actionIndex,
            listActionIndex: req?.listActionIndex,
        });
    });


    host.register('receive.getAddress', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        // §17.6 / G023: the account's stored addresses pick the signer (see
        // accountDeviceSignerId). A device account derives on its linked
        // device, and a request's signerId may only repeat that link; a seed
        // account uses the pool's pre-unlocked software signer, or the flow's
        // password unlock without one. An account no single signer holds is
        // refused before anything derives.
        const signer = await pickSignerFromRequest({
            vault,
            walletId: req?.walletId,
            signerId: await accountDeviceSignerId(vault, req, 'receive.getAddress'),
            signerPool,
        });
        return receiveAddress({
            ...req,
            signer: signer || undefined,
            vault,
            chainRegistry,
            sdkRegistry,
        });
    });

    // §17.6: confirm a persisted hardware receive address on the device's
    // trusted screen and cross-check it against what the wallet holds. The
    // Receive screen's "Verify on your device" action calls this. The signer
    // is the device the stored address record is linked to, never the pooled
    // software key: a software derivation of the same seed matches without
    // any device showing the address.
    host.register('receive.verifyAddress', async (req, { vault, chainRegistry }) => {
        const { address, signer } = await linkedDeviceSignerForVerify(req, vault);
        return verifyReceiveAddress({
            vault,
            chainId: req?.chainId,
            addressId: address.id,
            signer,
            chainRegistry,
        });
    });

    // §16 dispenser address. Same signer-resolution path as
    // receive.getAddress; derives the next external (change=0) address
    // under the active account, tagged role='dispenser' (see
    // flows/dispenserAddress.js for why it shares the receive branch).
    host.register('dispenser.getAddress', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const signer = await pickSignerFromRequest({
            vault,
            walletId: req?.walletId,
            signerId: await accountDeviceSignerId(vault, req, 'dispenser.getAddress'),
            signerPool,
        });
        return dispenserAddress({
            ...req,
            signer: signer || undefined,
            vault,
            chainRegistry,
            sdkRegistry,
        });
    });

    host.register('addresses.byChain', async (req, { vault, chainRegistry }) => {
        return addressesByChain(req, { vault, chainRegistry });
    });

    host.register('addresses.newest', async (req, { vault, chainRegistry }) => {
        return newestAddress(req, { vault, chainRegistry });
    });

    // Every wallet's public addresses in one read, for the My Wallets search.
    host.register('addresses.byWallet', async (req, { vault, chainRegistry }) => {
        return addressesByWallet(req, { vault, chainRegistry });
    });

    // Which of the chain's registry address types the installed SDK can generate,
    // so no picker offers one that generation then refuses. `supported` is null
    // when the SDK cannot be asked yet; the caller then keeps the registry list.
    host.register('sdk.addressTypes', async (req, { chainRegistry, sdkRegistry }) => {
        const descriptor = chainRegistry.get(req?.chainId);
        if (!descriptor) throw new Error(`sdk.addressTypes: unknown chain "${req?.chainId}"`);
        let sdk;
        try {
            sdk = sdkRegistry.get(descriptor.id);
        } catch {
            return { supported: null };
        }
        return { supported: sdkSupportedAddressTypes(sdk, descriptor.addressTypes) };
    });

    // Rename an address: set its user-facing label by record id.
    host.register('addresses.setLabel', async (req, { vault }) => {
        const id = req?.id;
        if (!id) throw new Error('addresses.setLabel: id is required');
        const rec = await vault.addresses.get(id);
        if (!rec) throw new Error('addresses.setLabel: address not found');
        const label = schemas.address.normalizeAddressLabel(req?.label, rec);
        await vault.addresses.put({ ...rec, label });
        // §19.5.2 auto-sync: the on-chain copy is now stale (the scheduler
        // batches renames). Never for a hardware wallet: it has no seed key.
        const account = rec.accountId ? await vault.accounts.get(rec.accountId) : null;
        const walletId = account?.walletId ?? null;
        if (!(walletId && isHardwareWallet(await vault.wallets.get(walletId)))) noteLabelChange({ vault }, walletId);
        return { ok: true, label };
    });

    // Keep hidden addresses in the vault and off the main list. The list's
    // collapsed hidden section remains the recovery path for this flag.
    host.register('addresses.setHidden', async (req, { vault }) => {
        const id = req?.id;
        if (!id) throw new Error('addresses.setHidden: id is required');
        if (typeof req?.hidden !== 'boolean') {
            throw new Error('addresses.setHidden: hidden must be a boolean');
        }
        const rec = await vault.addresses.get(id);
        if (!rec) throw new Error('addresses.setHidden: address not found');
        await vault.addresses.put({ ...rec, hidden: req.hidden });
        return { ok: true };
    });

    // Delete an address record by id (e.g. an imported WIF the user no
    // longer wants surfaced). A derived address comes back through
    // receive.getAddress, which re-derives the lowest index no record
    // holds; the record's funds stay on chain meanwhile.
    host.register('addresses.delete', async (req, { vault }) => {
        const id = req?.id;
        if (!id) throw new Error('addresses.delete: id is required');
        const removed = await vault.addresses.delete(id);
        return { ok: removed };
    });

    // §37.2 / Cluster D FOLLOWUP 2: restore an Address record from a
    // snapshot the renderer took before calling addresses.delete. This
    // is the host half of the delete-address Undo toast.
    //
    // The snapshot is written back verbatim so a future Address schema
    // field survives the round-trip; only `id` and `address` are
    // required by shape. What the route does NOT do is more important
    // than what it does, because the toast leaves an 8 s window in
    // which the vault can move underneath the snapshot:
    //
    //   - a second press (or a record that came back some other way)
    //     must not re-put over whatever is on disk now, so an existing
    //     id short-circuits as a no-op success;
    //   - the user can re-import the same WIF while the toast is up.
    //     That mints a NEW record for the SAME address string, and
    //     writing the snapshot back on top would list one address twice
    //     with two ids: a duplicate that outlives the toast and that
    //     `assertNotAlreadyImported` would never have allowed;
    //   - the owning account or imported-key wallet can be deleted while the toast is up
    //     (removeWallet takes its addresses with it). Restoring into a
    //     gone account resurrects a row whose key no longer exists, so
    //     that fails closed too.
    //
    // Deleting an address does not touch `wallet.importedKeys`, so the
    // encrypted WIF is still there and putting the record back is the
    // whole of the undo.
    host.register('addresses.restore', async (req, { vault }) => {
        const address = req?.address;
        if (!address || typeof address !== 'object') {
            throw new Error('addresses.restore: address is required');
        }
        if (typeof address.id !== 'string' || !address.id) {
            throw new Error('addresses.restore: address.id is required');
        }
        if (typeof address.address !== 'string' || !address.address) {
            throw new Error('addresses.restore: address.address is required');
        }
        const existing = await vault.addresses.get(address.id);
        if (existing) return { ok: true, restored: false, reason: 'already-restored' };

        const all = await vault.addresses.list();
        const duplicate = (Array.isArray(all) ? all : []).some((r) => r
            && r.address === address.address
            && r.chain === address.chain
            && r.network === address.network);
        if (duplicate) return { ok: false, restored: false, reason: 'address-already-present' };

        if (address.accountId) {
            const account = await vault.accounts?.get?.(address.accountId);
            if (!account) return { ok: false, restored: false, reason: 'account-missing' };
        } else {
            if (typeof vault.wallets?.list !== 'function') {
                return { ok: false, restored: false, reason: 'owner-missing' };
            }
            const wallets = await vault.wallets.list();
            const owned = Array.isArray(wallets)
                && wallets.some((wallet) => importedAddressIdsOfWallet(wallet).has(address.id));
            if (!owned) return { ok: false, restored: false, reason: 'owner-missing' };
        }

        await vault.addresses.put(address);
        return { ok: true, restored: true };
    });

    // Resolve the active (operating) address per chain for an account.
    host.register('addresses.active', async (req, { vault, chainRegistry }) => {
        return resolveActiveAddresses({
            vault,
            walletId: req?.walletId,
            accountId: req?.accountId,
            chainRegistry,
        });
    });

    // Set the active address for one (account, chain).
    host.register('addresses.setActive', async (req, { vault }) => {
        return setActiveAddress({
            vault,
            accountId: req?.accountId,
            walletId: req?.walletId,
            chainId: req?.chainId,
            addressId: req?.addressId,
        });
    });


    // Cancels a held send by id. Answers whether anything was actually held.
    host.register('send.holdCancel', async (req) => {
        const holdId = req?.holdId;
        if (typeof holdId !== 'string' || holdId.length === 0) {
            throw new TypeError('send.holdCancel: holdId must be a non-empty string');
        }
        return { cancelled: sendHold.cancel(holdId) };
    });

    host.register('action.send', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await sendWithHold({
            ...req,
            signer: await sessionSigner(req, vault, signerPool),
        }, {
            vault,
            chainRegistry,
            sdkRegistry,
            // Auto-enqueue on broadcast failure: the signed hex would otherwise
            // vanish, and the queue lets the user retry from the banner.
            onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId),
        });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    // §20 / G040: watcher-mode helper: encode-only path that returns
    // an unsigned PSBT for transport to a Signer-mode wallet. No vault
    // unlock, no signer, no broadcast. The vault ref is read-only
    // gatedKeys access (PC-26): the send guard needs the pack key to
    // compose a valid gated send; no unlock or signing happens here.
    host.register('action.send.psbt', async (req, { vault, chainRegistry, sdkRegistry }) => {
        await assertActiveSendNetwork({ ...req, vault, chainRegistry });
        return buildSendPsbt({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §20 / Cluster W FOLLOWUP 5: generic watcher-mode helper for the
    // non-Send action surface (ISSUE / MINT / DESTROY / DISPENSER / etc.).
    // Same encode-only contract as `action.send.psbt`: no vault unlock,
    // no signer, no broadcast: caller supplies `actionData` + `encoderOpts`.
    host.register('action.psbt', async (req, { chainRegistry, sdkRegistry }) => {
        return buildActionPsbt({ ...req, chainRegistry, sdkRegistry });
    });

    // The HOST half of the single-encode pipeline. Compose the
    // ONE PSBT the ConfirmActionModal previews and the signer signs, resolve
    // fee + ADS, and run the tamper check HOST-side (decomposePsbt +
    // decodeActionFromPsbt live here). Returns a serializable, already-
    // tamper-verified HostComposeEnvelope (see
    // core/flows/composeActionForConfirm.js); a tamper failure throws and crosses
    // the boundary as an error the invoking form renders. No signer, no
    // password, no broadcast: this is the pre-modal compose step only.
    //
    // Slice 1 wires SEND; the route accepts a ready `actionData` too so
    // later slices (§5.6) reuse it without a new route. Own-chain addresses
    // (change is allowed there by the output-set check) are resolved from
    // the vault.
    host.register('action.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.composeForConfirm: chainId is required');
        }
        await assertActiveSendNetwork({ chainId, vault, chainRegistry });
        const source = normalizeSource(req?.from, 'action.composeForConfirm');

        // Build actionData/encoderOpts from either a generic payload or the
        // SEND base shape (Send.jsx sends the latter in slice 1).
        let actionData;
        let encoderOpts;
        if (req?.actionData && typeof req.actionData === 'object') {
            actionData = req.actionData;
            encoderOpts = { pubkey: source.publicKey, ...(req.encoderOpts || {}) };
        } else {
            // PC-52: one shaping call for the recipient list, shared with
            // sendToken / buildSendPsbt. One leg keeps the flat params (and
            // the v0 bytes) this route has always composed; two or more emit
            // LEGS and refuse native-coin and gated ticks.
            const { legs, isMulti } = normalizeSendLegs(req, 'action.composeForConfirm');
            assertMultiSendSupported({ legs, descriptor: chainRegistry.get(chainId) });
            if (isMulti) {
                await assertNoGatedLegs({ sdkRegistry, chainRegistry, chainId, legs });
            }
            const params = buildSendParams(legs);
            actionData = { action: 'SEND', params };
            // PC-26: a gated tick's SEND composes as BATCH(SEND, MESSAGE)
            // HERE, at the single-encode step, so the PSBT the modal
            // previews IS the guarded one and Approve signs it
            // byte-identically (sendToken skips its own guard on the
            // prebuilt path). Typed guard errors reject the confirm()
            // promise unwrapped, like any compose failure.
            const gatedPlan = isMulti ? null : await prepareGatedSend({
                sdkRegistry, chainRegistry, vault,
                walletId: req.walletId,
                chainId, source,
                to: legs[0].to, tick: legs[0].tick, amount: legs[0].amount, memo: legs[0].memo,
            });
            if (gatedPlan) actionData = gatedPlan.actionData;
            encoderOpts = {
                pubkey: source.publicKey,
                ...(req.fee !== undefined && { fee: req.fee }),
                ...(req.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req.rbf !== undefined && { rbf: req.rbf }),
                ...(Array.isArray(req.utxos) && req.utxos.length > 0 ? { utxos: req.utxos } : {}),
            };
        }

        // Device hardening; the rationale lives on the helper.
        encoderOpts = await deviceHardenedEncoderOpts(vault, req, encoderOpts);

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });
        // A caller that named its own change destination is stating where the
        // value must land; a privacy preference does not get to move it. Only
        // the default (change back to the spender) is rotated.
        if (typeof req?.change === 'string' && req.change) {
            if (!ownAddresses.includes(req.change)) {
                throw new Error('action.composeForConfirm: change address does not belong to this wallet');
            }
            encoderOpts = { ...encoderOpts, change: req.change };
        } else if (encoderOpts.change === undefined) {
            encoderOpts = { ...encoderOpts, change };
        }
        encoderOpts = await withoutHeldCoins(chainId, source.address, encoderOpts, sdkRegistry);

        return composeActionForConfirm({
            vault, chainRegistry, sdkRegistry, chainId, actionData, encoderOpts,
            source: source.address, ownAddresses,
            signer: await envelopeSignerOf(vault, req),
        });
    });

    // What the Max button is allowed to fill in for a native-coin send.
    //
    // The renderer cannot answer this. The number it needs is the fee the
    // ENCODER will charge for the transaction it is about to build, and the
    // encoder states that only in the typed details of a refusal - a payload
    // MessageHost.serializeError drops on the way back ({ name, message } only,
    // see sdk/encoderErrors.js). So the whole round trip, refusal included, runs
    // on this side and only the settled satoshi count crosses.
    //
    // Deliberately the same preamble as action.composeForConfirm above (source,
    // change rotation, fee opts): the quote is only worth anything if it prices
    // the transaction that route will actually compose. Never throws - a quote
    // that cannot be had returns null and the form keeps its static estimate.
    host.register('action.quoteMaxSendable', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.quoteMaxSendable: chainId is required');
        }
        const source = normalizeSource(req?.from, 'action.quoteMaxSendable');
        const destination = typeof req?.to === 'string' ? req.to.trim() : '';
        if (!destination) throw new Error('action.quoteMaxSendable: to is required');

        let encoderOpts = {
            pubkey: source.publicKey,
            ...(req.feePerKb !== undefined && { feePerKb: req.feePerKb }),
            ...(req.rbf !== undefined && { rbf: req.rbf }),
            ...(Array.isArray(req.utxos) && req.utxos.length > 0 ? { utxos: req.utxos } : {}),
        };
        encoderOpts = await deviceHardenedEncoderOpts(vault, req, encoderOpts);
        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });
        if (typeof req?.change === 'string' && req.change) {
            if (!ownAddresses.includes(req.change)) {
                throw new Error('action.quoteMaxSendable: change address does not belong to this wallet');
            }
            encoderOpts = { ...encoderOpts, change: req.change };
        } else if (encoderOpts.change === undefined) {
            encoderOpts = { ...encoderOpts, change };
        }

        try {
            encoderOpts = await withoutHeldCoins(chainId, source.address, encoderOpts, sdkRegistry);
        } catch (err) {
            if (err?.name !== 'CoinsHeldError') throw err;
            return { maxSats: '0', feeSats: '0', inputSats: '0', otherOutputSats: '0', source: 'encoder-quote', coinsHeld: true };
        }

        return flows.quoteMaxSendable({
            sdkRegistry, chainRegistry, vault, chainId,
            source: source.address, destination, encoderOpts,
        });
    });

    // The address's spendable outputs minus the coins a claim or a queued send
    // holds, or null when nothing is held there (the encoder then selects as usual).
    async function unclaimedUtxos(chainId, address, sdkRegistry) {
        const held = [...await ownSpends.heldOutpoints(chainId), ...await queuedOutpoints(chainId)];
        if (held.length === 0) return null;
        const taken = new Set(held.map((o) => `${String(o.txid).toLowerCase()}:${Number(o.vout)}`));
        let rows;
        try {
            const res = await sdkRegistry.get(chainId)?.encoder?.getUTXOs?.(address);
            rows = Array.isArray(res) ? res : res?.utxos;
        } catch {
            return null;
        }
        if (!Array.isArray(rows)) return null;
        const free = rows.filter((row) => !taken.has(`${String(row?.txid ?? '').toLowerCase()}:${Number(row?.vout)}`));
        return free.length === rows.length ? null : free;
    }

    // The Advanced section's coin and change choices for the routes that
    // build their own encoder options (vote, bet, message, gated publish).
    // The change address must be one of this wallet's, as on the generic route.
    function withCallerSpendChoices(req, encoderOpts, ownAddresses, route) {
        let next = encoderOpts;
        if (Array.isArray(req?.utxos) && req.utxos.length > 0) next = { ...next, utxos: req.utxos };
        if (typeof req?.change === 'string' && req.change) {
            if (!ownAddresses.includes(req.change)) {
                throw new Error(`${route}: change address does not belong to this wallet`);
            }
            next = { ...next, change: req.change };
        }
        return next;
    }

    async function withoutHeldCoins(chainId, address, encoderOpts, sdkRegistry) {
        if (Array.isArray(encoderOpts.utxos)) return encoderOpts;
        const free = await unclaimedUtxos(chainId, address, sdkRegistry);
        if (free === null) return encoderOpts;
        if (free.length === 0) {
            throw Object.assign(
                new Error('Every coin at this address is held by another send. Wait for it to broadcast or discard it, then try again.'),
                { name: 'CoinsHeldError' },
            );
        }
        return { ...encoderOpts, utxos: free };
    }

    // VOTE's wire params are built by sdk.voting.*Params, which lives
    // HERE, not in the renderer. The three VOTE forms each kept a hand-written
    // client-side mirror of that encoding to feed the generic compose route -
    // and a mirror that drifts is signed, not caught: the tamper check
    // verifies the PSBT against the params the encoder was handed, so a wrong
    // mirror produces a self-consistent PSBT for the WRONG ballot, and
    // castBallotAction's own builder never runs because `prebuiltPsbt`
    // short-circuits it. Composing through the real builder removes the mirror
    // (spec §1: the SDK owns the logic, the wallet owns the glass).
    //
    // No vault unlock and no password: the builders are pure shape validation.
    // The signer pool is read only for change rotation, which is a
    // no-op when the pool is empty.
    host.register('action.vote.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.vote.composeForConfirm: chainId is required');
        }
        await assertActiveSendNetwork({ chainId, vault, chainRegistry }, REVIEW_ACTION_AGAIN);
        const builder = req?.builder;
        // Allow-listed: `builder` crosses the messaging boundary, so it must
        // never be able to name an arbitrary sdk.voting method.
        const VOTE_BUILDERS = ['createPollParams', 'castBallotParams', 'delegateParams', 'clearDelegationParams'];
        if (!VOTE_BUILDERS.includes(builder)) {
            throw new Error(`action.vote.composeForConfirm: unknown builder "${builder}"`);
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.voting?.[builder] !== 'function') {
            throw new Error(`action.vote.composeForConfirm: sdk.voting.${builder} is unavailable`);
        }
        const source = normalizeSource(req?.from, 'action.vote.composeForConfirm');
        // Throws on bad input BEFORE the confirm page opens, exactly as the
        // submit flow's own up-front guard does.
        const params = sdk.voting[builder](req?.params);

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });

        let encoderOpts = await deviceHardenedEncoderOpts(vault, req, {
            pubkey: source.publicKey,
            change,
            ...(req?.fee !== undefined && { fee: req.fee }),
            ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
            ...(req?.rbf !== undefined && { rbf: req.rbf }),
        });
        encoderOpts = withCallerSpendChoices(req, encoderOpts, ownAddresses, 'action.vote.composeForConfirm');
        encoderOpts = await withoutHeldCoins(chainId, source.address, encoderOpts, sdkRegistry);
        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData: { action: 'VOTE', params },
            encoderOpts,
            source: source.address,
            ownAddresses,
            // Decides whether an oversized poll may ride the Taproot envelope.
            signer: await envelopeSignerOf(vault, req),
        });
        // The built wire params ride back so the confirm page decodes its
        // intent from what the HOST composed, not from the editor state
        // (same shape as `messageParams` on the MESSAGE route).
        return { ...composed, voteParams: params };
    });

    // §3.2/§3.5: describe an action the wallet did NOT compose - a
    // dApp's `signAction` payload, or a co-signer request decoded out of a
    // PSBT. The in-wallet path gets its intent from composeActionForConfirm,
    // which describes the composed action string; these two have no compose
    // step, and were rendering through the wallet's own local describer
    // instead. That describer applies none of §3.5's display hardening, and
    // this is the one surface where the params are ATTACKER-AUTHORED: a
    // bidi override or zero-width run in a dApp's MEMO changed what the
    // approval window read while the bytes said something else.
    //
    // Params in, description out. Serializable both ways, so the approval
    // window renders text the SDK has already neutralized.
    host.register('action.describe', async (req, { sdkRegistry, chainRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.describe: chainId is required');
        }
        if (typeof req?.action !== 'string' || !req.action) {
            throw new Error('action.describe: action is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.decoder?.describe !== 'function') {
            throw new Error(`action.describe: SDK for "${chainId}" lacks decoder.describe`);
        }
        const parsed = { action: req.action, version: req.version, params: req.params || {} };
        const described = sdk.decoder.describe(
            parsed,
            {
                chainId,
                chainRegistry,
                ...(Array.isArray(req.ownAddresses) && { ownAddresses: req.ownAddresses }),
            },
        );
        const withListDescriptions = decoder.withListRemovalDescriptions(described, parsed);
        return decoder.withContractCallDescriptions(withListDescriptions, parsed);
    });

    // Re-price a composed action's native-coin protocol fee at Approve
    // time. The fee output was sized at COMPOSE from an oracle price, and the
    // amount consensus requires moves inversely with the coin price, so a move
    // of a little over 5 % (FEE_TOLERANCE_MIN) while the confirm screen sits
    // open leaves the attached output short - and a short native fee is
    // forfeited on-chain, with the action rejected.
    //
    // Quoted from the composed ACTION STRING, not from the form params that
    // produced it: these are the bytes about to be broadcast, and re-deriving
    // them here would price a second, independently built action.
    host.register('action.requoteNativeFee', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.requoteNativeFee: chainId is required');
        }
        const actionString = req?.actionString;
        if (typeof actionString !== 'string' || !actionString) {
            throw new Error('action.requoteNativeFee: actionString is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.quoteNativeFee !== 'function') {
            throw new Error(`action.requoteNativeFee: SDK for "${chainId}" lacks quoteNativeFee`);
        }
        // The Approve-time re-quote must see an oracle round that landed after
        // compose, never compose's own quote reused or served from the cache.
        return flows.explorerFreshScope(sdk, () => sdk.quoteNativeFee(actionString, { source: req?.source }));
    });

    // Price the draft action for display while the form is being edited. This
    // uses the SDK's normal cached reads because only the Approve-time guard
    // needs a fresh-scoped quote, and this preview never signs or spends.
    host.register('action.quoteProtocolFee', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.quoteProtocolFee: chainId is required');
        }
        const actionData = req?.actionData;
        if (!actionData || typeof actionData !== 'object' || Array.isArray(actionData)
            || typeof actionData.action !== 'string' || !actionData.action) {
            throw new Error('action.quoteProtocolFee: actionData.action is required');
        }
        if (!actionData.params || typeof actionData.params !== 'object' || Array.isArray(actionData.params)) {
            throw new Error('action.quoteProtocolFee: actionData.params is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.quoteNativeFee !== 'function') return null;
        try {
            return await sdk.quoteNativeFee(
                { action: actionData.action, params: actionData.params },
                { source: req.source },
            );
        } catch {
            return null;
        }
    });

    // Run sdk.preflight HOST-side (the SDK, its explorer endpoint,
    // and Tier-2 state all live here) and return the serializable report. The
    // popup's AbortController cannot cross the boundary; a superseded report
    // is simply ignored by the hook once it resolves. `bypassCache` powers
    // the Approve-time staleness re-check (§4.6).
    host.register('action.preflight', async (req, { sdkRegistry, vault, chainRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.preflight: chainId is required');
        }
        if (typeof req?.actionString !== 'string' || !req.actionString) {
            throw new Error('action.preflight: actionString is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.preflight !== 'function') {
            throw new Error(`action.preflight: SDK for "${chainId}" lacks preflight`);
        }
        // §4.7: net the host-shared reservations for this chain into localDeltas
        // so a second approval window sees the first's approved-but-unbroadcast
        // amount and warns instead of double-spending. `excludeReservationId`
        // keeps a window from netting its OWN reservation (unused in the current
        // Send flow, where reserve always follows the last preflight).
        const reserved = await reservationLedger.localDeltas(chainId, req.excludeReservationId);
        const callerDeltas = Array.isArray(req.localDeltas) ? req.localDeltas : [];
        // Also net the source's UNCONFIRMED committed spends. The
        // reservation covers approve -> broadcast only (released the instant the
        // send is signed and handed off); this covers broadcast -> confirmation,
        // where the spend is real but the explorer balance does not yet reflect
        // it, so a second window still can't double-spend. Best-effort: never
        // block pre-flight on the pendingTx read.
        let pendingDeltas = [];
        try {
            const descriptor = chainRegistry?.get?.(chainId);
            if (descriptor && vault && typeof req.source === 'string' && req.source) {
                const list = await vault.pendingTxs.list();
                pendingDeltas = flows.unconfirmedPendingDeltas(list, {
                    coin: descriptor.coin, network: descriptor.networkKind, source: req.source,
                });
            }
        } catch { /* best-effort; a pending-read hiccup must not fail the pre-flight */ }
        const localDeltas = [...callerDeltas, ...reserved, ...pendingDeltas];
        const run = (attempt) => sdk.preflight(req.actionString, {
            source: req.source,
            chain: chainId,
            localDeltas: localDeltas.length ? localDeltas : undefined,
            // A retry must not reuse the local-only report produced by the 429.
            bypassCache: req.bypassCache === true || attempt > 0,
            preflight: req.mode || 'report',
            // Only 'native' and 'xchain' cross this boundary: anything else is
            // dropped rather than forwarded, so a malformed caller cannot make
            // the endpoint reject the whole dry run over a query parameter.
            ...(req.feeMode === 'native' || req.feeMode === 'xchain'
                ? { feeMode: req.feeMode } : {}),
        });
        // The Approve-time re-check and any 429 retry skip the SDK's report
        // cache. Every attempt's explorer reads go fresh, the first included:
        // the explorer serves balance listings with max-age=5,
        // stale-while-revalidate=10, and the SDK reads a token missing from a
        // listing as a balance of 0. A copy cached from before an ISSUE once
        // refused a dispenser for a token its seller held. Fresh reads change
        // no URL or header, so they add no CORS preflight.
        const report = await flows.retryRateLimitedPreflight(sdk, (attempt) => (
            flows.explorerFreshScope(sdk, () => run(attempt))
        ));
        return settleAmountRule(sdk, req.actionString, report);
    });

    // Where the newer amount rule is unarmed, judge this action's amounts with the
    // SDK's validator; any failure to read them keeps the report as the SDK built it.
    async function settleAmountRule(sdk, actionString, report) {
        if (!report?.unverified?.length || typeof loadAmountRules !== 'function') return report;
        try {
            const rules = await loadAmountRules();
            const parsed = sdk.decoder?.parse?.(actionString);
            const tokenFor = typeof sdk.explorer?.getToken === 'function'
                ? (tick) => sdk.explorer.getToken(tick) : null;
            return await flows.settleAmountRepresentability(report, { parsed, rules, tokenFor });
        } catch {
            return report;
        }
    }

    // §4.6 input liveness: are the coins this PSBT spends still unspent?
    //
    // The other half of the Approve-time re-check, and the one that was never
    // built: only the pre-flight re-run shipped, so a confirm page held open
    // past a competing spend signed a dead PSBT and discovered it at broadcast,
    // in the permanent terminal §5.3.4 forbids re-signing out of.
    //
    // Fails to `unknown`, never to `spent` (see flows/inputLiveness.js): an
    // address that did not answer is absent from the map rather than
    // present-and-empty, because present-and-empty is what PROVES a spend.
    host.register('action.inputLiveness', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.inputLiveness: chainId is required');
        }
        if (typeof req?.psbtHex !== 'string' || !req.psbtHex) {
            throw new Error('action.inputLiveness: psbtHex is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`action.inputLiveness: SDK for "${chainId}" lacks wallet.decomposePsbt`);
        }
        const { inputs } = sdk.wallet.decomposePsbt(req.psbtHex);
        const addresses = flows.inputAddresses(inputs);
        const encoder = sdk.encoder;
        /** @type {Record<string, Array<{txid: string, vout: number}>>} */
        const utxosByAddress = {};
        if (encoder && typeof encoder.getUTXOs === 'function') {
            // Per address, and only the ones that answer. Queried in parallel:
            // this runs inside the Approve-time budget, where a serial walk of
            // a multi-address input set would spend it on round trips.
            await Promise.all(addresses.map(async (address) => {
                try {
                    const res = await encoder.getUTXOs(address);
                    const list = Array.isArray(res?.utxos) ? res.utxos : Array.isArray(res) ? res : null;
                    if (list) utxosByAddress[address] = list;
                } catch { /* absent => unknown, never spent */ }
            }));
        }
        return flows.checkInputLiveness({ inputs, utxosByAddress });
    });

    // §4.7: register / release an in-flight approval reservation. The hook
    // reserves at Approve (post sync-disable, before signing) and releases on
    // any terminal state (broadcast, reject, abort). Release ordering is the
    // caller's concern (§4.7: PendingTx row before release, so a concurrent
    // window transiently double-counts rather than seeing neither).
    host.register('action.reserve', async (req) => {
        await reservationLedger.reserve({
            id: req?.id, chainId: req?.chainId, tick: req?.tick, amount: req?.amount,
        });
        return { ok: true };
    });
    host.register('action.releaseReservation', async (req) => {
        await reservationLedger.release(req?.id);
        return { ok: true };
    });

    // §17.5 / G025: verify signature. Pure SDK call, no signer / no
    // password. Caller supplies chainId + address + message + signature.
    host.register('auth.verifyMessage', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        const address = req?.address;
        const message = req?.message;
        const signature = req?.signature;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('auth.verifyMessage: chainId is required');
        }
        if (typeof address !== 'string' || !address) {
            throw new Error('auth.verifyMessage: address is required');
        }
        if (typeof message !== 'string') {
            throw new Error('auth.verifyMessage: message must be a string');
        }
        if (typeof signature !== 'string' || !signature) {
            throw new Error('auth.verifyMessage: signature is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (!sdk?.auth?.verifyMessage) {
            throw new Error(`auth.verifyMessage: SDK for "${chainId}" lacks auth.verifyMessage`);
        }
        // Message verification recovers a key hash and ignores the address version
        // byte, so an address of another network (testnet while mainnet is chosen)
        // would verify. Refuse any address the chosen network does not accept.
        if (typeof sdk.wallet?.validateAddress === 'function') {
            let addressVerdict = null;
            try { addressVerdict = sdk.wallet.validateAddress(address); } catch (_err) { addressVerdict = { valid: false }; }
            if (addressVerdict && addressVerdict.valid === false) return { valid: false };
        }
        let valid = false;
        try {
            // Read the SDK's { valid, error } answer by its field; the demo stubs answer a bare boolean
            const verdict = sdk.auth.verifyMessage(address, message, signature);
            valid = typeof verdict === 'boolean' ? verdict : verdict?.valid === true;
        } catch (_err) {
            valid = false;
        }
        return { valid };
    });

    // §17.4 / §30.1 / G024: user-initiated message signing. Caller
    // supplies the addressId (HD or imported-WIF) and the wallet
    // resolves it to either `path` (HD) or `addressId` (imported).
    host.register('auth.signMessage', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        const addressId = req?.addressId;
        const password = req?.password;
        const message = req?.message;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('auth.signMessage: walletId is required');
        }
        if (typeof addressId !== 'string' || !addressId) {
            throw new Error('auth.signMessage: addressId is required');
        }
        if (typeof message !== 'string') {
            throw new Error('auth.signMessage: message must be a string');
        }
        // Unlocked session → pooled signer (no password). Locked / restart
        // without rehydration → fall back to the supplied password.
        const signer = await sessionSigner(req, vault, signerPool);
        if (!signer && (typeof password !== 'string' || password.length === 0)) {
            throw new Error('auth.signMessage: password is required');
        }
        const address = await vault.addresses.get(addressId);
        if (!address) {
            throw new Error(`auth.signMessage: address "${addressId}" not found`);
        }
        const chainId = chainRegistry.chainIdFor(address.chain, address.network);
        if (!chainId) {
            throw new Error(`auth.signMessage: no chain id for chain "${address.chain}" and network "${address.network}"`);
        }
        const isHd = address.source === 'hd' && typeof address.derivationPath === 'string';
        // The signer comes from the wallet and the path from the record, so an
        // HD record of another wallet signs with this wallet's key at that path,
        // from an address the review never showed. An imported key is looked up
        // in the wallet's own key list and cannot cross wallets.
        if (isHd) {
            const account = typeof address.accountId === 'string' && address.accountId
                ? await vault.accounts.get(address.accountId)
                : null;
            if (!account || account.walletId !== walletId) {
                throw new Error(`auth.signMessage: address "${addressId}" is not in this wallet`);
            }
        }
        return signMessageFlow({
            vault,
            walletId,
            password,
            signer,
            bip39Passphrase: req?.bip39Passphrase,
            chainRegistry,
            sdkRegistry,
            chainId,
            path: isHd ? address.derivationPath : undefined,
            addressId: isHd ? undefined : addressId,
            addressType: address.addressType,
            message,
        });
    });

    // §49.5 / G154: queued broadcast surface. v0.170.0 shipped the UI
    // + messaging + in-memory queue; v0.292.0 auto-enqueue from broadcast
    // failure (Cluster G FOLLOWUP 1); v0.293.0 persistence across reload
    // (Cluster G FOLLOWUP 2). The in-memory map remains the live source
    // of truth for the running process; storage rehydrates on the first
    // queue access and writes back on every mutation.
    //
    // All of that state lives in `queueStore`, which the shell shares across
    // the hosts it builds: a host torn down by a lock keeps running a
    // broadcast already on the network, and its late splice, persist and
    // journal record then land in the same map, journal and cached blob the
    // next host serves, instead of in a private copy written over that host's.
    const queueStore = broadcastQueueStore ?? createBroadcastQueueStore({ storage: broadcastQueueStorage });
    // A sealed store was ended by a wipe and drops every write, so a host built
    // over it would accept broadcasts it can never persist.
    if (queueStore.sealed) {
        throw new Error('createBackgroundHost: the broadcast queue store was sealed by a wallet wipe');
    }
    const {
        ensureQueueLoaded,
        persistQueue,
        persistQueueAndSettlements,
        recordOwedSettlement,
        flushOwedSettlements,
        sealBroadcastQueue,
        pruneWalletFromQueue,
        getQueue,
        restoreQueueFromVault,
        reconcileRestoredEntries,
        syncEntryToDurableRecord,
        enqueueOnBroadcastFailure,
        enqueueSignedBroadcast,
        isWalletRemoved,
        pushQueueEntry,
        pendingTxIdsOf,
        settleQueuedPendingTx,
    } = createBroadcastQueueEngine({
        store: queueStore,
        importedAddressIdsFor: importedAddressIdsForStrict,
        discardQueuedBroadcast: (args) => flows.discardQueuedBroadcast(args),
    });
    void ensureQueueLoaded();
    // Sends that settled while the wallet was locked, for the unlocked shell to
    // tell the person what happened. Each list first finishes any pending record
    // still owed a write, so the outcome and the record agree.
    host.register('send.lockedOutcomes.list', async (req, { vault }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) return [];
        await lockedOutcomesFinished;
        lockedOutcomesFinished = finishLockedSendOutcomes(vault).catch(() => {});
        await lockedOutcomesFinished;
        const entries = await lockedSendOutcomes.list();
        return entries
            .filter((e) => e.finished && e.walletId === walletId)
            .map((e) => ({
                id: e.id,
                kind: e.kind,
                chainId: e.chainId,
                txid: e.txid,
                amount: e.amount,
                tick: e.tick,
                summary: e.summary ?? null,
                at: e.at,
            }));
    });
    host.register('send.lockedOutcomes.clear', async (req) => {
        const ids = Array.isArray(req?.ids) ? req.ids.filter((id) => typeof id === 'string') : [];
        if (ids.length > 0) await lockedSendOutcomes.remove(ids);
        return { cleared: ids.length };
    });

    host.register('broadcast.queue.list', async (req, { vault, chainRegistry, sdkRegistry }) => {
        // A record a locked send left at 'broadcasting' is finished first, so
        // the restore below never offers a send the network already took.
        await lockedOutcomesFinished;
        await ensureQueueLoaded();
        // The queued-broadcast banner lists on mount, which is the first moment
        // after an unlock at which an owed write has a vault to land in.
        await flushOwedSettlements(vault);
        if (typeof req?.walletId === 'string' && req.walletId) {
            // Order matters: the flush above lands an owed discard or terminal
            // patch first, so the reconcile judges the record as it will finally
            // read rather than as the refused write left it. Restoring runs last
            // because it only ADDS records reading 'queued' or 'broadcasting',
            // the two statuses the reconcile keeps anyway.
            await reconcileRestoredEntries(vault, req.walletId, sdkRegistry);
            await restoreQueueFromVault(vault, chainRegistry, req.walletId);
        }
        return [...getQueue(req?.walletId)];
    });
    // Cluster G FOLLOWUP 1: explicit enqueue endpoint. Renderer-side
    // callers (e.g. PsbtSignForm, future RBF replace lanes) can park a
    // signed hex on the queue without going through the action.* path.
    host.register('broadcast.queue.enqueue', async (req, { vault, chainRegistry, sdkRegistry }) => {
        await ensureQueueLoaded();
        const walletId = req?.walletId;
        const chainId = req?.chainId;
        const signedTxHex = req?.signedTxHex;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('broadcast.queue.enqueue: walletId is required');
        }
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('broadcast.queue.enqueue: chainId is required');
        }
        if (typeof signedTxHex !== 'string' || !signedTxHex) {
            throw new Error('broadcast.queue.enqueue: signedTxHex is required');
        }
        const sdk = sdkRegistry.get(chainId);
        // Explicit callers hand this route signed bytes the wallet did not
        // produce in this flow. Establish every spent coin through the tracker
        // and verify its signature before the bytes enter durable queue state.
        await assertBroadcastSignaturesVerify({
            sdk,
            txHex: signedTxHex,
            signerId: 'broadcast.queue.enqueue',
        });
        // The bytes name their own txid; the caller's is only a fallback.
        const txid = txidOfRaw(signedTxHex) || (typeof req?.txid === 'string' && req.txid ? req.txid : '');
        let adsCommit = await enqueuedAdsVerdict(vault, chainRegistry, { chainId, txid });
        // Asked after the verify await and in the same turn as the push: a
        // wallet removed while that call was in flight, or one a stale window
        // still names, must not get its signed bytes written under an id no
        // route can list again.
        if (isWalletRemoved(walletId)) {
            throw new Error('broadcast.queue.enqueue: the wallet was removed');
        }
        // A live entry already holding these bytes keeps the booking it has: the
        // push would merge this verdict onto it and turn a claim it settles into
        // a plain accrual.
        if (getQueue(walletId).some((e) => e.chainId === chainId
            && ((txid && e.txid === txid) || e.signedTxHex === signedTxHex))) adsCommit = null;
        const stored = pushQueueEntry(walletId, {
            chainId,
            signedTxHex,
            summary: req?.summary,
            signedAt: req?.signedAt,
            ...(txid ? { txid } : {}),
            ...(adsCommit ? { adsCommit } : {}),
        });
        // This lane names no PendingTx, so the blob is its only durable copy:
        // reply after the write settles, saying whether it landed (a caller
        // seeing `persisted: false` warns the bytes will not survive a restart).
        const persisted = await persistQueue();
        // Copy: `stored` is the live entry, and a flag on it would ride the next save.
        return { ...stored, persisted };
    });

    host.register('tx.replace', async (req, {
        vault, chainRegistry, sdkRegistry, signerPool,
    }) => {
        const chainId = req?.chainId;
        const walletId = req?.walletId;
        const originalTxHash = req?.originalTxHash;
        const strategy = req?.strategy;
        if (typeof chainId !== 'string' || !chainId) throw new Error('tx.replace: chainId is required');
        if (typeof walletId !== 'string' || !walletId) throw new Error('tx.replace: walletId is required');
        if (typeof originalTxHash !== 'string' || !originalTxHash) {
            throw new Error('tx.replace: originalTxHash is required');
        }
        if (!['speedup', 'cancel', 'restore'].includes(strategy)) {
            throw new Error(`tx.replace: unknown strategy "${String(strategy)}"`);
        }
        if (strategy === 'restore' && (typeof req?.restoreTxHash !== 'string' || !req.restoreTxHash)) {
            throw new Error('tx.replace: restoreTxHash is required for the restore strategy');
        }

        const descriptor = chainRegistry.get(chainId);
        if (!descriptor) throw new Error(`tx.replace: unknown chain "${chainId}"`);
        if (descriptor.feeStrategy?.rbfSupported !== true) {
            throw new Error(`tx.replace: fee bumping is not supported on ${descriptor.displayName || chainId}`);
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`tx.replace: SDK for "${chainId}" lacks wallet.decomposePsbt`);
        }
        if (typeof sdk?.encoder?.createTx !== 'function'
            || typeof sdk?.encoder?.broadcastTx !== 'function') {
            throw new Error(`tx.replace: SDK for "${chainId}" lacks replacement encoder methods`);
        }

        const accounts = await vault.accounts.findBy('walletId', walletId);
        const accountIds = new Set(accounts.map((account) => account.id));
        const addresses = await vault.addresses.list();
        const importedAddressIds = await importedAddressIdsForStrict(vault, walletId);
        const walletAddresses = addresses.filter((address) => (
            accountIds.has(address.accountId) || importedAddressIds.has(address.id)
        ));
        // A replacement whose landed write was only journaled settles now, so the guard below reads it as sent.
        await flushOwedSettlements(vault);
        const records = await vault.pendingTxs.list();
        const lowerHash = (value) => String(value || '').toLowerCase();
        const recordFor = (txid) => records.find((record) => (
            lowerHash(record?.txid) === lowerHash(txid)
            && record.chain === descriptor.coin
            && record.network === descriptor.networkKind
            && walletAddresses.some((address) => address.address === record.fromAddress)
        ));
        const conflictRecord = recordFor(originalTxHash);
        if (!conflictRecord) throw new Error('tx.replace: transaction is not a pending transaction in this wallet');
        if (conflictRecord.chainConfirmed === true || conflictRecord.status === 'indexed') {
            throw new Error('This transaction is already confirmed.');
        }
        if (!['broadcast', 'broadcasting'].includes(conflictRecord.status)) {
            throw new Error('tx.replace: transaction is no longer replaceable');
        }
        if (conflictRecord.rbf !== true) {
            throw new Error('tx.replace: transaction did not signal replaceability');
        }
        const templateRecord = strategy === 'restore' ? recordFor(req.restoreTxHash) : conflictRecord;
        if (!templateRecord) throw new Error('tx.replace: restore transaction is not available in this wallet');
        if (typeof conflictRecord.psbtHex !== 'string' || !conflictRecord.psbtHex) {
            throw new Error('tx.replace: original signing plan is unavailable');
        }
        if (typeof templateRecord.psbtHex !== 'string' || !templateRecord.psbtHex) {
            throw new Error('tx.replace: restore signing plan is unavailable');
        }

        const source = walletAddresses.find((address) => address.address === conflictRecord.fromAddress);
        if (!source || typeof source.publicKey !== 'string' || !source.publicKey) {
            throw new Error('tx.replace: source address is not signable by this wallet');
        }
        const conflict = sdk.wallet.decomposePsbt(conflictRecord.psbtHex);
        const template = sdk.wallet.decomposePsbt(templateRecord.psbtHex);
        const transactionBytes = typeof conflictRecord.txHex === 'string' && conflictRecord.txHex
            ? Math.ceil(conflictRecord.txHex.length / 2)
            : 10 + (conflict.inputs.length * 148) + (conflict.outputs.length * 34);
        const plan = planRbfReplacement({
            strategy,
            conflict,
            template,
            sourceAddress: source.address,
            ownAddresses: walletAddresses.map((address) => address.address),
            feeRate: req?.feeRate,
            transactionBytes,
        });
        const coinAmount = (value) => {
            const amount = BigInt(value);
            const whole = amount / 100000000n;
            const fraction = String(amount % 100000000n).padStart(8, '0').replace(/0+$/, '');
            return fraction ? `${whole}.${fraction}` : String(whole);
        };
        const feeQuote = {
            originalFee: coinAmount(plan.originalFeeSats),
            replacementFee: coinAmount(plan.replacementFeeSats),
            feeIncrease: coinAmount(plan.feeIncreaseSats),
        };
        if (req?.preview === true) return feeQuote;
        await assertActiveSendNetwork({ chainId, vault, chainRegistry }, REVIEW_ACTION_AGAIN);
        // Refuse to sign a second replacement while one waits in the queue: re-signing beside a queued signed copy is forbidden.
        // The refusal is a plain sentence because the History card shows it as written.
        // The vault is checked too: a queue not yet rebuilt from it (a desktop relaunch) lists nothing.
        await ensureQueueLoaded();
        const replacementWaits = getQueue(walletId).some((e) => e?.rbfReplacesPendingTxId === conflictRecord.id)
            || records.some((record) => record?.rbfReplacesPendingTxId === conflictRecord.id
                && (record.status === 'queued' || record.status === 'broadcasting'));
        if (replacementWaits) {
            throw new Error('A replacement for this transaction is already waiting in the queued-transactions banner. '
                + 'Send it or remove it there before you speed up or cancel again.');
        }

        let actionString = null;
        if (strategy !== 'cancel') {
            const carriesData = template.outputs.some((output) => (
                output?.scriptType === 'nulldata' || output?.address == null
            ));
            if (carriesData) {
                if (typeof sdk?.decoder?.decodeActionStringFromPsbt !== 'function') {
                    throw new Error(`tx.replace: SDK for "${chainId}" cannot recover the original action`);
                }
                const decoded = sdk.decoder.decodeActionStringFromPsbt(templateRecord.psbtHex);
                actionString = typeof decoded === 'string' ? decoded : decoded?.actionString;
                if (decoded?.ok === false || typeof actionString !== 'string' || !actionString) {
                    throw new Error('tx.replace: original action could not be recovered');
                }
            }
        }

        const sourceSigner = await resolveSigner({ vault, address: source });
        const signer = await pickSignerFromRequest({
            vault,
            walletId,
            signerId: sourceSigner.kind === 'software' ? null : sourceSigner.signerRecord.id,
            signerPool,
        });
        if (!signer) throw new Error('tx.replace: wallet must be unlocked before replacing a transaction');
        const encoded = await sdk.encoder.createTx({
            ...(actionString ? { data: actionString } : {}),
            pubkey: source.publicKey,
            sourceAddress: source.address,
            ...plan.encoderOpts,
            ...(schemas.isDeviceAddressSource(source.source) ? { attachPrevTx: true } : {}),
        });
        if (typeof encoded?.psbt !== 'string' || !encoded.psbt) {
            throw new Error('tx.replace: encoder did not return a PSBT');
        }
        const replacement = sdk.wallet.decomposePsbt(encoded.psbt);
        assertReplacementPsbt({
            replacement,
            plan,
            actionString,
            decodeActionStringFromPsbt: (psbtHex) => sdk.decoder.decodeActionStringFromPsbt(psbtHex),
            psbtHex: encoded.psbt,
        });
        const signingSource = typeof source.derivationPath === 'string' && source.derivationPath
            ? { path: source.derivationPath }
            : { addressId: source.id };
        const signingPaths = replacement.inputs.map((_input, inputIndex) => ({
            inputIndex,
            ...signingSource,
        }));
        const signed = await signPsbtFlow({
            vault,
            walletId,
            signer,
            chainRegistry,
            sdkRegistry,
            chainId,
            psbtHex: encoded.psbt,
            signingPaths,
        });
        if (typeof signed?.txHex !== 'string' || !signed.txHex || typeof signed?.txid !== 'string' || !signed.txid) {
            throw new Error('tx.replace: signer did not return a complete transaction');
        }
        // The freeze and active network are checked again once the signer
        // returns: a hardware prompt can hold the sign open while either
        // changes elsewhere, and the replacement must not reach the network
        // or the ledger then.
        flows.assertSigningAllowed();
        await assertActiveSendNetwork({ chainId, vault, chainRegistry }, REVIEW_ACTION_AGAIN);

        let pending = schemas.createPendingTx({
            chain: descriptor.coin,
            network: descriptor.networkKind,
            fromAddress: source.address,
            toAddress: strategy === 'cancel' ? source.address : templateRecord.toAddress,
            action: templateRecord.action,
            actionSummary: strategy === 'cancel'
                ? `Cancel ${templateRecord.actionSummary}`
                : `${strategy === 'restore' ? 'Restore' : 'Speed up'} ${templateRecord.actionSummary}`,
            psbtHex: encoded.psbt,
            rbf: true,
        });
        // Name the original on the record from the first write, so a queue rebuilt
        // from the vault alone can still retire it when this replacement lands.
        pending = {
            ...pending,
            status: 'broadcasting',
            txid: signed.txid,
            txHex: signed.txHex,
            rbfReplacesPendingTxId: conflictRecord.id,
            ...(templateRecord.adsBooking ? {
                adsBooking: {
                    ...templateRecord.adsBooking,
                    paid: strategy !== 'cancel' && templateRecord.adsBooking.paid === true,
                },
            } : {}),
        };
        await vault.pendingTxs.put(pending);

        let broadcast;
        try {
            broadcast = await sdk.encoder.broadcastTx(signed.txHex);
        } catch (err) {
            // An already-on-network answer means these exact bytes reached a node, so the
            // replacement is live and the original evicted: settle it as delivered, as every broadcast lane does.
            if (!flows.isAlreadyOnNetworkRejection(err)) {
                const failure = err?.message ? String(err.message) : String(err);
                // Retire only bytes that can never confirm; the same split broadcast.signedTx applies.
                if (flows.classifyBroadcastFailure(err) === 'permanent') {
                    const failedPatch = { status: 'failed', error: failure };
                    if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, failedPatch) === 'unreachable') {
                        recordOwedSettlement(walletId, pending.id, 'patch', failedPatch);
                    }
                    if (err && typeof err === 'object') {
                        try { err.name = flows.BROADCAST_FAILED_PERMANENT_NAME; } catch { /* keep immutable error */ }
                    }
                    throw err;
                }
                // A transient failure may still have reached a node, so keep the record live and queue
                // the same signed bytes for a re-send.
                await queueReplacementBytes(vault, walletId, { chainId, signed, pending, conflictRecord, error: failure });
                if (err && typeof err === 'object') {
                    try { err.name = flows.BROADCAST_FAILED_TRANSIENT_NAME; } catch { /* keep immutable error */ }
                }
                throw err;
            }
            broadcast = signed.txid;
        }
        const replacementTxHash = typeof broadcast === 'string'
            ? broadcast
            : (broadcast?.txid ?? broadcast?.tx_hash ?? null);
        // A resolved broadcast with no txid, or another one, most likely still put these bytes on a
        // node, so the replacement is never retired as 'failed': it waits in the queue under the
        // txid of the bytes signed here, and a re-send's answer settles it and the original.
        const unconfirmedReason = typeof replacementTxHash !== 'string' || !replacementTxHash
            ? 'SDK did not return a txid'
            : (lowerHash(replacementTxHash) !== lowerHash(signed.txid) ? 'broadcast txid did not match signed transaction' : null);
        if (unconfirmedReason) {
            await queueReplacementBytes(vault, walletId, {
                chainId, signed, pending, conflictRecord, error: unconfirmedReason, resumedClaim: true,
            });
            const uncertain = new Error(`tx.replace: ${unconfirmedReason}`);
            uncertain.name = flows.BROADCAST_FAILED_TRANSIENT_NAME;
            throw uncertain;
        }

        const broadcastedAt = new Date().toISOString();
        // The bytes are on the network: a refused vault write is journaled, never thrown,
        // so the replacement does not stay 'broadcasting' with nothing naming it.
        await settleOrJournalPatch(vault, walletId, pending.id, {
            status: 'broadcast',
            txid: replacementTxHash,
            broadcastAt: broadcastedAt,
            error: null,
        });
        await settleReplacedOriginal(
            vault,
            { pendingTxId: pending.id, rbfReplacesPendingTxId: conflictRecord.id },
            replacementTxHash,
        );
        await flushOwedSettlements(vault);
        return {
            replacementTxHash,
            broadcastedAt,
            ...feeQuote,
        };
    });
    // The two node answers that mean "these exact bytes are already on the
    // network". They are narrow on purpose: every other rejection the shared
    // classifier calls permanent describes bytes that can never confirm, while
    // these two describe bytes that already did reach a node, which is the
    // opposite outcome. Matched on the same reject text the classifier reads,
    // nested causes included, because that is all the encoder hands back.
    function saysAlreadyOnNetwork(err) {
        return flows.isAlreadyOnNetworkRejection(err);
    }
    async function ownsSignedTxAds(vault, pending) {
        if (typeof pending?.txid !== 'string' || typeof vault.pendingTxs.findBy !== 'function') return true;
        try {
            const matches = await vault.pendingTxs.findBy('txid', pending.txid);
            const live = matches.filter((record) => (
                record && record.status !== 'failed'
            )).sort((left, right) => {
                const byTime = String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
                return byTime || String(left.id).localeCompare(String(right.id));
            });
            return live[0]?.id === pending.id;
        } catch {
            return true;
        }
    }
    // The accrue-only verdict for bytes parked through the explicit enqueue
    // route, keyed by txid so a repeat of the same bytes books once. A live
    // PendingTx with this txid means a wallet flow produced the bytes and owns
    // their booking. Unlike ownsSignedTxAds this route has no record of its
    // own, so an unreadable store yields no verdict: a missed step is cheaper
    // than one counted twice.
    async function enqueuedAdsVerdict(vault, chainRegistry, { chainId, txid }) {
        if (!txid || typeof vault?.pendingTxs?.findBy !== 'function') return null;
        let counted = false;
        try {
            counted = flows.isAdsCountedSend({ settings: await vault.settings.get(), descriptor: chainRegistry?.get?.(chainId) });
        } catch { /* unreadable settings count nothing */ }
        // Keep this as the final await before the caller's synchronous live-entry
        // check and push. An owner created during the settings read must win.
        try {
            const held = await vault.pendingTxs.findBy('txid', txid);
            if (!Array.isArray(held) || held.some((record) => record && record.status !== 'failed')) return null;
        } catch {
            return null;
        }
        return {
            chainId, donationIncluded: false, donatedFiat: null, currency: null,
            mainnet: counted, reservationId: null, bookingKey: txid,
        };
    }
    // Write a patch to a PendingTx this route stamped, owing it through the journal when the vault refuses.
    async function settleOrJournalPatch(vault, walletId, pendingTxId, patch) {
        if (await settleQueuedPendingTx(vault, { pendingTxId }, patch) === 'unreachable') {
            recordOwedSettlement(walletId, pendingTxId, 'patch', patch);
        }
    }
    // Keep a fee-bump replacement whose broadcast ended uncertain live as 'queued' and queue its
    // signed bytes. The entry names the original, which stays 'broadcast' until a later delivery
    // retires it; `resumedClaim` marks bytes a node may already hold.
    async function queueReplacementBytes(vault, walletId, { chainId, signed, pending, conflictRecord, error, resumedClaim = false }) {
        await settleOrJournalPatch(vault, walletId, pending.id, { status: 'queued', error });
        await enqueueSignedBroadcast(walletId, {
            chainId,
            signedTxHex: signed.txHex,
            summary: pending.actionSummary,
            txid: signed.txid,
            pendingTxId: pending.id,
            rbfReplacesPendingTxId: conflictRecord.id,
            ...(resumedClaim ? { resumedClaim: true } : {}),
        });
        await flushOwedSettlements(vault);
    }
    // §36: the claim on the donation queue a queued entry's bytes hold. The
    // verdict names it; an entry rebuilt from its PendingTx alone carries no
    // verdict, and its claim (if any) is the record's id.
    function adsClaimOf(entry) {
        const verdict = entry?.adsCommit;
        if (verdict) return typeof verdict.reservationId === 'string' && verdict.reservationId ? verdict.reservationId : null;
        return typeof entry?.pendingTxId === 'string' && entry.pendingTxId ? entry.pendingTxId : null;
    }
    // Book a queued entry whose bytes just landed: its verdict (the send's
    // per-transaction amount and, when it carried the donation, its claim),
    // or only the claim when this landing must not accrue again (an
    // interrupted claim may already have booked it). A send accrues only on a
    // mainnet chain. Accounting is non-critical: a settings-write failure must
    // not turn a landed broadcast into an error for the caller.
    async function bookLandedAds(vault, chainRegistry, entry, { accrue }) {
        await flows.bookQueuedDelivery({
            vault,
            chainRegistry,
            pendingTxId: entry?.pendingTxId ?? null,
            adsCommit: entry?.adsCommit ?? null,
            accrue,
            stampBooking: notifications.stampPendingTxAdsBooking,
            onError: (e) => console.warn(
                'broadcast.queue: ADS commit failed', e && e.message ? String(e.message) : String(e),
            ),
        });
    }
    // Book the landed commit of a queued two-phase pair as its own transaction,
    // as the live send books it, and return the entry carrying the verdict its
    // reveal books: accrue-only once the commit settled the payout.
    async function bookCommitLegAds(vault, chainRegistry, entry) {
        const { adsCommit } = await flows.bookQueuedCommitLeg({
            vault, chainRegistry, pendingTxId: entry.pendingTxId ?? null, adsCommit: entry.adsCommit ?? null,
            stampBooking: notifications.stampPendingTxAdsBooking,
            onError: (e) => console.warn('broadcast.queue: ADS commit leg failed', e && e.message ? String(e.message) : String(e)),
        });
        return adsCommit ? { ...entry, adsCommit } : entry;
    }
    // Let a queued entry's claim go when no leg landed or it was discarded.
    async function releaseQueuedAds(vault, entry) {
        // Only the named claim is cleared, so the record id is a safe fallback.
        const reservationId = adsClaimOf(entry) ?? (typeof entry?.pendingTxId === 'string' ? entry.pendingTxId : null);
        if (!reservationId) return;
        try {
            await flows.releaseAdsReservation({ vault, reservationId });
        } catch (e) {
            console.warn('broadcast.queue: ADS release failed', e && e.message ? String(e.message) : String(e));
        }
    }
    // Settle a queued pair's claim once its commit landed, even when the reveal
    // was refused. The commit still contributes as a landed transaction.
    async function settleQueuedAds(vault, entry) {
        const reservationId = adsClaimOf(entry) ?? (typeof entry?.pendingTxId === 'string' ? entry.pendingTxId : null);
        if (!reservationId) return;
        try {
            await flows.settleAdsReservation({ vault, reservationId });
        } catch (e) {
            console.warn('broadcast.queue: ADS settlement failed', e && e.message ? String(e.message) : String(e));
        }
    }
    async function replacedOriginalPendingTxId(vault, entry) {
        let originalId = entry?.rbfReplacesPendingTxId;
        if ((typeof originalId !== 'string' || !originalId)
            && typeof entry?.pendingTxId === 'string' && entry.pendingTxId) {
            try {
                originalId = (await vault?.pendingTxs?.get(entry.pendingTxId))?.rbfReplacesPendingTxId;
            } catch (_e) {
                return null;
            }
        }
        return typeof originalId === 'string' && originalId ? originalId : null;
    }
    // Retire the original a queued fee-bump replacement evicted, the write tx.replace makes when its own send lands.
    // Best effort: a refused write leaves the original live, which nets its spend but never re-sends it.
    async function settleReplacedOriginal(vault, entry, replacementTxHash, knownOriginalId = undefined) {
        if (typeof replacementTxHash !== 'string' || !replacementTxHash) return;
        try {
            // Fall back to the replacement's own record when the entry lost the link.
            const originalId = knownOriginalId === undefined
                ? await replacedOriginalPendingTxId(vault, entry) : knownOriginalId;
            if (!originalId) return;
            const original = await vault?.pendingTxs?.get(originalId);
            if (!original || original.chainConfirmed === true) return;
            if (original.status !== 'broadcast' && original.status !== 'broadcasting') return;
            await vault.pendingTxs.put({ ...original, status: 'rbf-replaced', rbfReplacement: replacementTxHash });
        } catch (_e) { /* the original stays live */ }
    }
    // Rewrite a two-phase entry and its PendingTx as the reveal once the commit
    // is on the network, marked commit-landed, before the reveal goes out. A
    // crash from here resumes with the reveal alone, and a refused reveal keeps
    // its record 'broadcast' on the commit's txid (permanentReleasePatch).
    // Neither write can stop the reveal: the commit is already out.
    async function advanceToReveal(vault, walletId, q, entry, reveal) {
        const { revealTxHex: _sentHex, revealTxid: _sentTxid, ...rest } = entry;
        const advanced = {
            ...rest,
            signedTxHex: reveal.txHex,
            ...(reveal.txid ? { txid: reveal.txid } : {}),
            commitLanded: true,
            ...(entry.txid ? { commitTxid: entry.txid } : {}),
        };
        const cur = q.findIndex((e) => e.id === entry.id);
        if (cur >= 0) q[cur] = advanced;
        const patch = {
            status: 'broadcasting',
            txHex: reveal.txHex,
            txid: advanced.txid ?? null,
            commitLanded: true,
            commitTxid: entry.txid ?? null,
            error: null,
            // The verdict the reveal books, so an entry rebuilt from this record
            // does not settle a payout its landed commit already settled.
            ...(advanced.adsCommit ? { adsCommit: advanced.adsCommit } : {}),
        };
        recordOwedSettlement(walletId, advanced, 'reveal', {
            txid: advanced.txid ?? null,
            commitTxid: entry.txid ?? null,
        }, { persist: false });
        // The reveal replay rebuilds bytes and phase fields from the record, so the
        // journal keeps only the downgraded verdict and never signed bytes.
        if (advanced.adsCommit) recordOwedSettlement(walletId, advanced, 'patch', { adsCommit: advanced.adsCommit }, { persist: false });
        const checkpointSaved = await persistQueueAndSettlements();
        const settlement = await settleQueuedPendingTx(vault, advanced, patch);
        if (settlement !== 'unreachable') {
            await flushOwedSettlements(vault);
            if (!checkpointSaved) await persistQueue();
        }
        return advanced;
    }
    // In-flight claims for broadcast.queue.broadcast, keyed walletId:id.
    // `broadcastTx` is an irreversible effector, so a second call for the same
    // entry (double-click, popup and expanded tab racing) must fail before it
    // reaches the network. The claim is taken synchronously, before the
    // handler's first await, so two calls in the same tick cannot both pass
    // the check; core drainQueuedBroadcast keeps the same guard for its lane.
    // Held on the shared store, so a host built after a lock sees the claim a
    // torn-down host's broadcast still holds and neither re-sends nor discards it.
    // broadcast.queue.discard takes the same claim, so the two routes refuse each other.
    const inFlightQueueBroadcasts = queueStore.inFlight;
    host.register('broadcast.queue.broadcast', async (req, { sdkRegistry, vault, chainRegistry }) => {
        const walletId = req?.walletId;
        const id = req?.id;
        const claim = `${walletId}:${id}`;
        if (inFlightQueueBroadcasts.has(claim)) {
            const inFlight = new Error(`broadcast.queue: entry "${id}" is already being broadcast`);
            inFlight.name = flows.QUEUED_BROADCAST_IN_FLIGHT_NAME;
            throw inFlight;
        }
        inFlightQueueBroadcasts.add(claim);
        try {
            await ensureQueueLoaded();
            if (typeof walletId === 'string' && walletId) {
                await restoreQueueFromVault(vault, chainRegistry, walletId);
            }
            const q = getQueue(walletId);
            const idx = q.findIndex((entry) => entry.id === id);
            if (idx < 0) throw new Error(`broadcast.queue: no queued entry "${id}"`);
            // Reassigned once a two-phase entry's commit lands: from then on the
            // entry is its reveal, and every settlement below describes that.
            let entry = q[idx];
            await flushOwedSettlements(vault);
            // A queue save a refused write left behind the vault must not resend the commit.
            if (await syncEntryToDurableRecord(vault, entry)) await persistQueue();
            // The coins this entry spends, held once it goes out (see ownSpends.js).
            const queuedSpend = rawTxOutpoints(entry.signedTxHex);
            const queuedSpendTxid = txidOfRaw(entry.signedTxHex);
            const replacementOriginalId = await replacedOriginalPendingTxId(vault, entry);
            const replacementTxid = replacementOriginalId ? queuedSpendTxid : null;
            // Fee-bump queue metadata may name the original, but it cannot name
            // the replacement: that identity comes from the signed bytes. Refuse
            // divergent persisted metadata before a claim or network call.
            if (replacementTxid && entry.txid != null
                && String(entry.txid).toLowerCase() !== replacementTxid) {
                throw new Error('broadcast.queue: replacement entry txid does not match its signed transaction bytes');
            }
            const retryAfterMs = Number.isFinite(entry.nextRetryAt)
                ? Math.ceil(entry.nextRetryAt - Date.now())
                : 0;
            const maximumRetryAfterMs = Number.isSafeInteger(entry.retryAttempt) && entry.retryAttempt > 0
                ? queuedBroadcastRetryDelay(entry.retryAttempt)
                : QUEUED_BROADCAST_RETRY_MAX_MS;
            // A persisted deadline cannot legitimately have more time left than
            // the delay that created it. A larger value means the clock moved back.
            if (retryAfterMs > 0 && retryAfterMs <= maximumRetryAfterMs) {
                const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
                const retryError = new Error(
                    `Sending is paused after a network failure. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
                );
                retryError.name = flows.BROADCAST_FAILED_TRANSIENT_NAME;
                retryError.retryAfterMs = retryAfterMs;
                throw retryError;
            }
            const sdk = sdkRegistry.get(entry.chainId);
            // The ENCODER is what broadcasts. `sdk.wallet.broadcastTx` takes the
            // encoder as a second argument and refuses without it ("Encoder client
            // is required for broadcasting"), so calling it one-argument here meant
            // every "Broadcast now" failed with an SDK developer message and the
            // signed transaction stayed queued forever. Measured on an Android
            // emulator against the LTC regtest venue, SSC-6. Same call the
            // core queue drain and `broadcast.signedTx` below already make.
            if (typeof sdk?.encoder?.broadcastTx !== 'function') {
                throw new Error(`broadcast.queue: SDK for "${entry.chainId}" lacks encoder.broadcastTx`);
            }
            // Panic-mode freeze. Broadcasting an already-signed tx invokes no signer,
            // so without this it sails straight through an active freeze - the exact
            // irreversible-effector gap the freeze exists to close. This host route
            // maintains its own queue and bypasses core drainQueuedBroadcast (which
            // already gates), so the same assertion is applied here at the new call site.
            flows.assertSigningAllowed();
            // Queue storage is not a trust boundary: bytes may have survived an
            // older build or changed outside this process. Resolve the spent
            // scripts and amounts again immediately before any durable claim or
            // network call, so a refusal leaves the entry queued and unsent.
            //
            // Coins that are no longer unspent are not a forged signature: an
            // earlier send landed and only its reply was lost, or another
            // transaction took the coins. The bytes still never go out, but the
            // chain is asked which of the two it was and the entry settles on
            // that answer instead of staying queued behind a signature error.
            let spentVerdict = null;
            try {
                await assertBroadcastSignaturesVerify({
                    sdk,
                    txHex: entry.signedTxHex,
                    signerId: 'broadcast.queue.broadcast',
                });
            } catch (verifyErr) {
                if (verifyErr?.reason !== PREVOUT_NOT_UNSPENT) throw verifyErr;
                spentVerdict = await spentInputsVerdict({ sdk, txid: queuedSpendTxid, address: verifyErr.address });
            }
            // Claim the durable half before the bytes go out, the same write
            // core's drain makes at the same point. A record reading 'queued'
            // is what the reload recovery treats as proof that its transaction
            // never reached a node, so a record left at 'queued' across the
            // network call is what would let a later boot rebuild a landed
            // transaction as a fresh queue entry and offer it for a second
            // broadcast. A vault that refuses the claim does not block the
            // broadcast: the settlement journal below is the route back.
            const claimVerdict = await settleQueuedPendingTx(vault, entry, { status: 'broadcasting', error: null });
            // The claim is also the last read of the durable half before the
            // bytes go out, so honour its verdict. 'closed' means this entry
            // names a record that is gone or terminal: it was discarded, it
            // already reached a node, or it was retired as permanently failed,
            // and the queue kept the entry only because its own best-effort
            // blob write did not land. Core's drain refuses exactly this case
            // (queuedBroadcast.js: NoQueuedTxError, then the not-queued throw),
            // so the host lane refuses it too rather than being the one route
            // that re-sends retired bytes. 'unowned' (no record at all) and
            // 'unreachable' (a locked or refusing vault) still broadcast: the
            // first is the PSBT lane, the second would strand signed bytes.
            if (claimVerdict === 'closed') {
                const retired = q.findIndex((e) => e.id === id);
                if (retired >= 0) q.splice(retired, 1);
                await persistQueue();
                throw new Error(
                    `broadcast.queue: entry "${id}" is no longer queued in the vault, so its bytes were not sent; compose a fresh transaction`,
                );
            }
            // The freeze is checked again once the claim is written, the last
            // moment before the bytes leave: a freeze armed during that write
            // (another tab, the popup, a duress entry) stops the send. The
            // record goes back to 'queued', the status reload recovery reads as
            // "signed, never sent", so the entry stays offered and unsent.
            try {
                flows.assertSigningAllowed();
            } catch (freezeErr) {
                const unclaimPatch = { status: 'queued', error: null };
                if (await settleQueuedPendingTx(vault, entry, unclaimPatch) === 'unreachable') {
                    recordOwedSettlement(walletId, entry, 'patch', unclaimPatch);
                }
                throw freezeErr;
            }
            // A freeze armed after the commit is out still holds the reveal.
            // The pair stays advanced, but returns to queued because the reveal
            // was signed and never sent. The next attempt sends it alone.
            let revealFrozen = null;
            // `q` is the live array the queue Map holds and every renderer context
            // mutates it through this one host, so a discard of a lower entry or
            // another broadcast can shift it while this handler waits on the
            // network. Removal after the await therefore re-resolves the entry by
            // id rather than trusting the index captured above; the stale index
            // would delete a different, still-valid signed transaction.
            let result;
            try {
                // Spent inputs that no transaction of this entry explains settle
                // through the catch below like any other refused send, with the
                // chain's answer standing in for the node's.
                if (spentVerdict === 'conflict' || spentVerdict === 'unknown') {
                    throw spentInputsError(spentVerdict);
                }
                // A two-phase entry carries its signed reveal: the commit goes
                // first, and the reveal follows in this same call, so the commit
                // is never sent alone. A refused commit falls to the catch below
                // with the entry unchanged, so it is settled as the pair it is.
                // A commit the chain already holds is not sent again.
                const reveal = schemas.pendingTx.queuedRevealOf(entry);
                if (reveal) {
                    try {
                        if (spentVerdict !== 'landed') await sdk.encoder.broadcastTx(entry.signedTxHex);
                    } catch (commitErr) {
                        // "Already known" is the commit delivered by an attempt
                        // interrupted before its reveal: the reveal still goes out.
                        if (!saysAlreadyOnNetwork(commitErr)) throw commitErr;
                    }
                    await ownSpends.hold(entry.chainId, queuedSpend, queuedSpendTxid, {
                        names: entry.soldNames,
                    });
                    entry = await advanceToReveal(vault, walletId, q, await bookCommitLegAds(vault, chainRegistry, entry), reveal);
                    try {
                        flows.assertSigningAllowed();
                    } catch (freezeErr) {
                        revealFrozen = freezeErr;
                        const unclaimPatch = { status: 'queued', error: null };
                        if (await settleQueuedPendingTx(vault, entry, unclaimPatch) === 'unreachable') {
                            recordOwedSettlement(walletId, entry, 'patch', unclaimPatch);
                        }
                        throw freezeErr;
                    }
                }
                // Bytes the chain already holds are settled as delivered, never resent.
                result = spentVerdict === 'landed' && !reveal
                    ? { txid: entry.txid ?? (queuedSpendTxid || null), alreadyOnNetwork: true }
                    : await sdk.encoder.broadcastTx(entry.signedTxHex);
            } catch (err) {
                if (revealFrozen !== null && err === revealFrozen) throw err;
                // The same permanence split the core queue applies,
                // applied here too - this queue retries on demand and had no way to
                // stop. A signed transaction whose inputs are gone can never
                // confirm, so leaving it on the list invites the user to press
                // "Broadcast now" forever on something already dead. Drop it from
                // the queue and say why; the recovery is a fresh compose, not
                // another attempt at these bytes. Transient failures stay queued,
                // which is what the surface is for.
                const failure = err && err.message ? String(err.message) : String(err);
                // Settle "already known" as DELIVERY for every entry: each one exists only
                // because an earlier attempt ended ambiguously, and retiring it as
                // 'failed' invites a re-compose, the one action here that can double spend.
                if (saysAlreadyOnNetwork(err)) {
                    const deliveredTxid = replacementTxid ?? entry.txid ?? null;
                    const deliveredPatch = {
                        status: 'broadcast',
                        broadcastAt: new Date().toISOString(),
                        txid: deliveredTxid,
                        error: null,
                    };
                    if (await settleQueuedPendingTx(vault, entry, deliveredPatch) === 'unreachable') {
                        recordOwedSettlement(walletId, entry, 'patch', deliveredPatch);
                    }
                    await settleReplacedOriginal(vault, entry, deliveredTxid, replacementOriginalId);
                    await ownSpends.hold(entry.chainId, queuedSpend, queuedSpendTxid, {
                        names: entry.soldNames,
                    });
                    const landed = q.findIndex((e) => e.id === id);
                    if (landed >= 0) q.splice(landed, 1);
                    await persistQueue();
                    await flushOwedSettlements(vault);
                    // Book the carried verdict exactly as the landed exit does. The booking
                    // runs only after the entry has left the persisted queue, so an entry
                    // that is still queued, an interrupted claim included, never booked.
                    // A claim still held is settled with it: it names one payout, once.
                    await bookLandedAds(vault, chainRegistry, entry, { accrue: true });
                    return { txid: deliveredTxid, alreadyOnNetwork: true };
                }
                // Apply the two transitions core's drain records: a permanent
                // rejection retires the record unless its commit landed, and a
                // transient one returns it to 'queued' for another attempt.
                const permanent = flows.classifyBroadcastFailure(err) === 'permanent';
                const releasePatch = permanent
                    ? permanentReleasePatch(entry, failure)
                    : { status: 'queued', error: failure };
                if (await settleQueuedPendingTx(vault, entry, releasePatch) === 'unreachable') {
                    recordOwedSettlement(walletId, entry, 'patch', releasePatch);
                }
                if (permanent) {
                    const cur = q.findIndex((e) => e.id === id);
                    if (cur >= 0) q.splice(cur, 1);
                    await persistQueue();
                    // A landed commit settles the pair's claim; a refused first leg releases it.
                    if (entry.commitLanded === true) await settleQueuedAds(vault, entry);
                    else await releaseQueuedAds(vault, entry);
                } else {
                    const retryAttempt = Number.isSafeInteger(entry.retryAttempt) && entry.retryAttempt > 0
                        ? entry.retryAttempt + 1
                        : 1;
                    const retryDelayMs = queuedBroadcastRetryDelay(retryAttempt);
                    const cur = q.findIndex((e) => e.id === id);
                    if (cur >= 0) {
                        q[cur] = {
                            ...q[cur],
                            retryAttempt,
                            nextRetryAt: Date.now() + retryDelayMs,
                        };
                        await persistQueue();
                    }
                    if (err && typeof err === 'object') {
                        try { err.retryAfterMs = retryDelayMs; } catch { /* a frozen error keeps no retry hint */ }
                    }
                }
                // Carry the verdict this catch just ACTED on across the messaging
                // boundary, which keeps only { name, message }. Without it the
                // banner has nothing but the encoder's own text and cannot say
                // whether the entry is still waiting or was just removed, so a
                // permanent rejection deletes the row and explains it with
                // "Encoder RPC error: ...". Derived from the verdict that drove the
                // splice rather than re-classified, so the sentence never contradicts it.
                // submitAction.js does the same thing at the same point for the
                // confirm path. Strictly last: the queue, the persist and the
                // settlement are all done, only the name changes, and a frozen or
                // non-object throw must not turn a handled failure into a
                // different one.
                if (err && typeof err === 'object') {
                    try {
                        err.name = permanent
                            ? flows.BROADCAST_FAILED_PERMANENT_NAME
                            : flows.BROADCAST_FAILED_TRANSIENT_NAME;
                    } catch { /* a frozen error keeps its own name */ }
                }
                throw err;
            }
            // Encoder result shape varies by chain, same as `broadcast.signedTx`
            // below: normalize so the caller always sees { txid }. A fee-bump
            // replacement is single-phase, so its byte-derived txid outranks an
            // echo a malformed reply can get wrong;
            // every other entry keeps the encoder's answer, since a two-phase entry
            // can still carry its commit's txid while its reveal goes out.
            const reportedTxid = typeof result === 'string' ? result : (result?.txid ?? result?.tx_hash ?? null);
            const txid = replacementTxid ?? reportedTxid;
            const landedPatch = {
                status: 'broadcast',
                broadcastAt: new Date().toISOString(),
                txid: txid ?? entry.txid ?? null,
                error: null,
            };
            // Every exit settles or journals the record BEFORE the entry leaves
            // the queue: a vault rebuild on another host treats a 'broadcasting'
            // record that neither the queue nor the journal names as orphaned.
            if (await settleQueuedPendingTx(vault, entry, landedPatch) === 'unreachable') {
                recordOwedSettlement(walletId, entry, 'patch', landedPatch);
            }
            await settleReplacedOriginal(vault, entry, landedPatch.txid, replacementOriginalId);
            await ownSpends.hold(entry.chainId, queuedSpend, queuedSpendTxid, {
                names: entry.soldNames,
            });
            const cur = q.findIndex((e) => e.id === id);
            if (cur >= 0) q.splice(cur, 1);
            await persistQueue();
            await flushOwedSettlements(vault);
            // §36.3 / §5.3.4: the queued tx is what donates, so its ADS verdict is
            // booked here, after the bytes landed and after the entry left the
            // queue (a retry cannot reach it, so nothing books twice).
            // `donationIncluded` is the verdict submitAction resolved for these
            // exact bytes; it is carried, never re-derived from today's settings,
            // and the claim it names on the queue is settled with it. An entry
            // rebuilt from its PendingTx alone settles the claim that record holds.
            await bookLandedAds(vault, chainRegistry, entry, { accrue: true });
            return { ...(result && typeof result === 'object' ? result : {}), txid };
        } finally {
            inFlightQueueBroadcasts.delete(claim);
        }
    });
    host.register('broadcast.queue.discard', async (req, { vault, chainRegistry }) => {
        // Refuse while a broadcast holds this entry, and hold the claim ourselves so
        // none starts mid-discard: a half-applied discard orphans a 'queued' record.
        const claim = `${req?.walletId}:${req?.id}`;
        if (inFlightQueueBroadcasts.has(claim)) {
            throw new Error(`broadcast.queue: entry "${req?.id}" is already being broadcast; discard it after that attempt settles`);
        }
        inFlightQueueBroadcasts.add(claim);
        try {
            await ensureQueueLoaded();
            if (typeof req?.walletId === 'string' && req.walletId) {
                await restoreQueueFromVault(vault, chainRegistry, req.walletId);
            }
            const q = getQueue(req?.walletId);
            const idx = q.findIndex((entry) => entry.id === req?.id);
            const entry = idx >= 0 ? q[idx] : null;
            // Retire the PendingTx half first, through the same idempotent helper the
            // core lane's Discard uses (it deletes a record still 'queued', or one
            // an interrupted claim left at 'broadcasting'), so the record is gone or
            // journaled before the entry leaves the queue.
            if (pendingTxIdsOf(entry).length > 0) {
                // Replay owed writes first, so the delete reads the commit-landed
                // state an owed advance patch carries rather than the stale record.
                await flushOwedSettlements(vault);
                for (const pendingTxId of pendingTxIdsOf(entry)) {
                    try {
                        await flows.discardQueuedBroadcast({ vault, pendingTxId });
                    } catch (_e) {
                        // The vault refused the delete, or another drain or discard
                        // holds the record (busy), and the queue half is about to go,
                        // so the journal is the route back to the record.
                        recordOwedSettlement(req?.walletId, pendingTxId, 'discard');
                    }
                }
            }
            const cur = q.findIndex((e) => e.id === req?.id);
            if (cur >= 0) q.splice(cur, 1);
            await persistQueue();
            await flushOwedSettlements(vault);
            // Discarded bytes never pay the donation, so the next send may carry it.
            if (entry) await releaseQueuedAds(vault, entry);
            return { discarded: idx >= 0 };
        } finally {
            inFlightQueueBroadcasts.delete(claim);
        }
    });

    // §49.1 / G153: reachability probe across the supplied chains.
    // Read-only across SDK ping endpoints; no vault access required.
    host.register('reachability.check', async (req, { sdkRegistry }) => {
        const chainIds = Array.isArray(req?.chainIds) ? req.chainIds.filter((s) => typeof s === 'string' && s) : [];
        if (chainIds.length === 0) {
            // No active chains: surface "offline" so the banner can
            // explain rather than silently treating it as healthy.
            return { overall: 'offline', perChain: [] };
        }
        return checkReachability({
            sdkRegistry,
            chainIds,
            timeoutMs: typeof req?.timeoutMs === 'number' ? req.timeoutMs : undefined,
        });
    });

    // §30.4 / G088: read-only PSBT decompose. The form pastes hex/base64
    // before any auth, so this handler doesn't touch vault: purely
    // sdkRegistry. Caller normalizes hex before sending.
    // §20 / G040 FOLLOWUP 1: broadcast a signed transaction extracted
    // from a signed PSBT by the renderer-side `auth.signPsbt` flow. The
    // PsbtSignForm result page wires this so a Full-mode wallet can broadcast
    // PSBTs round-tripped from a Watcher / Signer pair without copy-pasting
    // the txHex into a block explorer.
    host.register('broadcast.signedTx', async (req, { sdkRegistry, vault, chainRegistry }) => {
        let walletId = req?.walletId;
        const chainId = req?.chainId;
        const txHex = req?.txHex;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('broadcast.signedTx: chainId is required');
        }
        if (typeof txHex !== 'string' || txHex.length === 0) {
            throw new Error('broadcast.signedTx: txHex is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.encoder?.broadcastTx !== 'function') {
            throw new Error(`broadcast.signedTx: SDK encoder for "${chainId}" lacks broadcastTx`);
        }
        // Panic-mode freeze: this pushes an already-signed tx (no signer invoked),
        // so it would otherwise bypass an active freeze. Gate at the new call site,
        // same pattern as the signing chokepoints and drainQueuedBroadcast.
        flows.assertSigningAllowed();

        // These bytes come from a paste or a signed PSBT round trip, not from
        // this wallet's own signer, so every input's signature is verified
        // against the coin it spends before anything is recorded or sent:
        // against the PSBT when the caller holds one, otherwise against the
        // prevouts the UTXO tracker reports. A refusal leaves no record.
        await assertBroadcastSignaturesVerify({
            sdk,
            txHex,
            psbtHex: typeof req?.psbtHex === 'string' && req.psbtHex ? req.psbtHex : null,
            signerId: 'broadcast.signedTx',
        });

        // Audit invariant (matches the submitAction path, §11.3.8): persist a
        // PendingTx record BEFORE the irreversible broadcast so a spend through
        // this route always leaves a local trace in history / the tx-status
        // timeline, and fail closed if it cannot be recorded. The signing
        // address keeps a queued record attributable during vault recovery.
        if (!vault) {
            throw new Error('broadcast.signedTx: vault is required to record the broadcast');
        }
        if (typeof walletId !== 'string' || !walletId) {
            const wallets = await vault.wallets?.list?.();
            walletId = Array.isArray(wallets) && wallets.length === 1 ? wallets[0]?.id : null;
        }
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('broadcast.signedTx: walletId is required');
        }
        const descriptor = chainRegistry?.get?.(chainId);
        if (!descriptor) {
            throw new Error(`broadcast.signedTx: no registered chain descriptor for "${chainId}"`);
        }
        let pending = schemas.createPendingTx({
            chain: descriptor.coin,
            network: descriptor.networkKind,
            fromAddress: typeof req?.fromAddress === 'string' && req.fromAddress
                ? req.fromAddress
                : 'unknown',
            toAddress: 'unknown',
            action: 'BROADCAST_SIGNED_TX',
            actionSummary: 'Raw signed transaction broadcast via broadcast.signedTx',
            psbtHex: '',
        });
        // The caller's txid wins; a pasted raw transaction carries none, so it is
        // derived from the bytes. A record without a txid is invisible to the
        // History pending list and cannot match a duplicate of itself.
        let knownTxid = typeof req?.txid === 'string' && req.txid ? req.txid : null;
        if (!knownTxid) {
            try { knownTxid = rawTxid(txHex); } catch { knownTxid = null; }
        }
        let counted = false;
        try {
            counted = flows.isAdsCountedSend({
                settings: await vault.settings.get(), descriptor,
            });
        } catch { /* a settings failure cannot block the broadcast */ }
        let adsCommit = {
            chainId,
            donationIncluded: false,
            donatedFiat: null,
            currency: null,
            mainnet: counted,
            reservationId: null,
            bookingKey: knownTxid ?? pending.id,
        };
        pending = {
            ...pending,
            status: 'broadcasting',
            txHex,
            adsCommit,
            ...(knownTxid ? { txid: knownTxid } : {}),
        };
        await vault.pendingTxs.put(pending);
        if (!(await ownsSignedTxAds(vault, pending))) {
            adsCommit = null;
            pending = { ...pending, adsCommit: null };
            await vault.pendingTxs.put(pending);
        }

        let result;
        try {
            result = await sdk.encoder.broadcastTx(txHex);
        } catch (err) {
            const msg = err && err.message ? String(err.message) : String(err);
            if (saysAlreadyOnNetwork(err)) {
                const deliveredPatch = {
                    status: 'broadcast',
                    broadcastAt: new Date().toISOString(),
                    txid: pending.txid,
                    error: null,
                };
                if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, deliveredPatch) === 'unreachable') {
                    recordOwedSettlement(walletId, pending.id, 'patch', deliveredPatch);
                }
                await flushOwedSettlements(vault);
                await bookLandedAds(vault, chainRegistry, {
                    chainId, pendingTxId: pending.id, adsCommit,
                }, { accrue: true });
                return { txid: pending.txid, alreadyOnNetwork: true };
            }
            if (flows.classifyBroadcastFailure(err) === 'permanent') {
                const failedPatch = { status: 'failed', error: msg };
                if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, failedPatch) === 'unreachable') {
                    recordOwedSettlement(walletId, pending.id, 'patch', failedPatch);
                }
                if (err && typeof err === 'object') {
                    try { err.name = flows.BROADCAST_FAILED_PERMANENT_NAME; } catch { /* keep immutable error */ }
                }
                throw err;
            }
            const queuedPatch = { status: 'queued', error: msg };
            if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, queuedPatch) === 'unreachable') {
                recordOwedSettlement(walletId, pending.id, 'patch', queuedPatch);
            }
            const queued = await enqueueSignedBroadcast(walletId, {
                chainId,
                signedTxHex: txHex,
                summary: 'Signed transaction waiting to broadcast',
                txid: pending.txid,
                pendingTxId: pending.id,
                adsCommit,
            });
            await flushOwedSettlements(vault);
            return {
                queued: true,
                broadcast: 'queued',
                queueId: queued.entry?.id ?? null,
                pendingTxId: pending.id,
                persisted: queued.persisted,
            };
        }
        // Encoder result shape varies by chain (some return { txid }, some
        // return the txid string directly). Normalize so the caller always
        // sees { txid }.
        const txid = typeof result === 'string'
            ? result
            : (result?.txid ?? result?.tx_hash ?? null);
        if (typeof txid !== 'string' || !txid) {
            const queuedPatch = { status: 'queued', error: 'SDK did not return a txid' };
            if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, queuedPatch) === 'unreachable') {
                recordOwedSettlement(walletId, pending.id, 'patch', queuedPatch);
            }
            const queued = await enqueueSignedBroadcast(walletId, {
                chainId,
                signedTxHex: txHex,
                summary: 'Signed transaction with an unconfirmed broadcast',
                txid: pending.txid,
                pendingTxId: pending.id,
                resumedClaim: true,
                adsCommit,
            });
            await flushOwedSettlements(vault);
            return {
                queued: true,
                broadcast: 'queued',
                queueId: queued.entry?.id ?? null,
                pendingTxId: pending.id,
                persisted: queued.persisted,
                uncertain: true,
            };
        }
        const landedPatch = {
            status: 'broadcast',
            broadcastAt: new Date().toISOString(),
            txid,
            error: null,
        };
        if (await settleQueuedPendingTx(vault, { pendingTxId: pending.id }, landedPatch) === 'unreachable') {
            recordOwedSettlement(walletId, pending.id, 'patch', landedPatch);
        }
        await flushOwedSettlements(vault);
        await bookLandedAds(vault, chainRegistry, {
            chainId,
            pendingTxId: pending.id,
            adsCommit: adsCommit ? { ...adsCommit, bookingKey: txid } : null,
        }, { accrue: true });
        return { txid };
    });

    host.register('psbt.parse', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        const psbtHex = req?.psbtHex;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('psbt.parse: chainId is required');
        }
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('psbt.parse: psbtHex is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`psbt.parse: SDK for "${chainId}" lacks wallet.decomposePsbt`);
        }
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);

        // Also decode the XChain action carried inside, so the
        // PSBT confirm variant can show intent alongside the output set. This
        // is strictly ADDITIVE and best-effort: decodeActionFromPsbt fails
        // closed on the documented punts (P2SH/P2WSH, multi-leg, rest-fields),
        // and a punt is a state to RENDER (loud "could not read the action"),
        // never a reason to fail the parse. The output set is what a hostile
        // PSBT steals with, and it decomposed fine.
        let action = null;
        let actionDecodeReason = null;
        try {
            const decoded = sdk.decoder && typeof sdk.decoder.decodeActionFromPsbt === 'function'
                ? sdk.decoder.decodeActionFromPsbt(psbtHex)
                : null;
            if (decoded && decoded.ok) {
                const described = sdk.decoder.parse
                    ? sdk.decoder.parse(decoded.actionString)
                    : null;
                action = {
                    actionString: decoded.actionString,
                    action: described?.action || decoded.action || null,
                    version: described?.version ?? null,
                    params: described?.params || null,
                };
            } else {
                actionDecodeReason = (decoded && decoded.reason) || 'DECODE_FAILED';
            }
        } catch (err) {
            actionDecodeReason = err?.message || 'DECODE_FAILED';
        }
        return { decomposed, action, actionDecodeReason };
    });

    // §22 / P4: read-only preview for the co-sign approval screen. Decodes the
    // action from the PSBT and dry-runs the agent account's policy; no key is
    // derived and nothing is signed (that happens on approval via bridge.coSign).
    host.register('coSign.parse', async (req, { vault, sdkRegistry }) => {
        return flows.previewCoSignRequest({
            vault,
            sdkRegistry,
            accountId: req?.accountId,
            request: { psbt: req?.psbtHex },
        });
    });

    // §22 / P4 passive co-signer management. Provision an agent account
    // (derives the aggregate address via the SDK), list/read them, and update
    // policy / enable state. The management routes gate to BTC; these handlers
    // stay chain-neutral and let provisioning's SDK lookup enforce it.
    host.register('coSigner.provision', async (req, { vault, sdkRegistry }) => {
        return flows.provisionCoSignerAccount({ ...req, vault, sdkRegistry });
    });

    host.register('coSigner.list', async (req, { vault }) => {
        return flows.listCoSignerAccounts(vault, req?.walletId);
    });

    // Every agent account's balance in one batch read per chain, keyed by account id.
    host.register('coSigner.balances', async (req, { vault, sdkRegistry, chainRegistry }) => {
        return flows.coSignerAccountBalances({ vault, sdkRegistry, chainRegistry, walletId: req?.walletId });
    });

    // The token numbers of the tickers an agent account's rules name, read when
    // the owner saves the rules (one read per distinct ticker); signing never asks.
    host.register('coSigner.resolveTokenIds', async (req, { sdkRegistry, chainRegistry }) => {
        return flows.resolveCoSignerTokenIds({ sdkRegistry, chainRegistry, chainId: req?.chainId, ticks: req?.ticks });
    });

    host.register('coSigner.get', async (req, { vault }) => {
        return flows.getCoSignerAccount(vault, req?.id);
    });

    host.register('coSigner.update', async (req, { vault }) => {
        return flows.updateCoSignerAccount({ vault, id: req?.id, patch: req?.patch });
    });

    // §30.4 / G088: user-initiated PSBT signing. The caller supplies the
    // wallet address whose key should sign; the handler decomposes the
    // PSBT and matches inputs by address to build signingPaths. Mixed-
    // address PSBTs are partially-signed (only inputs the chosen address
    // owns) and the unsigned remainder stays in the returned PSBT for the
    // next signer in the chain.
    host.register('auth.signPsbt', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        const addressId = req?.addressId;
        const { password, psbtHex } = req ?? {};
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('auth.signPsbt: walletId is required');
        }
        if (typeof addressId !== 'string' || !addressId) {
            throw new Error('auth.signPsbt: addressId is required');
        }
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('auth.signPsbt: psbtHex is required');
        }
        // The signer comes from the wallet while the path comes from the
        // address record. Refuse hardware, watch-only and other-wallet records
        // before any of them can reach this wallet's software key.
        const { address, isHd } = await softwarePsbtAddress({
            vault, addressId, walletId, signerId: req?.signerId,
        });
        // Unlocked session uses the pooled signer. Locked sessions fall back
        // to the supplied password inside signPsbtFlow.
        const signer = await sessionSigner(req, vault, signerPool);
        if (!signer && (typeof password !== 'string' || password.length === 0)) {
            throw new Error('auth.signPsbt: password is required');
        }
        const chainId = chainRegistry.chainIdFor(address.chain, address.network);
        if (!chainId) {
            throw new Error(`auth.signPsbt: no chain id for chain "${address.chain}" and network "${address.network}"`);
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`auth.signPsbt: SDK for "${chainId}" lacks wallet.decomposePsbt`);
        }
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        const signingPaths = [];
        for (let i = 0; i < decomposed.inputs.length; i += 1) {
            if (decomposed.inputs[i].address === address.address) {
                signingPaths.push(isHd
                    ? { inputIndex: i, path: address.derivationPath }
                    : { inputIndex: i, addressId: address.id });
            }
        }
        if (signingPaths.length === 0) {
            throw new Error(
                `auth.signPsbt: no PSBT inputs match address ${address.address}. The pasted PSBT may belong to a different wallet, or the chosen signer has no inputs to sign.`,
            );
        }
        return signPsbtFlow({
            vault,
            walletId,
            password,
            signer,
            bip39Passphrase: req?.bip39Passphrase,
            chainRegistry,
            sdkRegistry,
            chainId,
            psbtHex,
            signingPaths,
        });
    });

    // §30.4 / Cluster E FOLLOWUP 1: HW variant of auth.signPsbt. Mirrors
    // the registerHwHandler pattern but auth.signPsbt's request shape
    // carries `addressId` at the top level (not under `from`), so we
    // can't use the generic helper. Resolves the Address record, builds
    // a RemoteSigner against the renderer-hosted Trezor / Ledger
    // transport, decomposes the PSBT to derive signingPaths, then
    // delegates to signPsbtFlow with the injected signer (no password).
    // Unlike auth.signPsbt, this lane is all-or-refuse: the device signers
    // need a path for EVERY input and return a final tx, never a partially
    // signed PSBT, so a mixed-address PSBT is refused here with the
    // capability message instead of dying inside the vendor converter.
    host.register('auth.signPsbt.hw', async (req, deps) => {
        const { vault, chainRegistry, sdkRegistry } = deps;
        const walletId = req?.walletId;
        const addressId = req?.addressId;
        const psbtHex = req?.psbtHex;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('auth.signPsbt.hw: walletId is required');
        }
        if (typeof addressId !== 'string' || !addressId) {
            throw new Error('auth.signPsbt.hw: addressId is required');
        }
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('auth.signPsbt.hw: psbtHex is required');
        }
        const address = await vault.addresses.get(addressId);
        if (!address) throw new Error(`auth.signPsbt.hw: address "${addressId}" not found`);
        await assertAddressInWallet(vault, address, walletId);
        const descriptor = await resolveSigner({ vault, address });
        if (!schemas.isDeviceSignerKind(descriptor.kind)) {
            throw new Error('auth.signPsbt.hw: source address is not a hardware wallet');
        }
        const transport = signerBridge.requireTransport(descriptor.signerRecord.id);
        const signer = buildRemoteSigner(descriptor, transport);
        const chainId = hwId(address, deps);
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`auth.signPsbt.hw: SDK for "${chainId}" lacks wallet.decomposePsbt`);
        }
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        const signingPaths = [];
        for (let i = 0; i < decomposed.inputs.length; i += 1) {
            if (decomposed.inputs[i].address === address.address) {
                signingPaths.push({ inputIndex: i, path: address.derivationPath });
            }
        }
        if (signingPaths.length === 0) {
            throw new Error(
                `auth.signPsbt.hw: no PSBT inputs match address ${address.address}. The pasted PSBT may belong to a different wallet, or the chosen signer has no inputs to sign.`,
            );
        }
        // All-or-refuse before the device is engaged.
        if (signingPaths.length !== decomposed.inputs.length) {
            throw new Error(
                `auth.signPsbt.hw: a hardware wallet signs every input or none, so it cannot partially sign this PSBT (${address.address} owns ${signingPaths.length} of ${decomposed.inputs.length} inputs). Use a software wallet key for co-signed PSBTs.`,
            );
        }
        return signPsbtFlow({
            vault,
            walletId,
            chainRegistry,
            sdkRegistry,
            chainId,
            psbtHex,
            signingPaths,
            signer,
        });
    });

    // HW variants: no password. The renderer (popup / web / desktop)
    // owns the live TrezorSigner / LedgerSigner instance, registered
    // against `signerBridge` when the user paired. Each handler
    // resolves the address → HW descriptor → builds a RemoteSigner
    // whose transport routes through the bridge, then delegates to
    // the same core flow with the signer injected.
    function registerHwHandler(type, flow) {
        host.register(type, async (req, deps) => {
            const { vault } = deps;
            const address = await loadAddressForHwSigning(vault, req, deps.chainRegistry);
            const descriptor = await resolveSigner({ vault, address });
            if (!schemas.isDeviceSignerKind(descriptor.kind)) {
                throw new Error(`${type}: source address is not a hardware wallet`);
            }
            // Throws with code HW_NOT_CONNECTED when the device has no live transport.
            const transport = signerBridge.requireTransport(descriptor.signerRecord.id);
            const signer = buildRemoteSigner(descriptor, transport);
            const { password: _password, ...rest } = req;
            const canonical = {
                ...rest,
                from: {
                    ...(rest.from || {}),
                    addressId: address.id,
                    address: address.address,
                    publicKey: address.publicKey,
                    derivationPath: address.derivationPath ?? undefined,
                    source: address.source,
                },
            };
            // Auto-enqueue on broadcast failure for HW lanes too.
            const onBroadcastFailure = enqueueOnBroadcastFailure(req?.walletId);
            // reservationLedger rides along for flows with post-broadcast
            // cleanup (sweepToken's PC-34 force-close leg); other flows
            // ignore the extra option.
            // A send claims its coins inside sendWithHold; every other action claims them here.
            if (flow === sendWithHold) return flow({ ...canonical, ...deps, reservationLedger, signer, onBroadcastFailure });
            return withSpendClaim(canonical, deps, (claimDeps) => flow({ ...canonical, ...claimDeps, reservationLedger, signer, onBroadcastFailure }));
        });
    }

    registerHwHandler('action.send.hw', sendWithHold);
    registerHwHandler('action.sweep.hw', sweepToken);
    registerHwHandler('action.issue.hw', issueToken);
    registerHwHandler('action.mint.hw', mintToken);
    registerHwHandler('action.destroy.hw', destroyToken);
    registerHwHandler('action.callback.hw', callbackAction);
    registerHwHandler('action.sleep.hw', sleepAction);
    registerHwHandler('action.broadcast.hw', broadcastAction);
    registerHwHandler('action.oraclePrice.hw', oraclePriceAction);
    registerHwHandler('action.addressPrefs.hw', addressPreferencesAction);
    // PC-38: N+1 device confirmations, one per chunk carrier plus the assembler.
    registerHwHandler('action.deployChunked.hw', deployChunkedRun);
    registerHwHandler('action.dispenser.hw', dispenserAction);
    registerHwHandler('action.dividend.hw', dividendAction);
    registerHwHandler('action.createList.hw', async (opts) => {
        await assertActiveSendNetwork(opts, REVIEW_ACTION_AGAIN);
        return createList(opts);
    });
    registerHwHandler('action.airdrop.hw', async (opts) => {
        await assertActiveSendNetwork(opts, REVIEW_ACTION_AGAIN);
        return airdropAction(opts);
    });
    registerHwHandler('action.advanced.hw', advancedAction);
    registerHwHandler('action.order.hw', orderAction);
    registerHwHandler('action.cancelOrder.hw', cancelOrder);
    registerHwHandler('action.editOrder.hw', editOrder);
    registerHwHandler('action.coinpay.hw', coinpayAction);
    registerHwHandler('action.swap.hw', swapAction);
    registerHwHandler('action.link.hw', linkAction);
    registerHwHandler('action.file.hw', fileAction);
    registerHwHandler('action.gatedPublish.hw', gatedPublishAction);
    registerHwHandler('action.message.hw', messageAction);
    registerHwHandler('messaging.handshake.hw', handshakeAction);
    registerHwHandler('action.deploy.hw', deployAction);
    registerHwHandler('action.execute.hw', executeAction);
    registerHwHandler('action.deposit.hw', depositAction);
    registerHwHandler('action.withdraw.hw', withdrawAction);
    registerHwHandler('action.stake.hw', stakeAction);
    registerHwHandler('action.unstake.hw', unstakeAction);
    registerHwHandler('action.collect.hw', collectAction);
    registerHwHandler('action.delegate.hw', delegateAction);
    registerHwHandler('action.revokeDelegation.hw', revokeDelegationAction);
    registerHwHandler('action.createPoll.hw', createPollAction);
    registerHwHandler('action.castBallot.hw', castBallotAction);
    registerHwHandler('action.delegateVote.hw', delegateVoteAction);
    registerHwHandler('action.createMarket.hw', createMarketAction);
    registerHwHandler('action.placeBet.hw', placeBetAction);
    registerHwHandler('action.resolveMarket.hw', resolveMarketAction);
    registerHwHandler('action.cancelMarket.hw', cancelMarketAction);
    registerHwHandler('action.editBetFeedLists.hw', editBetFeedListsAction);
    registerHwHandler('action.clearVoteDelegation.hw', clearVoteDelegationAction);
    registerHwHandler('action.contractStake.hw', contractStakeAction);

    // Signer status probe: routes straight through the signer bridge
    // without touching vault/SDK. Returns `'idle'` when the bridge
    // isn't connected yet (renderer hasn't registered), giving the
    // UI a distinct state vs. the signer actively reporting
    // 'disconnected'. requireOpen rides through to the renderer's signer,
    // which then answers 'disconnected' for a device it has not opened.
    host.register('signer.status', async (req) => {
        const signerId = req?.signerId;
        if (typeof signerId !== 'string' || signerId.length === 0) {
            throw new Error('signer.status: signerId is required');
        }
        const transport = signerBridge.getTransport(signerId);
        if (!transport) return { status: 'idle', detail: 'signer bridge not connected' };
        try {
            const res = await transport({
                op: 'status',
                payload: { signerId, chainId: req?.chainId, ...(req?.requireOpen === true ? { requireOpen: true } : {}) },
            });
            return res;
        } catch (err) {
            return {
                status: 'disconnected',
                detail: err && err.message ? String(err.message) : String(err),
            };
        }
    });

    host.register('action.sweep', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        // reservationLedger: PC-34 force-close interplay (ORDERS=1 releases
        // the swept address's auto-pay holds alongside its consents).
        const result = await sweepToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, reservationLedger, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    // PC-34: API-derived indicative preview of what a SWEEP would move
    // (balances / ownerships / open offers + escrow / gated ticks).
    host.register('sweep.preview', async (req, { sdkRegistry }) => {
        return sweepPreview({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    // Home: tokens this address holds in its own open offers, which the
    // explorer's free-balance read leaves out (a fully escrowed token vanished).
    host.register('balances.escrowed', async (req, { sdkRegistry }) => {
        return escrowedTokens({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    host.register('action.issue', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return issueToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.mint', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return mintToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.destroy', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return destroyToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-03: CALLBACK force-recall (owner-only, after CALLBACK_BLOCK).
    host.register('action.callback', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return callbackAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-03: token holder distribution summary (backs the ISSUE v4
    // callback-config editability gate + the CALLBACK payout preview).
    host.register('token.holderSummary', async (req, { sdkRegistry }) => {
        return tokenHolderSummary({
            sdkRegistry,
            chainId: req.chainId,
            tick: req.tick,
            owner: req.owner,
            callbackAmount: req.callbackAmount,
            callbackDecimals: req.callbackDecimals,
        });
    });

    // PC-05: SLEEP (pause a tick / self-lock an address).
    host.register('action.sleep', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return sleepAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-05: current pause state of a tick or address (latest SLEEP row).
    host.register('sleep.state', async (req, { sdkRegistry }) => {
        return sleepStateFor({ sdkRegistry, chainId: req.chainId, query: req.query, type: req.type, fresh: req?.fresh === true });
    });

    host.register('action.broadcast', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return broadcastAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-30: publish a PRICE v1 user oracle quote.
    host.register('action.oraclePrice', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return oraclePriceAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-30: this address's published oracle feeds, each with its live and
    // still-maturing quote.
    host.register('oracle.feeds', async (req, { sdkRegistry }) => {
        return myOracleFeeds({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    // PC-30: dispensers currently priced by this oracle address, shown before
    // a republish because they settle at whatever price matures.
    host.register('oracle.consumers', async (req, { sdkRegistry }) => {
        return oracleConsumers({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    // PC-32: write ADDRESS v0 on-chain preferences (all three fields, always).
    host.register('action.addressPrefs', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return addressPreferencesAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-32: the address's current effective preferences (consensus fold of
    // its valid ADDRESS v0 history; defaults when none).
    host.register('address.preferences', async (req, { sdkRegistry }) => {
        return currentAddressPreferences({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    host.register('action.dispenser', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await dispenserAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    // §41.3.4 ORDER / §41.3.5 CANCEL: DEX signing lanes.
    host.register('action.order', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return orderAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });
    host.register('action.cancelOrder', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return cancelOrder({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });
    // §41.3.5 ORDER v2 edit (EXPIRATION / ALLOW_LIST / BLOCK_LIST).
    host.register('action.editOrder', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return editOrder({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // §41.4 COINPAY: buyer-side settlement for token/native-coin matches.
    host.register('action.coinpay', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return coinpayAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });
    // Encode-only COINPAY for §20 watcher mode. A dedicated route rather
    // than the generic `action.psbt`, because the payee and amount must be
    // re-verified against the on-chain obligation before the output is built,
    // and that check has no business living in a generic PSBT builder.
    host.register('action.coinpay.psbt', async (req, { chainRegistry, sdkRegistry }) => {
        return buildCoinpayPsbtRequest({ ...req, chainRegistry, sdkRegistry });
    });
    host.register('coinpays.obligationsForAddress', async (req, { sdkRegistry }) => {
        return getCoinpayObligationsForAddress({ ...req, sdkRegistry });
    });
    // Payments due: what each listed payment buys, two list reads per payer
    // address for the whole list (see coinpayMatchSides.js).
    host.register('coinpays.matchSides', async (req, { sdkRegistry }) => {
        return getCoinpayMatchSides({ obligations: req?.obligations, sdkRegistry });
    });
    host.register('coinpays.forAddress', async (req, { sdkRegistry }) => {
        return getCoinpaysForAddress({ ...req, sdkRegistry });
    });

    // PC-16 CoinPay auto-pay: consent records + status. The engine
    // itself (CoinpayAutopayWatcher) runs shell-side next to the other
    // watchers; these handlers back the UI surfaces (order-row toggle,
    // exposure line, ObligationsView armed/disarmed banner). Secrets
    // never appear in these records.
    host.register('autopay.list', async (req, { vault }) => {
        return listAutopayOrders({ vault, walletId: req?.walletId, chainId: req?.chainId });
    });
    host.register('autopay.setEnabled', async (req, { vault }) => {
        return setAutopayEnabled({
            vault, id: req?.id, chainId: req?.chainId, txid: req?.txid, enabled: req?.enabled,
        });
    });
    host.register('autopay.exposure', async (req, { vault }) => {
        return autopayExposureBase({ vault, walletId: req?.walletId });
    });
    host.register('autopay.resolveIndexes', async (req, { vault, sdkRegistry }) => {
        return { resolved: await resolveOrderActionIndexes({ vault, sdkRegistry, walletId: req?.walletId }) };
    });
    // Armed/disarmed summary: a wallet with enabled consent records that
    // has no pre-unlocked signer (locked session, HW/watch-only, desktop
    // keychain-only unlock) cannot auto-pay; the UI shows the re-arm
    // banner off this. `signerPool` is absent on shells without one, in
    // which case every armed wallet reports unsignable - which is the
    // truth there.
    host.register('autopay.status', async (req, { vault, signerPool }) => {
        const records = (await listAutopayOrders({ vault, walletId: req?.walletId }))
            .filter((r) => r.autopay === true);
        const walletIds = Array.from(new Set(records.map((r) => r.walletId)));
        const unsignableWalletIds = walletIds.filter(
            (id) => !(signerPool && typeof signerPool.get === 'function' && signerPool.get(id)));
        return {
            armed: records.length,
            unsignableWalletIds,
            exposureBase: await autopayExposureBase({ vault, walletId: req?.walletId }),
        };
    });

    // §41.5 SWAP: atomic token-pair swap (no COINPAY follow-up).
    host.register('action.swap', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return swapAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // §42.8.1 LINK: anchor two existing actions across chains.
    host.register('action.link', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return linkAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // FILE: public on-chain file upload (NFT artwork attachment;
    // the AttachContentForm pairs it with an owner-validated LINK).
    host.register('action.file', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return fileAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.fileMultipart', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return handleFileMultipart(req, {
            publishMultipartFile,
            multipartSizesFor: multipartPairSizes,
            signer: await sessionSigner(req, vault, signerPool),
            vault,
            chainRegistry,
            sdkRegistry,
            resolveFileRef,
            fileBlobs,
            onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId),
        });
    });

    // Project registry: current roster lookup (ProjectRosterForm prefill).
    host.register('projects.byTick', async (req, { sdkRegistry }) => {
        return getProjectForTick({ ...req, sdkRegistry });
    });

    // §41.7.2 Messaging inbox: password-gated decrypt of MESSAGE
    // actions for one of the wallet's own addresses.
    host.register('messaging.inbox', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return getMessagingInbox({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // Per-account sweep: merge MESSAGE history across the account's
    // receive + dispenser address union (caller passes addressIds).
    host.register('messaging.inboxSweep', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return getMessagingInboxSweep({ ...req, signer: await sessionSignerForAddressIds(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // Token-gated content: list and unlock.
    // See xchain-documentation/protocol/token-gated-content.md.
    host.register('gatedContent.list', async (req, { sdkRegistry }) => {
        const sdk = sdkRegistry.get(req.chainId);
        return listGatedFiles({ sdk, tick: req.tick });
    });

    // PC-25 gated publish: atomic BATCH(FILE, MESSAGE-to-self). The
    // encode-only variant backs watcher mode; composition is shared so
    // the two paths cannot drift (flows/gatedPublishAction.js).
    host.register('action.gatedPublish', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return gatedPublishAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });
    host.register('action.gatedPublish.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        await assertActiveSendNetwork(
            { chainId: req?.chainId, vault, chainRegistry },
            REVIEW_ACTION_AGAIN,
        );
        const source = normalizeSource(req?.from, 'action.gatedPublish.composeForConfirm');
        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req,
            vault,
            chainRegistry,
            signerPool,
            chainId: req?.chainId,
            sourceAddress: source.address,
        });
        let confirmEncoderOpts = await deviceHardenedEncoderOpts(vault, req, {
            ...(req?.rbf !== undefined && { rbf: req.rbf }),
        });
        confirmEncoderOpts = withCallerSpendChoices(
            req, confirmEncoderOpts, ownAddresses, 'action.gatedPublish.composeForConfirm');
        confirmEncoderOpts = await withoutHeldCoins(req?.chainId, source.address, confirmEncoderOpts, sdkRegistry);
        return composeGatedPublishForConfirm({
            ...req,
            vault,
            chainRegistry,
            sdkRegistry,
            // A change address chosen under Advanced wins over the rotated one.
            change: confirmEncoderOpts.change ?? change,
            ownAddresses,
            confirmEncoderOpts,
            envelopeSigner: await envelopeSignerOf(vault, req),
        });
    });
    host.register('action.gatedPublish.psbt', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return buildGatedPublishPsbtRequest({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // PC-25 pack listing for the publish form: METADATA ONLY. The raw
    // key (keyHex) never crosses out of the background context; the
    // schema helper strips it (schemas/gatedKey.js).
    host.register('gatedKeys.list', async (req, { vault }) => {
        const rows = await vault.gatedKeys.list();
        return rows
            .filter((r) => r.walletId === req.walletId
                && (!req.chainId || r.chainId === req.chainId)
                && (!req.gateTicker || r.gateTicker === String(req.gateTicker).toUpperCase()))
            .map((r) => schemas.gatedKey.gatedKeyMetadata(r));
    });
    host.register('gatedContent.unlock', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return unlockGatedFileForAddress({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-34 migrate gate, custody leg: re-scope stored gated keys to the
    // migration-target wallet (same vault, no password, no network; the
    // key bytes never leave the background context). Returns counts only.
    host.register('gatedKeys.copyToWallet', async (req, { vault }) => {
        return copyGatedKeysToWallet({
            vault,
            fromWalletId: req.fromWalletId,
            toWalletId: req.toWalletId,
            chainId: req.chainId,
        });
    });

    // PC-26: pre-submit readiness for the Send form. Secret-free report
    // (pack hashes + booleans): is the tick gated, which keys are held.
    host.register('gatedContent.sendReadiness', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return gatedSendReadiness({
            sdkRegistry, chainRegistry, vault,
            walletId: req.walletId,
            chainId: req.chainId,
            tick: req.tick,
            sourceAddress: req.sourceAddress,
            // PC-29: destination + amount feed the unlock-threshold lane
            // (inert until the GATE_MIN_AMOUNT flag day).
            to: req.to,
            amount: req.amount,
        });
    });

    // PC-26: on-demand key-recovery scan, vault-persisted (source
    // 'recovered'). Password-gated: the scan ECIES-decrypts with each
    // software address's private key. Returns metadata only.
    host.register('gatedContent.scan', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const byChain = await addressesByChain(req, { vault, chainRegistry });
        return recoverGatedKeysForTick({
            vault, chainRegistry, sdkRegistry,
            walletId: req.walletId,
            password: req.password,
            bip39Passphrase: req.bip39Passphrase,
            chainId: req.chainId,
            tick: req.tick,
            addresses: byChain?.[req.chainId] || [],
        });
    });

    // §41.7.3 Compose: MESSAGE action signing + recipient pubkey lookup.
    host.register('action.message', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return messageAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // §5.6 slice 3: compose-for-confirm for MESSAGE. MESSAGE is the one
    // action whose wire params cannot be built client-side: the body is
    // ENCRYPTED host-side (recipient pubkey lookup + address binding, and for
    // ECDH the sender's own key). So this route encrypts FIRST, then composes
    // the single PSBT over the resulting ciphertext, and returns the params
    // alongside it. The form hands those exact params back on Approve
    // (`prebuiltParams`) because encryption is non-deterministic - re-encrypting
    // would yield a different action string than the one the user approved.
    host.register('action.message.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        // Checked before the params build, which exports the key and encrypts.
        await assertActiveSendNetwork(
            { chainId: req?.broadcastChainId || req?.chainId, vault, chainRegistry },
            REVIEW_ACTION_AGAIN,
        );
        const built = await buildMessageParams({
            ...req,
            signer: await flowCheckedSigner(req, vault, signerPool),
            vault,
            chainRegistry,
            sdkRegistry,
        });
        const { params, broadcastChainId, source } = built;

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool,
            chainId: broadcastChainId,
            sourceAddress: source.address,
        });

        let encoderOpts = await deviceHardenedEncoderOpts(vault, req, {
            pubkey: source.publicKey,
            change,
            ...(req?.fee !== undefined && { fee: req.fee }),
            ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
            ...(req?.rbf !== undefined && { rbf: req.rbf }),
        });
        encoderOpts = withCallerSpendChoices(req, encoderOpts, ownAddresses, 'action.message.composeForConfirm');
        encoderOpts = await withoutHeldCoins(broadcastChainId, source.address, encoderOpts, sdkRegistry);
        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            // The tx is funded, signed and broadcast on the DELIVERY chain,
            // which is not necessarily the recipient's chain (that one only
            // sets COIN and resolves their key).
            chainId: broadcastChainId,
            actionData: { action: 'MESSAGE', params },
            encoderOpts,
            source: source.address,
            ownAddresses,
            signer: await envelopeSignerOf(vault, req),
        });
        return { ...composed, messageParams: params };
    });
    host.register('messaging.handshake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return handshakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });
    host.register('messaging.pubkey', async (req, { sdkRegistry }) => {
        return getRecipientPubkey({ ...req, sdkRegistry });
    });

    // §41.7.4 Contacts: local address book CRUD. Shared across wallets.
    host.register('contacts.list', async (_req, { vault }) => {
        return listContacts({ vault });
    });
    host.register('contacts.findByAddress', async (req, { vault }) => {
        return findContactByAddress({ ...req, vault });
    });
    host.register('contacts.save', async (req, { vault }) => {
        const r = await saveContact({ ...req, vault });
        // Contacts ride the same §19.5.2 payload as address labels, so
        // an address-book edit makes the on-chain copy stale too. They
        // are vault-global, hence no walletId.
        noteLabelChange({ vault }, null);
        return r;
    });
    // An import saves every record in one vault write; see saveContacts.
    host.register('contacts.saveMany', async (req, { vault }) => {
        const r = await saveContacts({ ...req, vault });
        if (r.saved.length > 0) noteLabelChange({ vault }, null);
        return r;
    });
    host.register('contacts.delete', async (req, { vault }) => {
        const r = await deleteContact({ ...req, vault });
        noteLabelChange({ vault }, null);
        return r;
    });

    // Dispenser discovery + detail: read-only explorer passthroughs
    // behind the background so the popup / web / desktop renderers
    // don't need to know about sdkRegistry directly.

    host.register('dispensers.forSource', async (req, { sdkRegistry }) => {
        return dispensersForSource({ ...req, sdkRegistry });
    });

    host.register('dispensers.forAddress', async (req, { sdkRegistry }) => {
        return dispensersForAddress({ ...req, sdkRegistry });
    });

    host.register('dispensers.forToken', async (req, { sdkRegistry }) => {
        return dispensersForToken({ ...req, sdkRegistry });
    });

    host.register('dispensers.byActionIndex', async (req, { sdkRegistry }) => {
        return dispenserByActionIndex({ ...req, sdkRegistry });
    });

    host.register('dispenses.query', async (req, { sdkRegistry }) => {
        return dispensesFor({ ...req, sdkRegistry });
    });
    // PC-21: dispenser lifecycle events (closes / edits / expires).
    host.register('dispensers.lifecycle', async (req, { sdkRegistry }) => {
        return dispenserLifecycleFor({ ...req, sdkRegistry });
    });

    // VM / contract discovery: read-only explorer passthroughs for the
    // §42.2 Contracts browse surface (My contracts / My interactions /
    // Browse all) and §42.3 detail page.

    host.register('contracts.forSource', async (req, { sdkRegistry }) => {
        return contractsForSource({ ...req, sdkRegistry });
    });

    host.register('contracts.forAddress', async (req, { sdkRegistry }) => {
        return contractsForAddress({ ...req, sdkRegistry });
    });

    host.register('contracts.browseAll', async (req, { sdkRegistry }) => {
        return contractsBrowseAll({ ...req, sdkRegistry });
    });

    host.register('deposits.forAddress', async (req, { sdkRegistry }) => {
        return depositsForAddress({ ...req, sdkRegistry });
    });

    host.register('withdrawals.forAddress', async (req, { sdkRegistry }) => {
        return withdrawalsForAddress({ ...req, sdkRegistry });
    });

    // §42.3 Contract detail page: metadata / state / balances /
    // executions + the originating DEPLOY action.

    host.register('contracts.byActionIndex', async (req, { sdkRegistry }) => {
        return contractByActionIndex({ ...req, sdkRegistry });
    });

    // Phase F: permissions-manifest read for the inline consent
    // disclosure. Never throws (the flow degrades to a null manifest);
    // the SDK reader (Part 2) may not exist in the installed SDK yet.
    host.register('contracts.manifest', async (req, { sdkRegistry }) => {
        return contractManifestFor({ ...req, sdkRegistry });
    });

    // Phase F: controller-bind authoring helpers. `controller.actionClasses`
    // populates the form dropdown (degrades to the locked-fact list when the
    // SDK's controller helper is absent); `controller.buildParams` runs the
    // right sdk.controller.* builder host-side (core can't import the SDK)
    // and returns the `{ action, params }` the form submits via advancedAction.
    host.register('controller.actionClasses', async (req, { sdkRegistry }) => {
        return { actionClasses: controllerActionClasses(sdkRegistry, req?.chainId) };
    });
    host.register('controller.buildParams', async (req, { sdkRegistry }) => {
        return controllerBindParams({ ...req, sdkRegistry });
    });

    host.register('actions.byIndex', async (req, { sdkRegistry }) => {
        return actionByIndex({ ...req, sdkRegistry });
    });

    host.register('contracts.state', async (req, { sdkRegistry }) => {
        return contractState({ ...req, sdkRegistry });
    });

    host.register('contracts.balance', async (req, { sdkRegistry }) => {
        return contractBalance({ ...req, sdkRegistry });
    });

    host.register('executions.forContract', async (req, { sdkRegistry }) => {
        return executionsForContract({ ...req, sdkRegistry });
    });

    // §42.6 DEPLOY authoring: action composer + three pure-function
    // passthroughs over sdk.contracts.* for the validate / size /
    // suggest-gas buttons.

    host.register('action.deploy', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return deployAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.execute', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await executeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    host.register('action.deposit', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await depositAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    host.register('action.withdraw', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await withdrawAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    // §42.7 Staking: four read-only explorer passthroughs backing
    // the dashboard + operator dashboard.

    host.register('stakes.forAddress', async (req, { sdkRegistry }) => {
        return stakesForAddress({ ...req, sdkRegistry });
    });

    host.register('delegations.forAddress', async (req, { sdkRegistry }) => {
        return delegationsForAddress({ ...req, sdkRegistry });
    });

    host.register('rewards.forAddress', async (req, { sdkRegistry }) => {
        return rewardsForAddress({ ...req, sdkRegistry });
    });

    // PC-47: the claim side of the unclaimed-rewards sum.
    host.register('rewardClaims.forAddress', async (req, { sdkRegistry }) => {
        return rewardClaimsForAddress({ ...req, sdkRegistry });
    });

    host.register('validators.forChain', async (req, { sdkRegistry }) => {
        return validatorsForChain({ ...req, sdkRegistry });
    });

    host.register('capabilities.thresholds', async (req, { sdkRegistry }) => {
        return capabilityThresholds({ ...req, sdkRegistry });
    });

    host.register('action.stake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return stakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.unstake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return unstakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.collect', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return collectAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.delegate', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return delegateAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.revokeDelegation', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return revokeDelegationAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // VOTE governance authoring (v0 create poll, v1 cast ballot, v3 delegate / clear).
    // Software-signed passthroughs; the .hw twins are registered via registerHwHandler above.
    host.register('action.createPoll', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return createPollAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.castBallot', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return castBallotAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.delegateVote', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return delegateVoteAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.clearVoteDelegation', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return clearVoteDelegationAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // VOTE governance reads (no signing): poll list / detail / frozen results / ballots.
    host.register('governance.polls', async (req, { sdkRegistry }) => {
        return pollsForChain({ ...req, sdkRegistry });
    });

    host.register('governance.poll', async (req, { sdkRegistry }) => {
        return pollDetail({ ...req, sdkRegistry });
    });

    host.register('governance.pollResults', async (req, { sdkRegistry }) => {
        return pollResults({ ...req, sdkRegistry });
    });

    host.register('governance.votes', async (req, { sdkRegistry }) => {
        return votesForQuery({ ...req, sdkRegistry });
    });

    // One address's live vote delegations, one read for the My delegations list.
    host.register('governance.voteDelegations', async (req, { sdkRegistry }) => {
        return voteDelegationsForAddress({ ...req, sdkRegistry });
    });

    // BET writes. One action name over four formats, so each gets its own route
    // rather than a single route taking a version from the caller: a resolve and
    // a place-bet differ on the wire only by AMOUNT, and the messaging boundary
    // is not a place to let that distinction be inferred.
    host.register('action.createMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return createMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.placeBet', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return placeBetAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.resolveMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return resolveMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.cancelMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return cancelMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.editBetFeedLists', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return editBetFeedListsAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // Compose a BET through the SDK HOST-side, so the confirm page
    // decodes what the host actually composed rather than a client-side wire
    // mirror (the rule the vote route already follows).
    host.register('action.bet.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.bet.composeForConfirm: chainId is required');
        }
        await assertActiveSendNetwork({ chainId, vault, chainRegistry }, REVIEW_ACTION_AGAIN);
        const builder = req?.builder;
        // Allow-listed: `builder` crosses the messaging boundary, so it must
        // never be able to name an arbitrary SDK method.
        const BET_BUILDERS = ['createMarketParams', 'placeBetParams', 'resolveMarketParams', 'cancelMarketParams', 'editFeedListsParams'];
        if (!BET_BUILDERS.includes(builder)) {
            throw new Error(`action.bet.composeForConfirm: unknown builder "${builder}"`);
        }
        const sdk = sdkRegistry.get(chainId);
        if (builder !== 'editFeedListsParams' && typeof sdk?.betting?.[builder] !== 'function') {
            throw new Error(`action.bet.composeForConfirm: sdk.betting.${builder} is unavailable`);
        }
        const source = normalizeSource(req?.from, 'action.bet.composeForConfirm');
        // Throws on bad input BEFORE the confirm page opens.
        const params = builder === 'editFeedListsParams'
            ? buildEditFeedListsParams(sdk, req?.params)
            : sdk.betting[builder](req?.params);

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });

        let encoderOpts = await deviceHardenedEncoderOpts(vault, req, {
            pubkey: source.publicKey,
            change,
            ...(req?.fee !== undefined && { fee: req.fee }),
            ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
            ...(req?.rbf !== undefined && { rbf: req.rbf }),
            // Native fee mode must reach compose so the fee output is inside
            // the PSBT covered by the confirm tamper check.
            ...(req?.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: req.payFeeInNativeCoin }),
        });
        encoderOpts = withCallerSpendChoices(req, encoderOpts, ownAddresses, 'action.bet.composeForConfirm');
        encoderOpts = await withoutHeldCoins(chainId, source.address, encoderOpts, sdkRegistry);
        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData: { action: 'BET', params },
            encoderOpts,
            source: source.address,
            ownAddresses,
            // Decides whether an oversized market may ride the Taproot envelope.
            signer: await envelopeSignerOf(vault, req),
        });
        // The built wire params ride back so the confirm page decodes its intent
        // from what the HOST composed, not from the editor state.
        return { ...composed, betParams: params };
    });

    host.register('action.bet.psbt', async (req, { chainRegistry, sdkRegistry }) => {
        return buildBetActionPsbt({ ...req, chainRegistry, sdkRegistry });
    });

    // BET reads (no signing): market list / one market with pools + timeline /
    // placed bets / an oracle's track record.
    host.register('bet.feeds', async (req, { sdkRegistry }) => {
        return betFeedsForChain({ ...req, sdkRegistry });
    });

    host.register('bet.feed', async (req, { sdkRegistry }) => {
        return betFeedDetail({ ...req, sdkRegistry });
    });

    host.register('bet.bets', async (req, { sdkRegistry }) => {
        return betsForQuery({ ...req, sdkRegistry });
    });

    host.register('bet.oracle', async (req, { sdkRegistry }) => {
        return oracleStats({ ...req, sdkRegistry });
    });

    // Payout projection runs through the SDK's own settlement-order math, so the
    // number shown before signing cannot disagree with the number settled.
    host.register('bet.projectPayout', async (req, { sdkRegistry }) => {
        return projectBetPayout({ ...req, sdkRegistry });
    });

    // What opening a market costs in protocol fees. Same reason as above: the
    // charge is duration-priced with a half-up day count, so the quote has to come
    // from the SDK's arithmetic rather than the form's.
    host.register('bet.projectFeedCreateFee', async (req, { sdkRegistry }) => {
        return projectBetFeedCreateFee({ ...req, sdkRegistry });
    });

    // Contract-targeted staking: parallel to the capability staking passthroughs above.
    // Backs StakingList/StakeDetail contract rows (reads) and ContractStakeForm (write).

    host.register('contract_stakes.forAddress', async (req, { sdkRegistry }) => {
        return contractStakesForAddress({ ...req, sdkRegistry });
    });

    host.register('contract_unstakes.forAddress', async (req, { sdkRegistry }) => {
        return contractUnstakesForAddress({ ...req, sdkRegistry });
    });

    host.register('slash_events.forAddress', async (req, { sdkRegistry }) => {
        return slashEventsForAddress({ ...req, sdkRegistry });
    });

    host.register('action.contractStake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return contractStakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('broadcasts.forAddress', async (req, { sdkRegistry }) => {
        return broadcastsForAddress({ ...req, sdkRegistry });
    });

    host.register('links.address', async (req, { sdkRegistry }) => {
        return linksForAddress({ ...req, sdkRegistry });
    });

    host.register('tokens.search', async (req, { sdkRegistry }) => {
        // Substring-search the platform for tokens whose ticker matches
        // the query. Backs ReceivePicker's "On the platform" discovery
        // section. One-chain-at-a-time call shape mirrors `token.info`;
        // the renderer fans out across active chains.
        return searchPlatformTokens({ ...req, sdkRegistry });
    });

    host.register('tokens.owned', async (req, { sdkRegistry }) => {
        return listOwnedTokens({ ...req, sdkRegistry });
    });

    // Backs TokenDetail's supply-over-time chart. The renderer reads a
    // `data` list of { height, supply } points, so the folded series is
    // handed back under `data` with each point's block index as its height.
    host.register('token.supplyHistory', async (req, { sdkRegistry }) => {
        const history = await supplyHistoryFor({ ...req, sdkRegistry });
        return { ...history, data: history.points.map((p) => ({ ...p, height: p.blockIndex })) };
    });

    // Count the source-authored history used by MINT_ADDRESS_MAX. The token
    // balance and the mint destination do not answer this protocol limit.
    host.register('token.mintedAmountForAddress', async (req, { sdkRegistry }) => {
        return mintedAmountForAddress({ ...req, sdkRegistry });
    });

    host.register('token.info', async (req, { sdkRegistry, vault }) => {
        // settings.privacy.metadataFetchEnabled (default true) gates the
        // description-as-URL TIS fetch. When false the handler still
        // returns indexer-supplied fields (description / supply / locks)
        // but the gallery comes back empty, so the renderer can stay
        // structurally identical without firing a single extra request.
        let metadataFetchEnabled = true;
        try {
            const settings = await vault.settings.get();
            metadataFetchEnabled = settings?.privacy?.metadataFetchEnabled !== false;
        } catch {
            metadataFetchEnabled = true;
        }
        const resolvedFetch = (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function')
            ? globalThis.fetch.bind(globalThis)
            : undefined;
        return tokenInfoFor({
            ...req,
            sdkRegistry,
            metadataFetchEnabled,
            fetch: resolvedFetch,
        });
    });

    // §22 + §42.9 multisig wallet creation coordinator (Step 17). Writes
    // a MultisigConfig onto the chosen Wallet record's `multisig` slot.
    host.register('multisig.create', async (req, { vault, sdkRegistry }) => {
        return createMultisigConfig({ ...req, vault, sdkRegistry });
    });

    // §22.2 cosigner fields (master fingerprint, account xpub, path, pubkey)
    // for one of the wallet's own addresses. Reads the pooled signer of the
    // unlocked session only, so this route never carries a password.
    host.register('multisig.cosignerInfo', async (req, { vault, signerPool }) => {
        const signer = signerPool && typeof signerPool.get === 'function'
            ? signerPool.get(req?.walletId)
            : null;
        if (!signer) {
            throw new Error('This wallet\'s keys are not unlocked in this session. Lock and unlock the wallet, then try again, or enter the fingerprint by hand.');
        }
        return getMultisigCosignerInfo({
            vault,
            walletId: req?.walletId,
            addressId: req?.addressId,
            signer,
        });
    });

    host.register('multisig.receiveAddress', async (req, { vault, sdkRegistry }) => {
        return receiveMultisigAddress({ ...req, vault, sdkRegistry });
    });

    host.register('multisig.listAddresses', async (req, { vault, sdkRegistry }) => {
        return listMultisigReceiveAddresses({ ...req, vault, sdkRegistry });
    });

    // §22.3 + §42.9 multisig sign-round persistence + state machine
    // (Step 19). One register per surface so each handler keeps a
    // tight, single-responsibility shape: same pattern the staking
    // handlers use.
    host.register('multisigSign.start', async (req, { vault }) => {
        return startMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.startSend', async (req, { vault, sdkRegistry }) => {
        return startMultisigSend({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.importRequest', async (req, { vault, sdkRegistry }) => {
        return importMultisigSigningRequest({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.get', async (req, { vault }) => {
        return getMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.list', async (req, { vault }) => {
        return listMultisigSigningSessions({ ...req, vault });
    });

    host.register('multisigSign.cancel', async (req, { vault }) => {
        return cancelMultisigSigningSession({ ...req, vault });
    });

    host.register('multisigSign.contributeNonce', async (req, { vault }) => {
        return contributeMultisigNonce({ ...req, vault });
    });

    // The registry carries the SDK's MuSig2 partial verifier; a partial counts
    // only once it verifies.
    host.register('multisigSign.contributeSignature', async (req, { vault, sdkRegistry }) => {
        return contributeMultisigSignature({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.aggregate', async (req, { vault, sdkRegistry }) => {
        return aggregateMultisigSession({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.finalize', async (req, { vault, chainRegistry, sdkRegistry }) => {
        return finalizeMultisigSigningSession({ ...req, vault, chainRegistry, sdkRegistry });
    });

    // §22.3 + §42.9 local-cosigner contribution (Step 21). Unlocks
    // the wallet's software signer, dispatches to the right round
    // based on session.scheme + session.status, and pipes the
    // contribution through the Step 19 contribute APIs.
    host.register('multisigSign.signLocally', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return signMultisigLocally({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('contracts.validate', async (req, { sdkRegistry }) => {
        return contractValidate({ ...req, sdkRegistry });
    });

    // PC-38: the audited contract-template library (sync, no network). The
    // wallet had no path to it even though the SDK ships it, and the escrow
    // template alone is past one action's capacity, so it also needs the
    // chunked lane below.
    host.register('contracts.listTemplates', async (req, { sdkRegistry }) => {
        return sdkRegistry.get(req.chainId).listTemplates();
    });

    host.register('contracts.scaffold', async (req, { sdkRegistry }) => {
        return { code: sdkRegistry.get(req.chainId).scaffold(req.name) };
    });

    // PC-38: single-shot vs chunked, decided by the SDK's consensus-exact
    // planner. Read-only; the form calls it to size the deploy before signing.
    host.register('deploy.plan', async (req, { sdkRegistry }) => {
        const plan = planChunkedDeploy({ sdkRegistry, ...req });
        // parts are the full base64 payload; the form only needs the shape,
        // and shipping ~8KB per slice across the boundary is pure waste.
        return {
            codeHash: plan.codeHash,
            single: plan.single,
            totalChunks: plan.totalChunks,
            partLengths: plan.parts ? plan.parts.map((p) => p.length) : null,
        };
    });

    // PC-38: run (or resume) a chunked deploy. N+1 sequential signed legs, so
    // each leg waits for the indexer before the next is built (consensus
    // requires carriers to precede the assembling DEPLOY).
    host.register('action.deployChunked', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const sdk = sdkRegistry.get(req.chainId);
        return deployChunkedRun({
            ...req,
            signer: await sessionSigner(req, vault, signerPool),
            vault,
            chainRegistry,
            sdkRegistry,
            onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId),
            waitForTxid: (txid, o) => sdk.waitForAction(txid, o),
        });
    });

    host.register('pendingDeploys.listForWallet', async (req, { vault }) => {
        return listPendingDeploysForWallet({ ...req, vault });
    });

    host.register('pendingDeploys.clear', async (req, { vault }) => {
        return clearPendingDeploy({ ...req, vault });
    });

    host.register('pendingFileUploads.listForWallet', async (req, { vault }) => {
        return handleListPendingFileUploads(req, { vault });
    });

    host.register('pendingFileUploads.discard', async (req, { vault }) => {
        return handleDiscardPendingFileUpload(req, { vault });
    });

    host.register('contracts.checkCodeSize', async (req, { sdkRegistry }) => {
        return contractCheckCodeSize({ ...req, sdkRegistry });
    });

    // CONTRACT_META_REQUIRED: the identity the chain will record, read off the
    // pasted source (a static walk, no network) so the deploy form shows it
    // read-only instead of asking for a label. Null when the installed SDK
    // predates the check; the form then renders nothing.
    host.register('contracts.getExportedMeta', async (req, { sdkRegistry }) => {
        return contractExportedMeta({ ...req, sdkRegistry });
    });

    host.register('contracts.suggestGasLimit', async (req, { sdkRegistry }) => {
        return contractSuggestGasLimit({ ...req, sdkRegistry });
    });

    host.register('action.dividend', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const result = await dividendAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    host.register('holders.forTick', async (req, { sdkRegistry }) => {
        return holdersFor({ ...req, sdkRegistry });
    });

    // §40.9 AIRDROP two-transaction flow: LIST create + AIRDROP
    // reference, plus the two read-only passthroughs AirdropForm uses
    // to (a) resolve the LIST's ACTION_INDEX after it's indexed and
    // (b) confirm the LIST on the AIRDROP review screen.

    host.register('action.createList', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        await assertActiveSendNetwork({ ...req, vault, chainRegistry }, REVIEW_ACTION_AGAIN);
        return createList({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    host.register('action.airdrop', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        await assertActiveSendNetwork({ ...req, vault, chainRegistry }, REVIEW_ACTION_AGAIN);
        const result = await airdropAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
        return retainReplacementPlan(vault, result, req?.prebuiltPsbt?.psbtHex, req?.rbf, chainRegistry?.get?.(req?.chainId));
    });

    host.register('actions.byTxid', async (req, { sdkRegistry }) => {
        return actionByTxid({ ...req, sdkRegistry });
    });

    host.register('lists.byActionIndex', async (req, { sdkRegistry }) => {
        return listByActionIndex({ ...req, sdkRegistry });
    });

    host.register('lists.shared', async (req, { sdkRegistry, chainRegistry }) => {
        return sharedListDirectory({ ...req, sdkRegistry, chainRegistry });
    });

    // PC-10 "My Lists": which LIST actions has this address authored.
    host.register('lists.forSource', async (req, { sdkRegistry }) => {
        return listsForSource({ ...req, sdkRegistry });
    });

    // Pending-airdrop CRUD: crash-safe state for the §40.9 stage
    // machine (LIST-broadcast → wait-for-index → AIRDROP-broadcast).
    // The renderer persists progress here so closing the wallet
    // between stages is recoverable.

    host.register('pendingAirdrops.save', async (req, { vault }) => {
        return savePendingAirdrop({ ...req, vault });
    });

    host.register('pendingAirdrops.listForWallet', async (req, { vault }) => {
        return listPendingAirdropsForWallet({ ...req, vault });
    });

    host.register('pendingAirdrops.update', async (req, { vault }) => {
        return updatePendingAirdrop({ ...req, vault });
    });

    host.register('pendingAirdrops.clear', async (req, { vault }) => {
        return clearPendingAirdrop({ ...req, vault });
    });

    // §41.2–§41.3 DEX market queries: passthroughs to the SDK's
    // explorer client. Read-only; no vault, no signing.

    host.register('markets.list', async (req, { sdkRegistry }) => {
        return getMarkets({ ...req, sdkRegistry });
    });
    host.register('markets.byPair', async (req, { sdkRegistry }) => {
        return getMarket({ ...req, sdkRegistry });
    });
    host.register('markets.history', async (req, { sdkRegistry }) => {
        return getMarketHistory({ ...req, sdkRegistry });
    });
    host.register('markets.orders', async (req, { sdkRegistry }) => {
        return getMarketOrders({ ...req, sdkRegistry });
    });
    host.register('markets.orderbook', async (req, { sdkRegistry }) => {
        return getOrderbook({ ...req, sdkRegistry });
    });
    host.register('orders.forToken', async (req, { sdkRegistry }) => {
        return ordersForToken({ ...req, sdkRegistry });
    });
    // PC-17 My Orders: every order an address placed, across all pairs.
    host.register('orders.forAddress', async (req, { sdkRegistry }) => {
        return ordersForAddress({ ...req, sdkRegistry });
    });
    host.register('orders.cancelsForAddress', async (req, { sdkRegistry }) => {
        return orderCancelsForAddress({ ...req, sdkRegistry });
    });
    host.register('orders.detail', async (req, { sdkRegistry }) => {
        return orderDetail({ ...req, sdkRegistry });
    });
    // PC-21: order lifecycle events (edits / matches / expires / cancels).
    host.register('orders.lifecycle', async (req, { sdkRegistry }) => {
        return orderLifecycleFor({ ...req, sdkRegistry });
    });
    host.register('swaps.forToken', async (req, { sdkRegistry }) => {
        return swapsForToken({ ...req, sdkRegistry });
    });
    // PC-18 My Swaps: cross-pair swaps + authoritative cancel signal + detail.
    host.register('swaps.forAddress', async (req, { sdkRegistry }) => {
        return swapsForAddress({ ...req, sdkRegistry });
    });
    host.register('swaps.cancelsForAddress', async (req, { sdkRegistry }) => {
        return swapCancelsForAddress({ ...req, sdkRegistry });
    });
    host.register('swaps.detail', async (req, { sdkRegistry }) => {
        return swapDetail({ ...req, sdkRegistry });
    });
    // PC-21: swap lifecycle events (edits / matches / expires / cancels).
    host.register('swaps.lifecycle', async (req, { sdkRegistry }) => {
        return swapLifecycleFor({ ...req, sdkRegistry });
    });
    host.register('history.forToken', async (req, { sdkRegistry }) => {
        return historyForToken({ ...req, sdkRegistry });
    });
    host.register('genesis.forToken', async (req, { sdkRegistry }) => {
        return genesisForToken({ ...req, sdkRegistry });
    });
    host.register('tokens.subassets', async (req, { sdkRegistry }) => {
        return subtokensForTick({ ...req, sdkRegistry });
    });

    // §41.2 watchlist CRUD: per-wallet pinned markets. No signing;
    // vault-local state only.

    host.register('watchlist.listForWallet', async (req, { vault }) => {
        return listWatchlistForWallet({ ...req, vault });
    });
    host.register('watchlist.save', async (req, { vault }) => {
        return saveWatchlistEntry({ ...req, vault });
    });
    host.register('watchlist.clear', async (req, { vault }) => {
        return clearWatchlistEntry({ ...req, vault });
    });

    // §46 price-alert CRUD: per-wallet "notify me at price X" thresholds.
    // No signing; vault-local state only. The background PriceAlertWatcher
    // reads/disarms these directly via the flows (not over a route).
    host.register('priceAlert.listForWallet', async (req, { vault }) => {
        return listAlertsForWallet({ ...req, vault });
    });
    host.register('priceAlert.save', async (req, { vault }) => {
        return saveAlert({ ...req, vault });
    });
    host.register('priceAlert.clear', async (req, { vault }) => {
        return clearAlert({ ...req, vault });
    });
    host.register('priceAlert.rearm', async (req, { vault }) => {
        return rearmAlert({ ...req, vault });
    });

    host.register('alertInbox.list', async () => getDefaultAlertInbox().list());
    host.register('alertInbox.markRead', async (req) => getDefaultAlertInbox().markRead(req?.id));
    host.register('alertInbox.markAllRead', async () => getDefaultAlertInbox().markAllRead());

    // §40.10 Advanced Actions Form: generic "submit any action"
    // surface. Read-only SDK introspection handlers drive the form's
    // schema-based field list and live validation. The write path
    // accepts any (action, params) pair and forwards to submitAction,
    // which runs the SDK's validator before signing.

    host.register('action.advanced', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return advancedAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId) });
    });

    // PC-36: assemble a BATCH's COMMAND string from queued sub-actions (read-
    // only compose; no signing). The composer previews this, then signs the
    // BATCH via the generic action.advanced path with { action:'BATCH', params:{ COMMAND } }.
    // Pass the chain registry so core gates every nested action per chain.
    host.register('batch.buildCommand', async (req, { sdkRegistry, chainRegistry }) => {
        return buildBatchCommand({ ...req, sdkRegistry, chainRegistry });
    });

    host.register('sdk.listActions', async (req, { sdkRegistry }) => {
        return listActions({ ...req, sdkRegistry });
    });

    host.register('sdk.getActionFormats', async (req, { sdkRegistry }) => {
        return getActionFormats({ ...req, sdkRegistry });
    });

    // The list tick-coin probe the create-list form reads. The flow already
    // answers false for a missing SDK method, a throw or an unknown chain.
    host.register('sdk.isListTickCoinActive', async (req, { sdkRegistry }) => {
        return listTickCoinSupport({ sdkRegistry, chainId: req?.chainId });
    });

    // The address-list item gate the list create and fork forms read: the coins
    // whose addresses a LIST on this chain accepts, its own included. The flow
    // answers [] for a missing explorer, a throw or a flag that is not true.
    host.register('sdk.listAnyCoinItems', async (req, { sdkRegistry }) => {
        return listAnyCoinItemsSupport({
            sdkRegistry, chainId: req?.chainId, coin: req?.coin, networkKind: req?.networkKind,
        });
    });

    host.register('sdk.getActionFields', async (req, { sdkRegistry }) => {
        return getActionFields({ ...req, sdkRegistry });
    });

    host.register('sdk.validateAction', async (req, { sdkRegistry }) => {
        return validateActionDryRun({ ...req, sdkRegistry });
    });

    // Live network fee tiers from the encoder. The encoder names the middle
    // tier "medium" while the wallet calls it "normal", so normalize that one
    // boundary here for every shell.
    host.register('sdk.estimateFee', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('sdk.estimateFee: chainId is required');
        }
        const sdk = sdkRegistry.get(chainId);
        const owner = typeof sdk?.getFeeTiers === 'function'
            ? sdk
            : (typeof sdk?.encoder?.getFeeTiers === 'function'
                || typeof sdk?.encoder?.estimate_fee === 'function')
                ? sdk.encoder
                : null;
        const read = owner === sdk
            ? sdk.getFeeTiers
            : (owner?.getFeeTiers ?? owner?.estimate_fee);
        if (typeof read !== 'function') return null;
        try {
            const tiers = await read.call(owner);
            if (!tiers || typeof tiers !== 'object') return null;
            const tier = (rate) => Number.isFinite(rate) && rate > 0 ? { rate } : null;
            const low = tier(tiers.low);
            const normal = tier(tiers.medium ?? tiers.normal);
            const fast = tier(tiers.high ?? tiers.fast);
            if (!low && !normal && !fast) return null;
            return {
                ...(low ? { low } : {}),
                ...(normal ? { normal } : {}),
                ...(fast ? { fast } : {}),
            };
        } catch {
            return null;
        }
    });

    // The chain's published fee schedule (the indexer's /feeschedule: gas
    // table, gas price, oracle prices), which useFeeSchedule reads so a form
    // can show a fee before the action is complete enough to quote. Display
    // only, so a chain without an explorer or a failed read answers null.
    host.register('sdk.getFeeSchedule', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('sdk.getFeeSchedule: chainId is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.getFeeSchedule !== 'function') return null;
        try {
            return await sdk.getFeeSchedule();
        } catch {
            return null;
        }
    });


    host.register('signer.register', async (req, { vault }) => {
        return registerSigner({ ...req, vault });
    });

    host.register('signer.list', async (req, { vault }) => {
        const walletId = /** @type {any} */ (req)?.walletId;
        if (typeof walletId !== 'string' || walletId.length === 0) {
            throw new Error('signer.list: walletId is required');
        }
        // The renderer reopens a Ledger from these records, and checks it
        // per chain through that chain's app (ledgerIdentity.js).
        return listSignersForWallet(vault, walletId, { withIdentities: true });
    });

    host.register('signer.unregister', async (req, { vault }) => {
        const signerId = /** @type {any} */ (req)?.signerId;
        if (typeof signerId !== 'string' || signerId.length === 0) {
            throw new Error('signer.unregister: signerId is required');
        }
        return { deleted: await unregisterSigner(vault, signerId) };
    });


    host.register('wallet.exportPrivateKey', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        assertWalletUnlockedForReveal(vault, 'exportPrivateKey');
        return exportPrivateKey({ ...req, signer: await flowCheckedSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });


    host.register('balances.wallet', async (req, { vault, chainRegistry, sdkRegistry }) => {
        // Thread the user's active network into the aggregator so chains
        // on the inactive networks don't get fanned-out SDK calls. The
        // client doesn't pass `activeNetwork`; it's a server-side filter
        // derived from settings: the source of truth for "which network
        // is live" lives in one place.
        let activeNetwork;
        try {
            const settings = await vault.settings.get();
            activeNetwork = getActiveNetwork(settings);
        } catch {
            // Vault unavailable / settings unreadable: fall through
            // without the filter; walletBalances() then defaults to its
            // pre-filter behavior (every chain with addresses).
        }
        return walletBalances({ ...req, vault, chainRegistry, sdkRegistry, activeNetwork });
    });

    host.register('balances.address', async (req, { vault, sdkRegistry, chainRegistry }) => {
        // The vault lets the read answer a demo wallet's address from its
        // fixture instead of the explorer (issue #82).
        const shape = await addressBalances({ ...req, vault, sdkRegistry, chainRegistry });
        return withHeldCoinsAside(shape, req?.chainId, req?.address, sdkRegistry);
    });

    // The coin balance a form offers, without the coins another send from this
    // wallet holds. A send that is signing or waiting in the queue has spent
    // them, and the change the netted balance counts does not exist until it
    // goes out. Max prices the same coins (see unclaimedUtxos), so the
    // available line and Max agree. Nothing is read when nothing is held.
    async function withHeldCoinsAside(shape, chainId, address, sdkRegistry) {
        const native = shape?.native;
        if (!native || typeof chainId !== 'string' || typeof address !== 'string') return shape;
        const free = await unclaimedUtxos(chainId, address, sdkRegistry);
        if (!free) return shape;
        let freeSats = 0n;
        let offered;
        try {
            for (const row of free) freeSats += BigInt(row?.value ?? 0);
            offered = BigInt(native.quantity);
        } catch {
            return shape;
        }
        if (freeSats >= offered) return shape;
        return { ...shape, native: { ...native, quantity: freeSats.toString() } };
    }

    host.register('utxos.address', async (req, { sdkRegistry }) => {
        const chainId = req?.chainId;
        const address = req?.address;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('utxos.address: chainId is required');
        }
        if (typeof address !== 'string' || !address) {
            throw new Error('utxos.address: address is required');
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.getUTXOs !== 'function') {
            throw new Error(`utxos.address: SDK unavailable for "${chainId}"`);
        }
        return sdk.getUTXOs(address);
    });

    host.register('history.address', async (req, { sdkRegistry }) => {
        return addressHistory({ ...req, sdkRegistry });
    });

    // Home's value chart: one page of up to 20 addresses' token history
    // (with each action's per-address balance effects) or native coin history
    // per call, so the chart's reads follow the address batches and pages,
    // never one read per address.
    host.register('history.walletBatch', async (req, { sdkRegistry }) => {
        return walletHistoryBatch({ ...req, sdkRegistry });
    });
    host.register('history.nativeBatch', async (req, { sdkRegistry }) => {
        return walletNativeHistoryBatch({ ...req, sdkRegistry });
    });

    // M2.1: the unconfirmed half of the same read. Kept as its own channel
    // rather than folded into 'history.address' so a mempool outage degrades
    // to "no pending rows" instead of taking the confirmed history with it.
    host.register('mempool.address', async (req, { sdkRegistry }) => {
        return addressMempool({ ...req, sdkRegistry });
    });

    // M2.1: this wallet's own in-flight sends, the only record of a
    // transaction that exists between our broadcast and the network's first
    // sighting of it. Summaries only; the psbt/tx hex never leaves the host.
    //
    // A native-coin send is invisible to every action feed, so this
    // read first reconciles the address's native sends against the chain's
    // UTXO set (retiring the ones a block holds, stamping the ones the
    // mempool holds). What the outputs cannot settle, and any action the
    // feeds never retired, it then checks past the pending window against
    // the wallet's own confirmed spends and the explorer's transaction
    // record by hash, so a mined transaction is never left reading as lost.
    // The listing that follows keeps the records so retired, as confirmed
    // rows. Best-effort: a tracker or explorer outage lists the records
    // exactly as before.
    host.register('pendingTxs.forAddress', async (req, { vault, chainRegistry, sdkRegistry }) => {
        let seenNow;
        let replaced;
        try {
            ({ seenNow, replaced } = await flows.reconcileNativePendingTxs({ ...req, vault, chainRegistry, sdkRegistry }));
        } catch { /* the listing below must never depend on the tracker or the explorer */ }
        return livePendingTxs({ ...req, vault, chainRegistry, seenNow, replaced });
    });

    // "Remove from history" on a failed local send. The flow deletes only a
    // record whose status is `failed`; anything live or queued is refused,
    // so the route cannot make a send that is on the network disappear.
    host.register('pendingTxs.dismissFailed', async (req, { vault }) => {
        const removed = await flows.dismissFailedPendingTx({ vault, pendingTxId: req?.pendingTxId });
        return { removed };
    });

    // §28.3 "Indexed" timeline stage: latest block the indexer has
    // processed for a chain. Read-only status probe; the flow degrades to
    // { watermark: null } rather than throwing when the explorer can't
    // report it, so a status outage never breaks the History view.
    host.register('indexer.watermark', async (req, { sdkRegistry }) => {
        return indexerWatermark({ ...req, sdkRegistry });
    });

    // PC-42: block time of a chain's latest indexed block, the quantity every
    // timestamp-gated protocol flag-day is measured against. Read-only status
    // probe; degrades to { blockTime: null }, which callers treat as "flag-day
    // not active" so a status outage withholds a field rather than emitting
    // one the network would silently drop.
    host.register('chain.tipBlockTime', async (req, { sdkRegistry }) => {
        return chainTipBlockTime({ ...req, sdkRegistry });
    });

    // §7/§8 SPV proof verification. Verifies a token balance / action
    // against a quorum-signed checkpoint via the SDK light client. Never
    // throws to the caller (the flow normalizes transport problems to an
    // `unavailable` verdict).
    host.register('balances.verify', async (req, { sdkRegistry }) => {
        return verifyAddressBalance({ ...req, sdkRegistry });
    });

    host.register('history.verify', async (req, { sdkRegistry }) => {
        return verifyAddressAction({ ...req, sdkRegistry });
    });

    // Native-coin price oracle. Single shared instance per host so the
    // in-memory cache survives across calls within a session. Gated on
    // settings.privacy.priceDataEnabled: if the user has disabled it,
    // the handler returns `{ disabled: true }` without invoking fetch,
    // so the third party never sees a request. globalThis.fetch is the
    // browser / SW fetch in production; tests pass a mock via
    // host-construction deps (not yet wired, but the seam is here for
    // when smoke coverage lands).
    const priceOracle = (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function')
        ? createPriceOracle({ fetch: globalThis.fetch.bind(globalThis) })
        : null;
    // The fiat-rate lookup (flows/priceLookup.js) runs in the page. Where
    // the page may not fetch (the desktop renderer pins connect-src 'self'),
    // the shell routes its requests here; only the lookup's own URLs pass,
    // and CoinGecko stays behind the same privacy switch as prices.native.
    host.register('prices.fiatFetch', async (req, { vault }) => {
        const url = typeof req?.url === 'string' ? req.url : '';
        if (!isFiatRateSourceUrl(url)) return { ok: false, status: 0, error: 'not a fiat-rate source' };
        if (typeof globalThis.fetch !== 'function') return { ok: false, status: 0, error: 'fetch unavailable' };
        if (new URL(url).hostname === 'api.coingecko.com') {
            const settings = vault ? await vault.settings.get() : null;
            if (settings?.privacy?.priceDataEnabled === false) {
                return { ok: false, status: 0, error: 'price data disabled' };
            }
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
            const resp = await globalThis.fetch(url, {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            if (!resp.ok) return { ok: false, status: resp.status };
            return { ok: true, status: resp.status, body: await resp.json() };
        } catch (err) {
            return { ok: false, status: 0, error: err?.message ? String(err.message) : String(err) };
        } finally {
            clearTimeout(timeoutId);
        }
    });

    // The About panel's release feed for a page that may not fetch it. No
    // request field is read; the handler fetches its one fixed address.
    host.register('updates.releaseFeed', createReleaseFeedHandler());

    host.register('prices.native', async (req, { vault }) => {
        try {
            const settings = await vault.settings.get();
            const enabled = settings?.privacy?.priceDataEnabled !== false;
            if (!enabled) return { disabled: true };
            if (!priceOracle) return { disabled: true, error: 'fetch unavailable' };
            const fiatCurrency = typeof settings?.fiatCurrency === 'string'
                ? settings.fiatCurrency
                : 'USD';
            return await priceOracle.getNativePrices({
                chainIds: Array.isArray(req?.chainIds) ? req.chainIds : [],
                fiatCurrency,
                includeSparkline: Boolean(req?.includeSparkline),
                includeHistory: Boolean(req?.includeHistory),
            });
        } catch (err) {
            return { error: err?.message ? String(err.message) : String(err) };
        }
    });

    if (approvals && typeof approvals.fetch === 'function') {
        host.register('approval.fetch', async (req) => {
            const id = /** @type {any} */ (req)?.id;
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error('approval.fetch: id is required');
            }
            const data = approvals.fetch(id);
            if (!data) {
                throw Object.assign(new Error(`approval.fetch: unknown id "${id}"`), {
                    name: 'ApprovalNotFoundError',
                });
            }
            return data;
        });
    }
    if (approvals && typeof approvals.resolve === 'function') {
        host.register('approval.resolve', async (req) => {
            const id = /** @type {any} */ (req)?.id;
            const result = /** @type {any} */ (req)?.result;
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error('approval.resolve: id is required');
            }
            if (!result || typeof result !== 'object') {
                throw new Error('approval.resolve: result object is required');
            }
            const ok = await approvals.resolve(id, result);
            return { resolved: ok };
        });
    }

    // The agent account page shows the co-sign requests waiting on the owner.
    // It lists them with the same read-only preview the approval window shows,
    // can refuse one, and sends Approve to that window, where the password and
    // every signing check stay; nothing here signs.
    // A shell whose approvals cannot list parked requests answers with none.
    const broker = /** @type {any} */ (approvals);
    const canList = Boolean(broker && typeof broker.listPending === 'function');
    const coSignEntry = (id) => (canList
        ? broker.listPending('coSign').find((entry) => entry.id === id) || null
        : null);
    host.register('coSign.pending', async (req, { vault, sdkRegistry }) => {
        const accountId = /** @type {any} */ (req)?.accountId;
        if (typeof accountId !== 'string' || accountId.length === 0) {
            throw new Error('coSign.pending: accountId is required');
        }
        if (!canList) return [];
        const entries = broker.listPending('coSign')
            .filter((entry) => entry.payload?.payload?.accountId === accountId);
        return Promise.all(entries.map(async (entry) => {
            const base = { id: entry.id, origin: entry.payload?.origin ?? null };
            try {
                const preview = await flows.previewCoSignRequest({
                    vault, sdkRegistry, accountId, request: { psbt: entry.payload.payload.psbtHex },
                });
                return { ...base, ...preview };
            } catch (err) {
                return { ...base, decodeOk: false, decodeReason: err?.message || 'DECODE_FAILED', policyOk: false };
            }
        }));
    });
    host.register('coSign.refuse', async (req) => {
        const id = /** @type {any} */ (req)?.id;
        if (!coSignEntry(id)) return { resolved: false };
        return { resolved: await broker.resolve(id, { approved: false }) };
    });
    host.register('coSign.focus', async (req) => {
        const id = /** @type {any} */ (req)?.id;
        if (!coSignEntry(id) || typeof broker.focus !== 'function') return { focused: false };
        return { focused: await broker.focus(id) };
    });

    // Every software-signed action that spends coins claims them around its
    // whole route (see withSpendClaim); a send claims inside sendWithHold. The
    // handshake and the label publish sign the same way outside the action.*
    // namespace, and a label publish names its chain in the preparation.
    for (const type of [...SPENDING_ACTION_TYPES, ...SPENDING_ROUTES_OUTSIDE_ACTIONS]) {
        host.wrap(type, (handler) => (req, routeDeps) => {
            const chainId = req?.chainId ?? req?.preparation?.chainId;
            return withSpendClaim(chainId === req?.chainId ? req : { ...req, chainId }, routeDeps,
                (claimDeps) => handler(req, claimDeps));
        });
    }

    // A raw signed transaction claims the coins it spends before it goes out,
    // like every send the background signs (see ownSpends.js), so it can
    // neither replace a send from this wallet nor be replaced by one. The same
    // bytes sent again, a copy of a send already out or of one in the queue,
    // pass; queued bytes hold their coins through the queue entry.
    host.wrap('broadcast.signedTx', (handler) => async (req, routeDeps) => {
        const chainId = req?.chainId;
        const outpoints = typeof chainId === 'string' && chainId ? rawTxOutpoints(req?.txHex) : [];
        if (outpoints.length === 0) return handler(req, routeDeps);
        const txid = txidOfRaw(req.txHex);
        const claim = await ownSpends.claim(chainId, outpoints, { queued: await queuedOutpoints(chainId, txid), txid });
        let wentOut = false;
        try {
            const result = await handler(req, routeDeps);
            wentOut = Boolean(result?.txid) && !result?.queued;
            return result;
        } finally {
            if (wentOut) await ownSpends.keep(claim, txid);
            else await ownSpends.release(claim);
        }
    });

    registerBridgeHandlers(host, {
        approvals,
        events: bridgeEvents,
        signThrottle,
        signThrottleReady: whenSignThrottleReady,
        getAssetUrl,
        enqueueOnBroadcastFailure,
    });
    // A dApp SEND or SWEEP builds its PSBT after the approval and claims its
    // coins there, before it signs. A page names no reviewed PSBT to claim.
    for (const type of ['bridge.signAction', 'bridge.parallel']) {
        host.wrap(type, (handler) => (req, routeDeps) => withSpendClaim(
            { chainId: req?.chainId },
            routeDeps,
            (claimDeps) => handler(req, claimDeps),
        ));
    }

    // PC-16: the auto-pay engine runs shell-side (next to the other
    // watchers) but must place its funds holds in THIS host's ledger so
    // they share one netting domain with the confirm-surface
    // reservations. Exposed as a property, not a handler: the ledger
    // never crosses a message boundary.
    host.reservationLedger = reservationLedger;

    // Exposed as a property for the same reason the ledger is: the wipe
    // listener is pre-host and shell-side, and sealing the queue is not a
    // message any renderer may send.
    host.sealBroadcastQueue = sealBroadcastQueue;

    return host;
}

/**
 * A host whose shell supplied no vault keyring cannot tell whether the vault
 * itself is sealed under the password being changed, and changing only the
 * wallet record in that case locks the person out of their own wallet.
 */
export class PasswordChangeUnavailableError extends Error {
    constructor() {
        super('This app cannot change the wallet password from here. Your password has not been changed.');
        this.name = 'PasswordChangeUnavailableError';
    }
}

/**
 * A wallet record changed while a password change was being prepared (a
 * rename, an imported key or a new wallet from another window, or a second
 * change). Nothing was written; the person can simply try again.
 */
export class PasswordChangeConflictError extends Error {
    constructor() {
        super('Your wallets changed while the password was being changed. Your password has not been changed; try again.');
        this.name = 'PasswordChangeConflictError';
    }
}

/**
 * A restore into an open vault re-seals the backed-up wallet under
 * `devicePassword`, so that password has to be the one the vault opens with:
 * any other leaves a wallet the unlock skips and that cannot sign. Checked
 * against the vault key before the backup is read. An empty box is left to the
 * flow, which names it; a shell with no keyring has nothing to check against.
 *
 * @param {unknown} devicePassword
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @param {import('./vaultKeyring.js').VaultKeyring | undefined} keyring
 */
async function assertRestoreDevicePassword(devicePassword, vault, keyring) {
    if (typeof devicePassword !== 'string' || devicePassword.length === 0) return;
    if (typeof keyring?.kdfParams !== 'function' || typeof vault?.keyMatches !== 'function') return;
    const kdfParams = await keyring.kdfParams();
    if (!kdfParams) return;
    const key = await coreCrypto.deriveMasterKeyAsync(devicePassword, kdfParams);
    try {
        if (!vault.keyMatches(key)) throw new flows.RestoreDevicePasswordError();
    } finally {
        key.fill(0);
    }
}

/**
 * Change the password every seal the current password made: the target
 * wallet's, any other wallet sealed under the same password, and the vault
 * document's own key when the current password is the unlock password.
 *
 * The vault document is sealed under a key derived from the unlock password
 * and the meta slot's kdfParams, and each wallet record's seed under its own
 * derivation. Re-sealing only the wallet record left the vault on the old
 * password: the next unlock refused the new password, and the old one opened
 * the vault with the changed wallet silently missing from the signer pool.
 *
 * Every replacement record is prepared on a detached copy and the whole set is
 * written in ONE `vault.rekey` call together with the new document key, so an
 * authentication, encryption or storage failure leaves the stored vault and
 * the live session exactly as they were. KDF parameters, salt included, are
 * kept on every seal: the meta slot keeps describing the vault, and the
 * onboarding wallet keeps sharing its params with the vault key.
 *
 * @returns {Promise<{ changed: true, vaultRekeyed: boolean, walletIds: string[] }>}
 *   `vaultRekeyed` says the unlock password itself changed, which is what a
 *   biometric enrolment wraps.
 */
export async function changeWalletPassword(req, deps, operations = {}) {
    const walletId = req?.walletId;
    const currentPassword = req?.currentPassword;
    const newPassword = req?.newPassword;
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('wallet.changePassword: walletId is required');
    }
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
        throw new Error('wallet.changePassword: currentPassword is required');
    }
    if (typeof newPassword !== 'string' || newPassword.length === 0) {
        throw new Error('wallet.changePassword: newPassword is required');
    }
    if (newPassword.length < 8) {
        throw new Error('New password must be at least 8 characters.');
    }
    if (newPassword === currentPassword) {
        throw new Error('Choose a new password that differs from the current password.');
    }

    const unlock = operations.unlockWallet ?? unlockWallet;
    const rekey = operations.rekeyWalletRecord ?? rekeyWalletRecord;
    const deriveKey = operations.deriveMasterKey ?? coreCrypto.deriveMasterKeyAsync;
    const wallet = await deps.vault.wallets.get(walletId);
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

    const signer = await unlock({
        walletId,
        password: currentPassword,
        vault: deps.vault,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
    });
    try {
        signer.lock();
    } catch {
        // Verification has completed; signer cleanup is best-effort.
    }

    const keyring = deps.vaultKeyring;
    const vaultKdfParams = typeof keyring?.kdfParams === 'function' ? await keyring.kdfParams() : null;
    if (!vaultKdfParams || typeof keyring.commit !== 'function') {
        throw new PasswordChangeUnavailableError();
    }

    /** @type {Uint8Array | null} */
    let oldVaultKey = null;
    /** @type {Uint8Array | null} */
    let newVaultKey = null;
    try {
        oldVaultKey = await deriveKey(currentPassword, vaultKdfParams);
        const vaultRekeyed = deps.vault.keyMatches(oldVaultKey);

        // Re-seal on detached copies; nothing below touches the live records.
        // The target first, so its own failure is the one reported. Another
        // wallet the old password does not open was sealed under a different
        // password and keeps it.
        // The records every replacement is prepared from. The vault write below
        // refuses unless these are still the stored records, so a wallet write
        // that lands during the derivations is never overwritten or left on
        // the old password. The target was read before the verification
        // unlock, so it must still be the stored one too.
        const stored = await deps.vault.wallets.list();
        if (!stored.includes(wallet)) throw new PasswordChangeConflictError();
        const target = detachedWalletCopy(wallet);
        const sealOpts = (candidate) => ({
            walletPassword: currentPassword,
            devicePassword: newPassword,
            kdfParams: candidate.kdfParams,
        });
        if (!await rekey(target, sealOpts(target))) {
            throw new Error('This wallet has no password-protected key material.');
        }
        const candidates = [target];
        for (const other of stored) {
            if (other.id === walletId) continue;
            const candidate = detachedWalletCopy(other);
            try {
                if (await rekey(candidate, sealOpts(candidate))) candidates.push(candidate);
            } catch (err) {
                // Skip another wallet this password cannot open, or whose seal is
                // damaged: it keeps its old seal and the change goes ahead.
                const name = /** @type {any} */ (err)?.name;
                if (name !== 'BackupSeedPasswordError' && name !== 'BackupSealDamagedError') throw err;
            }
        }

        if (vaultRekeyed) newVaultKey = await deriveKey(newPassword, vaultKdfParams);
        let applied;
        try {
            applied = await deps.vault.rekey({
                ...(newVaultKey ? { masterKey: newVaultKey } : {}),
                wallets: candidates,
                readWallets: stored,
            });
        } catch (err) {
            if (/** @type {any} */ (err)?.name === 'VaultConflictError') throw new PasswordChangeConflictError();
            throw err;
        }

        const result = { changed: true, vaultRekeyed, walletIds: candidates.map((c) => c.id) };
        // A lock that lands while the change runs closes this vault. The blob
        // is written either way, so the change stands, but nothing below may
        // run after a lock: a session key or signing password written now, or
        // a signer pooled now, would leave the wallet usable behind the lock.
        const stillOpen = () => deps.vault.isOpen !== false;
        if (applied === false || !stillOpen()) return result;

        // Committed. The shell's caches follow the vault key: a stale session
        // key would reopen nothing after a worker restart or relaunch, and a
        // stale signing password would refill the pool with nothing. A failure
        // here does not undo the change; it costs one password unlock later.
        // The keyring writes only while its slot still holds the old key,
        // which a lock clears before it closes the vault.
        if (newVaultKey) {
            try {
                await keyring.commit({ masterKey: newVaultKey, password: newPassword, previousKey: oldVaultKey });
            } catch (err) {
                console.error('[xchain] wallet.changePassword: session cache not updated:', err);
            }
            // The vault key moved, so the recovery-phrase reset record moves with
            // it, onto a fresh recovery key with every entry re-wrapped: the old
            // password still opens the old key seal in any older copy of the
            // record, and that must lead to no current bundle. A failure is
            // repaired by the next unlock, which cannot open the old key seal
            // and so mints a fresh recovery key too.
            if (keyring.metaBackend) {
                try {
                    await flows.reconcilePhraseRecoveryInMeta({
                        metaBackend: keyring.metaBackend,
                        vault: deps.vault,
                        vaultKey: newVaultKey,
                        password: newPassword,
                        previousVaultKey: oldVaultKey,
                        rotate: true,
                    });
                } catch (err) {
                    console.warn('[xchain] wallet.changePassword: recovery record not refreshed:', /** @type {any} */ (err)?.name || err);
                }
            }
        }

        // The pooled signers hold the same seeds, but they were opened from
        // the old seals; reopen them from the records as stored now.
        const pool = deps.signerPool;
        for (const candidate of candidates) {
            if (!pool || !stillOpen()) break;
            try {
                await pool.unlockOne({
                    wallet: candidate,
                    password: newPassword,
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                });
                // Each unlock is an Argon2id derivation; a lock can land inside it.
                if (!stillOpen()) pool.evict?.(candidate.id);
            } catch {
                pool.evict?.(candidate.id);
            }
        }
        return result;
    } finally {
        if (oldVaultKey) oldVaultKey.fill(0);
        if (newVaultKey) newVaultKey.fill(0);
    }
}

/**
 * Take a removed wallet out of the recovery-phrase reset record (operator
 * ruling 2026-11-16, security review the same day). First the cheap drop of
 * its wrap, which fails closed on its own; then a rotation onto a fresh
 * recovery key with every remaining seed wallet re-wrapped, so the removed
 * wallet's wrap in any older copy of the record opens no current bundle. The
 * open vault lends its key and the old bundle supplies the wallet keys, so no
 * password is needed. Awaited by wallet.remove; a failure is logged and the
 * dropped wrap still stands. The vault key itself does not move (that needs
 * the password), so an older copy's own bundle still holds it; see
 * dropPhraseRecoveryWallet.
 *
 * @param {{ vault: any, vaultKeyring?: import('./vaultKeyring.js').VaultKeyring }} deps
 * @param {string} walletId
 * @returns {Promise<void>}
 */
export async function refreshPhraseRecoveryAfterRemove({ vault, vaultKeyring }, walletId) {
    const metaBackend = vaultKeyring?.metaBackend;
    if (!metaBackend) return;
    try {
        await flows.dropPhraseRecoveryWalletInMeta(metaBackend, walletId);
    } catch (err) {
        console.warn('[xchain] wallet.remove: recovery wrap not dropped:', /** @type {any} */ (err)?.name || err);
    }
    if (!vault || typeof vault.exportMasterKeyCopy !== 'function') return;
    let key = null;
    try {
        key = vault.exportMasterKeyCopy();
        await flows.reconcilePhraseRecoveryInMeta({ metaBackend, vault, vaultKey: key, rotate: true });
    } catch (err) {
        console.warn('[xchain] wallet.remove: recovery key not rotated:', /** @type {any} */ (err)?.name || err);
    } finally {
        if (key) key.fill(0);
    }
}

/**
 * Bring the recovery-phrase reset record up to date after a wallet is added to
 * an open vault (operator ruling 2026-11-16), off the reply path. The open
 * vault lends a copy of its own key (an older handle without that method has
 * it derived again from the typed password, which must then be the unlock
 * password). The typed password derives only a wallet key nobody lent, and
 * each key is checked against the wallet's seal, so a password that is not
 * this wallet's changes nothing. Any failure leaves the backfill to the next
 * unlock, as does an add with no typed password (a pooled signer supplied it).
 *
 * @param {{ vault: any, vaultKeyring?: import('./vaultKeyring.js').VaultKeyring }} deps
 * @param {unknown} password
 * @param {Map<string, Uint8Array>} [knownWalletKeys]   wallet seal keys already in hand; copied here
 * @returns {Promise<boolean>}
 */
export function refreshPhraseRecoveryAfterAdd({ vault, vaultKeyring }, password, knownWalletKeys) {
    const metaBackend = vaultKeyring?.metaBackend;
    if (!metaBackend || typeof password !== 'string' || password.length === 0 || !vault) {
        return Promise.resolve(false);
    }
    const known = new Map([...(knownWalletKeys ?? new Map())]
        .filter(([, k]) => k instanceof Uint8Array && k.length === 32)
        .map(([id, k]) => [id, new Uint8Array(k)]));
    return (async () => {
        let key = null;
        try {
            if (typeof vault.exportMasterKeyCopy === 'function') {
                key = vault.exportMasterKeyCopy();
            } else {
                const kdfParams = await vaultKeyring.kdfParams();
                if (!kdfParams || typeof vault.keyMatches !== 'function') return false;
                key = await coreCrypto.deriveMasterKeyAsync(password, kdfParams);
                if (!vault.keyMatches(key)) return false;
            }
            return await flows.reconcilePhraseRecoveryInMeta({
                metaBackend, vault, vaultKey: key, password, knownWalletKeys: known,
            });
        } finally {
            if (key) key.fill(0);
            for (const k of known.values()) k.fill(0);
        }
    })().catch((err) => {
        console.warn('[xchain] phrase recovery not refreshed after add:', /** @type {any} */ (err)?.name || err);
        return false;
    });
}

function detachedWalletCopy(wallet) {
    return {
        ...wallet,
        kdfParams: wallet.kdfParams ? { ...wallet.kdfParams } : wallet.kdfParams,
        importedKeys: Array.isArray(wallet.importedKeys)
            ? wallet.importedKeys.map((key) => ({ ...key }))
            : wallet.importedKeys,
    };
}
