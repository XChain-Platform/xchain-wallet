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

import { flows, schemas } from '@xchain-wallet/core';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import { MessageHost } from './MessageHost.js';
import { registerBridgeHandlers } from '../bridge/handlers.js';
import { applyAutoLockSignal } from './autoLockState.js';
import * as signerBridge from './signerBridge.js';
import { createBroadcastQueueStorage } from './broadcastQueueStorage.js';
import { createSignThrottleStorage } from './signThrottleStorage.js';
import { createLogConsoleStorage } from './logConsoleStorage.js';
import {
    createConfirmActionSessionStorage,
    reservationStoreFrom,
} from './confirmActionSessionStorage.js';
import { DEFAULT_ACTIVE_CHAIN_IDS } from './walletCreate.js';
// Shared with the PRE-HOST fresh-install restore lane, which never reaches this
// host: one resolver so the two lanes cannot drift on what they will fetch.
import { resolveBackupPointerContent } from './backupPointerResolver.js';

const {
    importedAddressIdsFor,
    createWallet,
    createAccount,
    activateChain,
    renameWallet,
    renameAccount,
    importMnemonic,
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
    getProjectForTick,
    getCoinpayObligationsForAddress,
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
    contractStakeAction,
    broadcastsForAddress,
    linksForAddress,
    tokenInfoFor,
    searchPlatformTokens,
    listOwnedTokens,
    createMultisigConfig,
    receiveMultisigAddress,
    listMultisigReceiveAddresses,
    startMultisigSigningSession,
    getMultisigSigningSession,
    listMultisigSigningSessions,
    cancelMultisigSigningSession,
    contributeMultisigNonce,
    contributeMultisigSignature,
    aggregateMultisigSession,
    finalizeMultisigSigningSession,
    signMultisigLocally,
    contractValidate,
    contractCheckCodeSize,
    contractSuggestGasLimit,
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
    createPriceOracle,
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
    publishLabelsNow,
    createLabelSyncScheduler,
    importWif,
    diagnosticDump,
    listBlockedOrigins,
    addBlockedOrigin,
    removeBlockedOrigin,
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
} = flows;

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
 * @param {any} req
 * @param {Object} encoderOpts
 * @returns {Object}
 */
function deviceHardenedEncoderOpts(req, encoderOpts) {
    const kind = req?.from?.source;
    if (kind === 'ledger' || kind === 'trezor') return { ...encoderOpts, attachPrevTx: true };
    return encoderOpts;
}

/**
 * Look up the Address record a `action.*.hw` handler needs to resolve
 * the right SignerRecord. The request carries `from.addressId` (the
 * Address record's id, filled by the form) OR a plain `from` triple
 * from the form. We fetch the live Address so `resolveSigner` has
 * the canonical `source` + `signerId` fields.
 *
 * @param {import('@xchain-wallet/core').storage.Vault} vault
 * @param {any} req
 * @returns {Promise<import('@xchain-wallet/core').schemas.Address>}
 */
async function loadAddressForHwSigning(vault, req) {
    const fromAddressId = req?.from?.addressId;
    if (typeof fromAddressId === 'string' && fromAddressId.length > 0) {
        const addr = await vault.addresses.get(fromAddressId);
        if (addr) return addr;
    }
    if (req?.source === 'trezor' || req?.source === 'ledger') {
        // Air-gapped / pending-airdrop flows that drive HW signing
        // without a persisted Address record (rare) can carry the
        // source + derivationPath inline on the request. Not used
        // today; keeps the resolver door open for future callers.
    }
    // Fallback: find by address string within this wallet. Handles
    // edge cases where the form omits addressId.
    if (req?.from?.address && req?.walletId) {
        const all = await vault.addresses.list();
        const match = all.find((a) => a.address === req.from.address);
        if (match) return match;
    }
    throw new Error('action.*.hw: could not resolve source address record');
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
        const record = await vault.signers.find(signerId);
        if (!record) {
            throw new Error(`signerId "${signerId}" is not a paired signer.`);
        }
        if (record.walletId !== walletId) {
            throw new Error(`signerId "${signerId}" belongs to a different wallet.`);
        }
        if (record.kind !== 'trezor' && record.kind !== 'ledger') {
            throw new Error(`signerId "${signerId}" is not a hardware signer.`);
        }
        const transport = signerBridge.getTransport(record.id);
        if (!transport) {
            throw new Error(
                'Hardware signer is not connected. Open the wallet UI, re-pair if needed, and try again.',
            );
        }
        const descriptor = { kind: record.kind, address: null, signerRecord: record };
        return buildRemoteSigner(descriptor, transport);
    }
    if (signerPool && typeof signerPool.get === 'function') {
        return signerPool.get(walletId) || null;
    }
    return null;
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
async function sessionSigner(req, vault, signerPool) {
    const signer = await pickSignerFromRequest({
        vault,
        walletId: req?.walletId,
        signerId: req?.signerId,
        signerPool,
    });
    return signer || undefined;
}

/**
 * Return the newest (highest external index) HD address for a wallet +
 * chain, or `null` if no address exists. External = change = 0 in the
 * BIP44-style derivation path. Skips imported WIFs: those aren't a
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
        if (a.source !== 'hd') continue;
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

function toSafeWallet(w) {
    return {
        schemaVersion: w.schemaVersion,
        id: w.id,
        name: w.name,
        createdAt: w.createdAt,
        origin: w.origin,
        format: w.format,
        passphraseEnabled: w.passphraseEnabled,
        // Derived, never the ciphertext itself: lets the UI tell "stored"
        // (unlock needs nothing) apart from "needs its passphrase once"
        // (passphraseEnabled but not yet captured) without ever seeing
        // encryptedPassphrase.
        passphraseStored: typeof w.encryptedPassphrase === 'string' && w.encryptedPassphrase.length > 0,
        multisigs: Array.isArray(w.multisigs) ? w.multisigs : [],
    };
}

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
 * }} deps
 * @returns {MessageHost}
 */
export function createBackgroundHost(deps) {
    const {
        approvals,
        getDiagnosticContext,
        bridgeEvents,
        // Called after a settings.update whose patch touches
        // `privacy`, so a shell that routes requests itself can re-apply
        // before the next one. Desktop uses it for Tor routing; the web
        // and extension shells cannot proxy their own traffic and pass
        // nothing, which is why this is a dep rather than shared logic.
        onPrivacySettingsChanged,
        // Resolver that turns a web-accessible-resource path into a URL a
        // dApp can load (getSupportedChains uses it for chain icons).
        // Defaults inside registerBridgeHandlers to chrome.runtime.getURL;
        // web/desktop shells and tests can inject their own.
        getAssetUrl,
        // Cluster G FOLLOWUP 2: pluggable broadcast-queue persistence.
        // Default adapter picks chrome.storage.local (extension SW) or
        // localStorage (web/desktop renderers); pass `null` explicitly
        // to opt out (in-memory only, the v0.292.0 behaviour).
        broadcastQueueStorage = createBroadcastQueueStorage(),
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
        ...hostDeps
    } = deps ?? {};
    const host = new MessageHost(hostDeps);

    // ONE reservation ledger per host, shared across every
    // approval window. A single background SW serves all popup windows, so
    // an in-memory ledger already closes the two-window same-balance race
    // (both windows' preflights net each other's approved-but-unbroadcast
    // amounts).
    //
    // §5.4: in-memory alone is not enough on MV3. Chrome may kill this worker
    // after ~30s of perceived idle - well inside the window where a user is
    // reading warnings, typing a password or waking a hardware device - and a
    // kill would silently drop every reservation, so a second window would
    // then see the full balance again and the race would be back. Backing the
    // ledger with chrome.storage.session makes the reservations survive that
    // restart; the store returns null outside an extension (Node tests, web
    // and desktop shells), where the ledger stays in-memory.
    const confirmSessionStorage = createConfirmActionSessionStorage();
    const reservationLedger = createReservationLedger(
        confirmSessionStorage ? { store: reservationStoreFrom(confirmSessionStorage) } : undefined,
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

    // Cluster S FOLLOWUP 1: sign-throttle limits read from settings.
    // The throttle's `getLimits` returns from a closure cache so reads
    // are sync. The cache is hydrated asynchronously (vault.settings.get
    // is async) by `refreshThrottleLimitsFromVault()`, called both at
    // host construction and after every successful settings.update.
    // While the cache is null (first refresh hasn't completed yet), the
    // throttle falls back to its defaults: fine for a short window.
    let cachedThrottleLimits = /** @type {{ burst?: number, windowMs?: number } | null} */ (null);
    /** @type {import('@xchain-wallet/core').storage.Vault | null} */
    let throttleVault = null;
    // Cluster Q FOLLOWUP 2: track whether we've already seeded the
    // chainRegistry instance with the persisted custom chains. The
    // registry is module-scoped in the shell entry (extension/web/
    // desktop) and survives host teardown across lock/unlock cycles,
    // so we only seed once per registry instance: re-installing a
    // descriptor would throw on the duplicate id.
    let customChainsSeeded = false;
    async function seedCustomChainsFromVault(vault, chainRegistry) {
        if (customChainsSeeded) return;
        customChainsSeeded = true;
        if (!vault || !chainRegistry) return;
        try {
            const settings = await vault.settings.get();
            const list = Array.isArray(settings?.customChains) ? settings.customChains : [];
            for (const descriptor of list) {
                try {
                    if (!descriptor || typeof descriptor !== 'object') continue;
                    if (typeof descriptor.id !== 'string') continue;
                    if (chainRegistry.has(descriptor.id)) continue;
                    chainRegistry.addCustom(descriptor);
                } catch {
                    // Per-descriptor failures (corrupt persisted record,
                    // descriptor invalid against the current validator)
                    // are skipped silently: the boot path must not crash
                    // on a single bad row.
                }
            }
        } catch {
            // Vault not open / read failed: boot continues.
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
        if (!vault) return;
        if (typeof sdkRegistry?.applyEndpointOverridesFromSettings !== 'function') return;
        try {
            const settings = await vault.settings.get();
            if (settings) sdkRegistry.applyEndpointOverridesFromSettings(settings);
        } catch {
            // Vault not open yet or read failed: the bundled defaults keep
            // serving and the next trigger tries again.
        }
    }
    void applyEndpointOverridesFromVault(hostDeps?.vault, hostDeps?.sdkRegistry);

    async function refreshThrottleLimitsFromVault() {
        if (!throttleVault) return;
        try {
            const settings = await throttleVault.settings.get();
            cachedThrottleLimits = settings?.signThrottle ?? null;
        } catch {
            // Vault not open yet (boot race) or read failed: keep
            // whatever was previously cached. The next refresh will
            // try again.
        }
    }
    // Cluster S FOLLOWUP 2: persist throttle state across SW restarts.
    // The throttle is constructed with onPersist wired to the storage
    // adapter; bucket state is hydrated asynchronously via the throttle's
    // `seed()` method as soon as the load resolves. While hydration is
    // pending, the throttle accepts requests against an empty bucket;
    // worst case a first-request-after-SW-restart slips through, no
    // worse than today's reset-on-restart behavior.
    const signThrottle = createSignThrottle({
        getLimits: () => cachedThrottleLimits || {},
        onPersist: signThrottleStorage
            ? (snapshot) => signThrottleStorage.save(snapshot)
            : undefined,
    });
    if (signThrottleStorage) {
        void (async () => {
            try {
                const snapshot = await signThrottleStorage.load();
                signThrottle.seed(snapshot?.buckets || {});
            } catch {
                // Hydration failed: start fresh.
            }
        })();
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

    host.register('wallet.exists', async (req, { vault }) => {
        const id = req?.walletId;
        if (typeof id !== 'string' || !id) return { exists: false };
        return { exists: (await vault.wallets.get(id)) !== null };
    });

    host.register('wallet.create', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const r = await createWallet({ ...req, vault, chainRegistry, sdkRegistry });
        // Same adoption as wallet.add.import below, and for a sharper reason
        // than "no password on accounts": a wallet CREATED inside an open
        // session had no signer in the pool, so anything that must sign
        // WITHOUT a prompt silently could not. PC-16 auto-pay is exactly that
        // - CoinpayAutopayWatcher asks getSigner(walletId), gets null, and
        // classifies the wallet unsignable - while the order form's success
        // screen promises "matches on this order will be paid automatically
        // while a wallet holding it is unlocked". Measured on LTC regtest: an
        // armed order matched, the obligation sat pending for ten minutes with
        // the wallet open and unlocked, and no COINPAY was ever sent.
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
        return {
            mnemonic: r.mnemonic,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
    });

    host.register('wallet.import', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const r = await importMnemonic({ ...req, vault, chainRegistry, sdkRegistry });
        return {
            format: r.format,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
    });

    // Add a wallet to an already-open vault. Distinct from `wallet.import`
    // (which the pre-host listener intercepts and rejects when a vault
    // already exists). Same flow underneath; the difference is which
    // path is reachable in which session state.
    host.register('wallet.add.import', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
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
        // the wallet that was just added.
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
        return {
            format: r.format,
            wallet: toSafeWallet(r.wallet),
            account: r.account,
            addresses: r.addresses,
        };
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
        return { wallet: toSafeWallet(updated) };
    });

    host.register('account.rename', async (req, { vault }) => {
        const updated = await renameAccount({ ...req, vault });
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
        return { account: r.account, addresses: r.addresses };
    });

    host.register('wallet.checkPassword', async (req, { vault, chainRegistry, sdkRegistry }) => {
        // Quick check: can we unlock this wallet with the supplied password?
        // Returns boolean; never holds the signer beyond this call.
        const signer = await unlockWallet({ ...req, vault, chainRegistry, sdkRegistry });
        signer.lock();
        return { ok: true };
    });

    // Can this wallet sign WITHOUT a password right now? True iff the
    // unlocked session has a pre-unlocked SoftwareSigner for it in the
    // pool. The UI uses this to hide the per-action password input
    // ("password only at unlock"): and correctly keeps prompting in the
    // rare empty-pool cases (passphrase wallet, or a worker restart that
    // couldn't rehydrate the pool).
    host.register('wallet.signerReady', async (req, { signerPool }) => {
        const walletId = req?.walletId;
        const ready = typeof walletId === 'string'
            && !!signerPool
            && typeof signerPool.has === 'function'
            && signerPool.has(walletId);
        return { ready };
    });

    // §48.3 / G149: runtime chain activation. Seeds settings.fees +
    // ads.perChain for the chainId, then derives the first address on
    // that chain for every existing account in the wallet. Idempotent:
    // re-activating a chain that already has fee + address records is
    // a no-op. HW-aware (§17.4 / FOLLOWUP 1): when req.signerId names a
    // paired hardware signer, pickSignerFromRequest builds a RemoteSigner
    // against the device transport and no password is required.
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
            password: req?.password,
            bip39Passphrase: req?.bip39Passphrase,
            signer: signer || undefined,
            vault,
            chainRegistry,
            sdkRegistry,
        });
    });


    host.register('settings.get', async (_req, { vault, chainRegistry, sdkRegistry }) => {
        // Cluster S FOLLOWUP 1: opportunistic throttle-limits cache
        // hydration. The bridge handlers don't await this, so the very
        // first sign request after SW restart may run on stale defaults
        // for one bucket; the second onward sees the user-configured
        // limits.
        if (!throttleVault) {
            throttleVault = vault;
            void refreshThrottleLimitsFromVault();
        }
        // Cluster Q FOLLOWUP 2: opportunistic custom-chain re-seed.
        // Single-flight per host instance via the customChainsSeeded
        // guard. Settings.get is the natural trigger because the popup
        // calls it shortly after unlock, before any chain-aware UI
        // mounts.
        void seedCustomChainsFromVault(vault, chainRegistry);
        // Same opportunistic trigger for custom endpoints. Covers
        // the web shell, where the module-scoped SDKRegistry is replaced
        // once the real SDK factory resolves and the fresh instance would
        // otherwise start with an empty override map.
        void applyEndpointOverridesFromVault(vault, sdkRegistry);
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
            // Settings (fees + ads.perChain) for that network's chains, the
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
        return { settings, addresses };
    });

    host.register('settings.update', async (req, { vault, sdkRegistry }) => {
        const patch = req && typeof req === 'object' && 'patch' in req
            ? /** @type {Record<string, unknown>} */ (req.patch)
            : /** @type {Record<string, unknown>} */ (req ?? {});
        const result = await updateSettings(vault, patch);
        // A saved endpoint takes effect on the next request, not
        // at the next wallet restart. Invalidates only the chains whose
        // endpoints actually moved.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'sdkEndpoints')
            && typeof sdkRegistry?.applyEndpointOverridesFromSettings === 'function') {
            sdkRegistry.applyEndpointOverridesFromSettings(result);
        }
        // Cluster S FOLLOWUP 1: refresh the sign-throttle limit cache
        // when the patch touches signThrottle so users see the change
        // take effect on the very next sign request.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'signThrottle')) {
            throttleVault = vault;
            await refreshThrottleLimitsFromVault();
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
        // The lane owns the mode flip. Doing it here rather than in the
        // renderer keeps pairing atomic (a payload always reports the mode
        // that is actually persisted) and keeps the lane working in shells
        // that expose no settings shims of their own.
        if (req?.walletMode === 'watcher' || req?.walletMode === 'signer') {
            await updateSettings(vault, { walletMode: req.walletMode });
        }
        const pooled = await sessionSigner(req, vault, signerPool);
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
            return await fn(signer, await getSettings(vault));
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
        return withPairingSigner(req, deps, async (signer, settings) => {
            const keys = await collectPairingKeys({
                signer,
                chainRegistry,
                chainIds: pairingChainIds(req, settings, chainRegistry),
            });
            const payload = buildPairingPayload({
                walletMode: settings?.walletMode,
                keys,
                label: typeof req?.label === 'string' ? req.label : '',
            });
            return { payload, encoded: encodePairingPayload(payload) };
        });
    });

    host.register('pairing.pair', async (req, deps) => {
        const { vault, chainRegistry } = deps;
        return withPairingSigner(req, deps, async (signer, settings) => {
            const keys = await collectPairingKeys({
                signer,
                chainRegistry,
                chainIds: pairingChainIds(req, settings, chainRegistry),
            });
            const local = buildPairingPayload({
                walletMode: settings?.walletMode,
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
    host.register('session.autolock', async (req) => {
        await applyAutoLockSignal(
            { armed: req?.armed === true, idleMs: req?.idleMs },
            Date.now(),
        );
        return { ok: true };
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
    host.register('diagnostic.dump', async (_req, { vault, chainRegistry }) => {
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
        if (!req?.password && signerPool && typeof signerPool.get === 'function') {
            const pooled = signerPool.get(req?.walletId);
            if (pooled && typeof pooled.getMasterKey === 'function') {
                try { sessionMasterKey = pooled.getMasterKey(); } catch { /* locked: fall through */ }
            }
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
        return { wallet: toSafeWallet(r.wallet), address: r.address };
    });

    host.register('wallet.publishLabels', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const r = await publishLabelsNow({
            vault,
            walletId: req?.walletId,
            password: req?.password,
            bip39Passphrase: req?.bip39Passphrase,
            chainId: req?.chainId,
            chainRegistry,
            sdkRegistry,
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
    // publish itself still runs through `wallet.publishLabels` with a
    // freshly typed password.
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
    host.register('wallet.importBackup', async (req, { vault }) => {
        const r = await importBackupFile({
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
        });
        return {
            walletId: r.walletId,
            writes: r.writes,
            skipped: r.skipped,
            rekeyed: r.rekeyed,
            walletName: r.payload?.wallet?.name,
        };
    });

    // §15.4: QR-from-backup-pointer restore. The renderer hands the
    // parsed pointer (from `detectQrContent`) + the backup password.
    // The host injects the resolver: it fetches the encrypted §19.4
    // envelope from the pointer's `location` and hands it to the same
    // `importBackupFile` merge path the file lane uses. Only https(s)
    // locations are fetched; on-chain FILE references are a follow-up
    // that needs SDK wiring and are rejected explicitly rather than
    // silently ignored.
    host.register('wallet.importBackupPointer', async (req, { vault }) => {
        const r = await restoreFromBackupPointer({
            vault,
            pointer: req?.pointer,
            password: req?.password,
            walletPassword: req?.walletPassword,     // As wallet.importBackup above
            devicePassword: req?.devicePassword,
            onConflict: req?.onConflict,
            mode: req?.mode,
            resolveBackupContent: resolveBackupPointerContent,
        });
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
    host.register('wallet.remove', async (req, { vault, signerPool }) => {
        const walletId = req?.walletId;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('wallet.remove: walletId is required');
        }
        const result = await removeWallet({ vault, walletId });
        if (signerPool && typeof signerPool.evict === 'function') {
            try { signerPool.evict(walletId); } catch { /* best-effort */ }
        }
        return result;
    });

    // §35.1 + §43 connected-sites maintenance. List/delete; the
    // approval-flow record creation lives in bridge/handlers.js.
    host.register('sites.list', async (_req, { vault }) => {
        const sites = await vault.connectedSites.list();
        return [...sites].sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
    });
    host.register('sites.delete', async (req, { vault }) => {
        const id = req?.id;
        if (typeof id !== 'string' || !id) {
            throw new Error('sites.delete: id is required');
        }
        await vault.connectedSites.delete(id);
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
        await vault.connectedSites.put(site);
        return { ok: true };
    });

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
        return addBlockedOrigin({ vault, origin });
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
    host.register('chainRegistry.addCustomChain', async (req, { vault, chainRegistry }) => {
        if (!req || typeof req !== 'object' || !req.descriptor) {
            throw new Error('chainRegistry.addCustomChain: descriptor required');
        }
        return addCustomChain({ vault, chainRegistry, descriptor: req.descriptor });
    });
    host.register('chainRegistry.removeCustomChain', async (req, { vault, chainRegistry }) => {
        if (!req || typeof req !== 'object' || typeof req.chainId !== 'string') {
            throw new Error('chainRegistry.removeCustomChain: chainId required');
        }
        return removeCustomChain({ vault, chainRegistry, chainId: req.chainId });
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
        // §17.6 / G023: when `req.signerId` names a paired HW signer
        // (or signerPool has a pre-unlocked software signer for this
        // wallet), pass it through and skip the password-based unlock
        // inside the flow. Without either, the flow falls back to a
        // password unlock as before.
        const signer = await pickSignerFromRequest({
            vault,
            walletId: req?.walletId,
            signerId: req?.signerId,
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
    // Receive screen's "Verify on your device" action calls this; requires
    // the paired HW signer (RemoteSigner) named by req.signerId.
    host.register('receive.verifyAddress', async (req, { vault, chainRegistry, signerPool }) => {
        const signer = await pickSignerFromRequest({
            vault,
            walletId: req?.walletId,
            signerId: req?.signerId,
            signerPool,
        });
        if (!signer) {
            throw new Error('receive.verifyAddress: a paired hardware signer is required');
        }
        return verifyReceiveAddress({
            vault,
            chainId: req?.chainId,
            addressId: req?.addressId,
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
            signerId: req?.signerId,
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

    // Rename an address: set its user-facing label by record id.
    host.register('addresses.setLabel', async (req, { vault }) => {
        const id = req?.id;
        if (!id) throw new Error('addresses.setLabel: id is required');
        const label = typeof req?.label === 'string' ? req.label : '';
        const rec = await vault.addresses.get(id);
        if (!rec) throw new Error('addresses.setLabel: address not found');
        await vault.addresses.put({ ...rec, label });
        // §19.5.2 auto-sync: the label just changed on disk, so the
        // on-chain copy is stale. The scheduler batches this with every
        // other rename in the burst.
        const account = rec.accountId ? await vault.accounts.get(rec.accountId) : null;
        noteLabelChange({ vault }, account?.walletId ?? null);
        return { ok: true };
    });

    // Delete an address record by id (e.g. an imported WIF the user no
    // longer wants surfaced). Derived addresses can be re-derived later.
    host.register('addresses.delete', async (req, { vault }) => {
        const id = req?.id;
        if (!id) throw new Error('addresses.delete: id is required');
        const removed = await vault.addresses.delete(id);
        return { ok: removed };
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
            chainId: req?.chainId,
            addressId: req?.addressId,
        });
    });


    host.register('action.send', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const walletId = req?.walletId;
        return sendToken({
            ...req,
            signer: await sessionSigner(req, vault, signerPool),
            vault,
            chainRegistry,
            sdkRegistry,
            // Cluster G FOLLOWUP 1: auto-enqueue on broadcast failure.
            // The signed hex would otherwise vanish; pushing it onto the
            // queue lets the user retry from the QueuedBroadcastBanner
            // once reachability returns. Await ensureQueueLoaded first
            // so the persisted queue (FOLLOWUP 2) has been rehydrated
            // before this push lands: otherwise a fast Send after a
            // worker restart would race the load and orphan prior items.
            onBroadcastFailure: walletId
                ? async (entry) => { await ensureQueueLoaded(); pushQueueEntry(walletId, entry); }
                : undefined,
        });
    });

    // §20 / G040: watcher-mode helper: encode-only path that returns
    // an unsigned PSBT for transport to a Signer-mode wallet. No vault
    // unlock, no signer, no broadcast. The vault ref is read-only
    // gatedKeys access (PC-26): the send guard needs the pack key to
    // compose a valid gated send; no unlock or signing happens here.
    host.register('action.send.psbt', async (req, { vault, chainRegistry, sdkRegistry }) => {
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
    // tamper-verified ComposedAction; a tamper failure throws and crosses
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
            };
        }

        // Device hardening; the rationale lives on the helper.
        encoderOpts = deviceHardenedEncoderOpts(req, encoderOpts);

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });
        // A caller that named its own change destination is stating where the
        // value must land; a privacy preference does not get to move it. Only
        // the default (change back to the spender) is rotated.
        if (encoderOpts.change === undefined) encoderOpts = { ...encoderOpts, change };

        return composeActionForConfirm({
            vault, chainRegistry, sdkRegistry, chainId, actionData, encoderOpts,
            source: source.address, ownAddresses,
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
        };
        encoderOpts = deviceHardenedEncoderOpts(req, encoderOpts);
        const { change } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });
        if (encoderOpts.change === undefined) encoderOpts = { ...encoderOpts, change };

        return flows.quoteMaxSendable({
            sdkRegistry, chainRegistry, vault, chainId,
            source: source.address, destination, encoderOpts,
        });
    });

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
        const builder = req?.builder;
        // Allow-listed: `builder` crosses the messaging boundary, so it must
        // never be able to name an arbitrary sdk.voting method.
        const VOTE_BUILDERS = ['createPollParams', 'castBallotParams', 'delegateVoteParams', 'clearVoteDelegationParams'];
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

        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData: { action: 'VOTE', params },
            encoderOpts: deviceHardenedEncoderOpts(req, {
                pubkey: source.publicKey,
                change,
                ...(req?.fee !== undefined && { fee: req.fee }),
                ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req?.rbf !== undefined && { rbf: req.rbf }),
            }),
            source: source.address,
            ownAddresses,
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
        return sdk.decoder.describe(
            { action: req.action, version: req.version, params: req.params || {} },
            {
                chainId,
                chainRegistry,
                ...(Array.isArray(req.ownAddresses) && { ownAddresses: req.ownAddresses }),
            },
        );
    });

    // Confirm-session persistence.
    //
    // The store (confirmActionSessionStorage) shipped with slice 1 and its
    // session half had NO production caller for months - only the reservation
    // half was wired - which reads exactly like a shipped feature and is why
    // this item existed. These routes are that caller.
    //
    // What this protects is a popup CLOSE, not a worker eviction: a measured
    // CDP eviction leaves the modal on screen and Approve still signs and
    // broadcasts. MV3 popups close on every focus loss, including the loss a
    // hardware prompt causes, and what dies with them is an UNSIGNED composed
    // PSBT. Nothing money-critical is at stake (signed-but-unbroadcast txs
    // already persist in chrome.storage.local, and reservations in
    // storage.session) - this is a re-entry the user would otherwise redo.
    //
    // The dispatch descriptor is stored as a messaging METHOD NAME, not a
    // closure, because it has to cross the boundary; the name is allow-listed
    // on resume for the same reason `action.vote.composeForConfirm` allow-lists
    // its builder name.
    // `supported` says whether this shell HAS the store, which is not the same
    // answer as "nothing is stored". Without it a caller reads the same empty
    // list from an extension with no pending confirms and from a desktop or web
    // shell that can never hold one (`createConfirmActionSessionStorage`
    // returns null off-extension), so the resume feature reads as present and
    // inert. Additive: a caller that ignores the field behaves as before.
    host.register('action.confirmSession.put', async (req) => {
        if (!confirmSessionStorage) return { supported: false, stored: false };
        const id = req?.id;
        if (typeof id !== 'string' || !id) {
            throw new Error('action.confirmSession.put: id is required');
        }
        await confirmSessionStorage.putSession(id, {
            id,
            request: req.request || null,
            composed: req.composed || null,
            report: req.report || null,
            dispatch: req.dispatch || null,
            createdAt: req.createdAt || null,
        });
        return { supported: true, stored: true };
    });

    host.register('action.confirmSession.list', async () => {
        if (!confirmSessionStorage) return { supported: false, sessions: [] };
        const all = await confirmSessionStorage.loadSessions();
        return { supported: true, sessions: Object.values(all || {}) };
    });

    // Called on EVERY terminal state (approved, rejected, errored). A session
    // that outlives its confirm is not merely litter: resuming it would invite
    // the user to re-approve a transaction that may already be signed and
    // broadcast, which is the double-broadcast trap §5.3.4 forbids. The resume
    // path additionally runs the §4.6 input-liveness re-check, so a stale one
    // interrupts rather than signs - but clearing eagerly is the first line.
    host.register('action.confirmSession.clear', async (req) => {
        if (!confirmSessionStorage) return { supported: false, cleared: false };
        const id = req?.id;
        if (typeof id !== 'string' || !id) {
            throw new Error('action.confirmSession.clear: id is required');
        }
        await confirmSessionStorage.removeSession(id);
        return { supported: true, cleared: true };
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
        return sdk.quoteNativeFee(actionString, { source: req?.source });
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
        return sdk.preflight(req.actionString, {
            source: req.source,
            chain: chainId,
            localDeltas: localDeltas.length ? localDeltas : undefined,
            bypassCache: req.bypassCache === true,
            preflight: req.mode || 'report',
            // Only 'native' and 'xchain' cross this boundary: anything else is
            // dropped rather than forwarded, so a malformed caller cannot make
            // the endpoint reject the whole dry run over a query parameter.
            ...(req.feeMode === 'native' || req.feeMode === 'xchain'
                ? { feeMode: req.feeMode } : {}),
        });
    });

    // §4.6 input liveness: are the coins this PSBT spends still unspent?
    //
    // The other half of the Approve-time re-check, and the one that was never
    // built: only the pre-flight re-run shipped, so a confirm page held open
    // past a competing spend signed a dead PSBT and discovered it at broadcast,
    // in the permanent terminal §5.3.4 forbids re-signing out of. A RESUMED
    // confirm (§5.4) is the same hazard aged deliberately, which is why the
    // resume path gates on this before it will let anyone approve.
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
        let valid = false;
        try {
            valid = Boolean(sdk.auth.verifyMessage(address, message, signature));
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
        const isHd = address.source === 'hd' && typeof address.derivationPath === 'string';
        return signMessageFlow({
            vault,
            walletId,
            password,
            signer,
            bip39Passphrase: req?.bip39Passphrase,
            chainRegistry,
            sdkRegistry,
            chainId: address.chainId,
            path: isHd ? address.derivationPath : undefined,
            addressId: isHd ? undefined : addressId,
            message,
        });
    });

    // §49.5 / G154: queued broadcast surface. v0.170.0 shipped the UI
    // + messaging + in-memory queue; v0.292.0 auto-enqueue from broadcast
    // failure (Cluster G FOLLOWUP 1); v0.293.0 persistence across reload
    // (Cluster G FOLLOWUP 2). The in-memory map remains the live source
    // of truth for the running process; storage rehydrates at first
    // queue access and writes back on every mutation.
    /** @type {Map<string, Array<{ id: string, chainId: string, signedTxHex: string, summary: string, signedAt: number, txid?: string }>>} */
    const queuedBroadcasts = new Map();
    let queueLoaded = false;
    let queueLoadPromise = /** @type {Promise<void> | null} */ (null);
    async function ensureQueueLoaded() {
        if (queueLoaded || !broadcastQueueStorage) {
            queueLoaded = true;
            return;
        }
        if (!queueLoadPromise) {
            queueLoadPromise = (async () => {
                try {
                    const snapshot = await broadcastQueueStorage.load();
                    for (const walletId of Object.keys(snapshot || {})) {
                        const arr = snapshot[walletId];
                        if (Array.isArray(arr) && arr.length > 0) {
                            queuedBroadcasts.set(walletId, [...arr]);
                        }
                    }
                } catch (_e) {
                    // Tolerate storage failures: start fresh in-memory.
                } finally {
                    queueLoaded = true;
                }
            })();
        }
        await queueLoadPromise;
    }
    async function persistQueue() {
        if (!broadcastQueueStorage) return;
        /** @type {Record<string, any[]>} */
        const snapshot = {};
        for (const [walletId, entries] of queuedBroadcasts.entries()) {
            if (entries.length > 0) snapshot[walletId] = [...entries];
        }
        try {
            await broadcastQueueStorage.save(snapshot);
        } catch (_e) {
            // Same tolerance as load: never block a queue mutation on
            // a storage failure.
        }
    }
    function getQueue(walletId) {
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('broadcast.queue: walletId is required');
        }
        let q = queuedBroadcasts.get(walletId);
        if (!q) {
            q = [];
            queuedBroadcasts.set(walletId, q);
        }
        return q;
    }
    // Kick off the storage rehydrate eagerly. The first
    // `broadcast.queue.*` request will await `ensureQueueLoaded` anyway,
    // but starting the load at host construction means the queue is
    // typically warm by the time the renderer mounts the banner.
    void ensureQueueLoaded();
    /**
     * Push a signed-but-unbroadcast tx onto the per-walletId queue.
     * Cluster G FOLLOWUP 1: used both by the action.* handlers' auto-
     * enqueue path (when `submitAction` reports a `BroadcastFailedError`)
     * and by the renderer's `enqueueBroadcastRequest` shim for callers
     * that want to enqueue directly (e.g. PsbtSignForm's broadcast leg).
     *
     * @param {string} walletId
     * @param {{ chainId: string, signedTxHex: string, summary?: string, signedAt?: number, txid?: string }} entry
     * @returns {{ id: string, chainId: string, signedTxHex: string, summary: string, signedAt: number, txid?: string }}
     */
    function pushQueueEntry(walletId, entry) {
        const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const stored = {
            id,
            chainId: entry.chainId,
            signedTxHex: entry.signedTxHex,
            summary: typeof entry.summary === 'string' && entry.summary
                ? entry.summary
                : `Broadcast pending on ${entry.chainId}`,
            signedAt: typeof entry.signedAt === 'number' ? entry.signedAt : Date.now(),
            ...(entry.txid ? { txid: entry.txid } : {}),
        };
        getQueue(walletId).push(stored);
        // Fire-and-forget: onBroadcastFailure callers (action.send /
        // registerHwHandler) intentionally don't await pushQueueEntry,
        // so we can't make it a Promise. The persist runs in the
        // background; load + restart guarantees consistency on next boot.
        void persistQueue();
        return stored;
    }
    host.register('broadcast.queue.list', async (req) => {
        await ensureQueueLoaded();
        return [...getQueue(req?.walletId)];
    });
    // Cluster G FOLLOWUP 1: explicit enqueue endpoint. Renderer-side
    // callers (e.g. PsbtSignForm, future RBF replace lanes) can park a
    // signed hex on the queue without going through the action.* path.
    host.register('broadcast.queue.enqueue', async (req) => {
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
        return pushQueueEntry(walletId, {
            chainId,
            signedTxHex,
            summary: req?.summary,
            signedAt: req?.signedAt,
            txid: req?.txid,
        });
    });
    host.register('broadcast.queue.broadcast', async (req, { sdkRegistry }) => {
        await ensureQueueLoaded();
        const q = getQueue(req?.walletId);
        const id = req?.id;
        const idx = q.findIndex((entry) => entry.id === id);
        if (idx < 0) throw new Error(`broadcast.queue: no queued entry "${id}"`);
        const entry = q[idx];
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
        let result;
        try {
            result = await sdk.encoder.broadcastTx(entry.signedTxHex);
        } catch (err) {
            // The same permanence split the core queue applies,
            // applied here too - this queue retries on demand and had no way to
            // stop. A signed transaction whose inputs are gone can never
            // confirm, so leaving it on the list invites the user to press
            // "Broadcast now" forever on something already dead. Drop it from
            // the queue and say why; the recovery is a fresh compose, not
            // another attempt at these bytes. Transient failures stay queued,
            // which is what the surface is for.
            if (flows.classifyBroadcastFailure(err) === 'permanent') {
                q.splice(idx, 1);
                await persistQueue();
            }
            throw err;
        }
        q.splice(idx, 1);
        await persistQueue();
        // Encoder result shape varies by chain, same as `broadcast.signedTx`
        // below: normalize so the caller always sees { txid }.
        const txid = typeof result === 'string' ? result : (result?.txid ?? result?.tx_hash ?? null);
        return { ...(result && typeof result === 'object' ? result : {}), txid };
    });
    host.register('broadcast.queue.discard', async (req) => {
        await ensureQueueLoaded();
        const q = getQueue(req?.walletId);
        const idx = q.findIndex((entry) => entry.id === req?.id);
        if (idx >= 0) q.splice(idx, 1);
        await persistQueue();
        return { discarded: idx >= 0 };
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
    // §20 / G040 FOLLOWUP 1: broadcast a signed transaction (extracted
    // from a signed PSBT by the renderer-side `auth.signPsbt` flow). No
    // vault required; this is purely an SDK encoder call. The PsbtSignForm
    // result page wires this so a Full-mode wallet can broadcast PSBTs
    // round-tripped from a Watcher / Signer pair without the user having
    // to copy-paste the txHex out to a block explorer.
    host.register('broadcast.signedTx', async (req, { sdkRegistry, vault, chainRegistry }) => {
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

        // Audit invariant (matches the submitAction path, §11.3.8): persist a
        // PendingTx record BEFORE the irreversible broadcast so a spend through
        // this route always leaves a local trace in history / the tx-status
        // timeline, and fail closed if it cannot be recorded (an unauditable
        // irreversible effector must not fire). We only have chainId + txHex
        // here, so fromAddress/toAddress are recorded as unknown; the descriptor
        // supplies coin/network and the record is transitioned to broadcast /
        // failed once the SDK returns.
        if (!vault) {
            throw new Error('broadcast.signedTx: vault is required to record the broadcast');
        }
        const descriptor = chainRegistry?.get?.(chainId);
        if (!descriptor) {
            throw new Error(`broadcast.signedTx: no registered chain descriptor for "${chainId}"`);
        }
        let pending = schemas.createPendingTx({
            chain: descriptor.coin,
            network: descriptor.networkKind,
            fromAddress: 'unknown',
            toAddress: 'unknown',
            action: 'BROADCAST_SIGNED_TX',
            actionSummary: 'Raw signed transaction broadcast via broadcast.signedTx',
            psbtHex: '',
        });
        pending = { ...pending, status: 'broadcasting', txHex };
        await vault.pendingTxs.put(pending);

        let result;
        try {
            result = await sdk.encoder.broadcastTx(txHex);
        } catch (err) {
            const msg = err && err.message ? String(err.message) : String(err);
            await vault.pendingTxs.put({ ...pending, status: 'failed', error: msg });
            throw err;
        }
        // Encoder result shape varies by chain (some return { txid }, some
        // return the txid string directly). Normalize so the caller always
        // sees { txid }.
        const txid = typeof result === 'string'
            ? result
            : (result?.txid ?? result?.tx_hash ?? null);
        if (typeof txid !== 'string' || !txid) {
            await vault.pendingTxs.put({ ...pending, status: 'failed', error: 'SDK did not return a txid' });
            throw new Error('broadcast.signedTx: SDK did not return a txid');
        }
        await vault.pendingTxs.put({
            ...pending,
            status: 'broadcast',
            broadcastAt: new Date().toISOString(),
            txid,
        });
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
        const password = req?.password;
        const psbtHex = req?.psbtHex;
        if (typeof walletId !== 'string' || !walletId) {
            throw new Error('auth.signPsbt: walletId is required');
        }
        if (typeof addressId !== 'string' || !addressId) {
            throw new Error('auth.signPsbt: addressId is required');
        }
        // Unlocked session → pooled signer (no password). Locked / restart
        // without rehydration → fall back to the supplied password.
        const signer = await sessionSigner(req, vault, signerPool);
        if (!signer && (typeof password !== 'string' || password.length === 0)) {
            throw new Error('auth.signPsbt: password is required');
        }
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('auth.signPsbt: psbtHex is required');
        }
        const address = await vault.addresses.get(addressId);
        if (!address) {
            throw new Error(`auth.signPsbt: address "${addressId}" not found`);
        }
        const chainId = address.chainId;
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.wallet?.decomposePsbt !== 'function') {
            throw new Error(`auth.signPsbt: SDK for "${chainId}" lacks wallet.decomposePsbt`);
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
        if (!address) {
            throw new Error(`auth.signPsbt.hw: address "${addressId}" not found`);
        }
        const descriptor = await resolveSigner({ vault, address });
        if (descriptor.kind !== 'trezor' && descriptor.kind !== 'ledger') {
            throw new Error('auth.signPsbt.hw: source address is not a hardware wallet');
        }
        const transport = signerBridge.getTransport(descriptor.signerRecord.id);
        if (!transport) {
            throw new Error(
                'Hardware signer is not connected. Open the wallet UI, re-pair if needed, and try again.',
            );
        }
        const signer = buildRemoteSigner(descriptor, transport);
        const chainId = address.chainId;
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
        // All-or-refuse, before the device is engaged (backstop:
        // Signer.js#assertFullInputCoverage).
        if (signingPaths.length !== decomposed.inputs.length) {
            throw new Error(
                `auth.signPsbt.hw: a hardware signer signs every input or none, so it cannot partially sign this PSBT (${address.address} owns ${signingPaths.length} of ${decomposed.inputs.length} inputs). Use a software wallet key for co-signed PSBTs.`,
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
            const address = await loadAddressForHwSigning(vault, req);
            const descriptor = await resolveSigner({ vault, address });
            if (descriptor.kind !== 'trezor' && descriptor.kind !== 'ledger') {
                throw new Error(`${type}: source address is not a hardware wallet`);
            }
            const transport = signerBridge.getTransport(descriptor.signerRecord.id);
            if (!transport) {
                throw new Error(
                    'Hardware signer is not connected. Open the wallet UI, re-pair if needed, and try again.',
                );
            }
            const signer = buildRemoteSigner(descriptor, transport);
            const { password: _password, ...rest } = req;
            // Cluster G FOLLOWUP 1: auto-enqueue on broadcast failure
            // for HW lanes too. Same shape as the action.send path;
            // ensureQueueLoaded keeps the persisted queue intact.
            const walletId = req?.walletId;
            const onBroadcastFailure = walletId
                ? async (entry) => { await ensureQueueLoaded(); pushQueueEntry(walletId, entry); }
                : undefined;
            // reservationLedger rides along for flows with post-broadcast
            // cleanup (sweepToken's PC-34 force-close leg); other flows
            // ignore the extra option.
            return flow({ ...rest, ...deps, reservationLedger, signer, onBroadcastFailure });
        });
    }

    registerHwHandler('action.send.hw', sendToken);
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
    registerHwHandler('action.createList.hw', createList);
    registerHwHandler('action.airdrop.hw', airdropAction);
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
    registerHwHandler('action.clearVoteDelegation.hw', clearVoteDelegationAction);
    registerHwHandler('action.contractStake.hw', contractStakeAction);

    // Signer status probe: routes straight through the signer bridge
    // without touching vault/SDK. Returns `'idle'` when the bridge
    // isn't connected yet (renderer hasn't registered), giving the
    // UI a distinct state vs. the signer actively reporting
    // 'disconnected'.
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
                payload: { signerId, chainId: req?.chainId },
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
        return sweepToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry, reservationLedger });
    });

    // PC-34: API-derived indicative preview of what a SWEEP would move
    // (balances / ownerships / open offers + escrow / gated ticks).
    host.register('sweep.preview', async (req, { sdkRegistry }) => {
        return sweepPreview({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    host.register('action.issue', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return issueToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.mint', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return mintToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.destroy', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return destroyToken({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-03: CALLBACK force-recall (owner-only, after CALLBACK_BLOCK).
    host.register('action.callback', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return callbackAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return sleepAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-05: current pause state of a tick or address (latest SLEEP row).
    host.register('sleep.state', async (req, { sdkRegistry }) => {
        return sleepStateFor({ sdkRegistry, chainId: req.chainId, query: req.query, type: req.type });
    });

    host.register('action.broadcast', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return broadcastAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-30: publish a PRICE v1 user oracle quote.
    host.register('action.oraclePrice', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return oraclePriceAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return addressPreferencesAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-32: the address's current effective preferences (consensus fold of
    // its valid ADDRESS v0 history; defaults when none).
    host.register('address.preferences', async (req, { sdkRegistry }) => {
        return currentAddressPreferences({ sdkRegistry, chainId: req.chainId, address: req.address });
    });

    host.register('action.dispenser', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return dispenserAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // §41.3.4 ORDER / §41.3.5 CANCEL: DEX signing lanes.
    host.register('action.order', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return orderAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });
    host.register('action.cancelOrder', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return cancelOrder({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });
    // §41.3.5 ORDER v2 edit (EXPIRATION / ALLOW_LIST / BLOCK_LIST).
    host.register('action.editOrder', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return editOrder({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // §41.4 COINPAY: buyer-side settlement for token/native-coin matches.
    host.register('action.coinpay', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return coinpayAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return swapAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // §42.8.1 LINK: anchor two existing actions across chains.
    host.register('action.link', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return linkAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // FILE: public on-chain file upload (NFT artwork attachment;
    // the AttachContentForm pairs it with an owner-validated LINK).
    host.register('action.file', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return fileAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return getMessagingInboxSweep({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // Token-gated content: list and unlock.
    // See xchain-documentation/protocol/TOKEN_GATED_CONTENT.md.
    host.register('gatedContent.list', async (req, { sdkRegistry }) => {
        const sdk = sdkRegistry.get(req.chainId);
        return listGatedFiles({ sdk, tick: req.tick });
    });

    // PC-25 gated publish: atomic BATCH(FILE, MESSAGE-to-self). The
    // encode-only variant backs watcher mode; composition is shared so
    // the two paths cannot drift (flows/gatedPublishAction.js).
    host.register('action.gatedPublish', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return gatedPublishAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return messageAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        const built = await buildMessageParams({
            ...req,
            signer: await sessionSigner(req, vault, signerPool),
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

        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            // The tx is funded, signed and broadcast on the DELIVERY chain,
            // which is not necessarily the recipient's chain (that one only
            // sets COIN and resolves their key).
            chainId: broadcastChainId,
            actionData: { action: 'MESSAGE', params },
            encoderOpts: deviceHardenedEncoderOpts(req, {
                pubkey: source.publicKey,
                change,
                ...(req?.fee !== undefined && { fee: req.fee }),
                ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req?.rbf !== undefined && { rbf: req.rbf }),
            }),
            source: source.address,
            ownAddresses,
        });
        return { ...composed, messageParams: params };
    });
    host.register('messaging.handshake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return handshakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return deployAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.execute', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return executeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.deposit', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return depositAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.withdraw', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return withdrawAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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
        return stakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.unstake', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return unstakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.collect', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return collectAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.delegate', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return delegateAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.revokeDelegation', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return revokeDelegationAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // VOTE governance authoring (v0 create poll, v1 cast ballot, v3 delegate / clear).
    // Software-signed passthroughs; the .hw twins are registered via registerHwHandler above.
    host.register('action.createPoll', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return createPollAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.castBallot', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return castBallotAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.delegateVote', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return delegateVoteAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.clearVoteDelegation', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return clearVoteDelegationAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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

    // BET writes. One action name over four formats, so each gets its own route
    // rather than a single route taking a version from the caller: a resolve and
    // a place-bet differ on the wire only by AMOUNT, and the messaging boundary
    // is not a place to let that distinction be inferred.
    host.register('action.createMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return createMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.placeBet', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return placeBetAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.resolveMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return resolveMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.cancelMarket', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return cancelMarketAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // Compose a BET through the SDK's own builder HOST-side, so the confirm page
    // decodes what the host actually composed rather than a client-side wire
    // mirror (the rule the vote route already follows).
    host.register('action.bet.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        const chainId = req?.chainId;
        if (typeof chainId !== 'string' || !chainId) {
            throw new Error('action.bet.composeForConfirm: chainId is required');
        }
        const builder = req?.builder;
        // Allow-listed: `builder` crosses the messaging boundary, so it must
        // never be able to name an arbitrary sdk.betting method.
        const BET_BUILDERS = ['createMarketParams', 'placeBetParams', 'resolveMarketParams', 'cancelMarketParams'];
        if (!BET_BUILDERS.includes(builder)) {
            throw new Error(`action.bet.composeForConfirm: unknown builder "${builder}"`);
        }
        const sdk = sdkRegistry.get(chainId);
        if (typeof sdk?.betting?.[builder] !== 'function') {
            throw new Error(`action.bet.composeForConfirm: sdk.betting.${builder} is unavailable`);
        }
        const source = normalizeSource(req?.from, 'action.bet.composeForConfirm');
        // Throws on bad input BEFORE the confirm page opens.
        const params = sdk.betting[builder](req?.params);

        const { change, ownAddresses } = await confirmChangeAndOwnAddresses({
            req, vault, chainRegistry, signerPool, chainId, sourceAddress: source.address,
        });

        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData: { action: 'BET', params },
            encoderOpts: deviceHardenedEncoderOpts(req, {
                pubkey: source.publicKey,
                change,
                ...(req?.fee !== undefined && { fee: req.fee }),
                ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req?.rbf !== undefined && { rbf: req.rbf }),
                // The native-coin fee mode has to reach COMPOSE, not just
                // submit, so the FEE_DESTINATION output sits inside the PSBT the
                // user approves and is covered by the tamper check. BET is
                // fee-bearing on create (v0) and place (v2), and on LTC/DOGE a
                // native output is the ONLY way to pay it.
                ...(req?.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: req.payFeeInNativeCoin }),
            }),
            source: source.address,
            ownAddresses,
        });
        // The built wire params ride back so the confirm page decodes its intent
        // from what the HOST composed, not from the editor state.
        return { ...composed, betParams: params };
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
        return contractStakeAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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

    host.register('multisigSign.contributeSignature', async (req, { vault }) => {
        return contributeMultisigSignature({ ...req, vault });
    });

    host.register('multisigSign.aggregate', async (req, { vault, sdkRegistry }) => {
        return aggregateMultisigSession({ ...req, vault, sdkRegistry });
    });

    host.register('multisigSign.finalize', async (req, { vault }) => {
        return finalizeMultisigSigningSession({ ...req, vault });
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
            waitForTxid: (txid, o) => sdk.waitForAction(txid, o),
        });
    });

    host.register('pendingDeploys.listForWallet', async (req, { vault }) => {
        return listPendingDeploysForWallet({ ...req, vault });
    });

    host.register('pendingDeploys.clear', async (req, { vault }) => {
        return clearPendingDeploy({ ...req, vault });
    });

    host.register('contracts.checkCodeSize', async (req, { sdkRegistry }) => {
        return contractCheckCodeSize({ ...req, sdkRegistry });
    });

    host.register('contracts.suggestGasLimit', async (req, { sdkRegistry }) => {
        return contractSuggestGasLimit({ ...req, sdkRegistry });
    });

    host.register('action.dividend', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return dividendAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('holders.forTick', async (req, { sdkRegistry }) => {
        return holdersFor({ ...req, sdkRegistry });
    });

    // §40.9 AIRDROP two-transaction flow: LIST create + AIRDROP
    // reference, plus the two read-only passthroughs AirdropForm uses
    // to (a) resolve the LIST's ACTION_INDEX after it's indexed and
    // (b) confirm the LIST on the AIRDROP review screen.

    host.register('action.createList', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return createList({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('action.airdrop', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return airdropAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    host.register('actions.byTxid', async (req, { sdkRegistry }) => {
        return actionByTxid({ ...req, sdkRegistry });
    });

    host.register('lists.byActionIndex', async (req, { sdkRegistry }) => {
        return listByActionIndex({ ...req, sdkRegistry });
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

    // §40.10 Advanced Actions Form: generic "submit any action"
    // surface. Read-only SDK introspection handlers drive the form's
    // schema-based field list and live validation. The write path
    // accepts any (action, params) pair and forwards to submitAction,
    // which runs the SDK's validator before signing.

    host.register('action.advanced', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return advancedAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });

    // PC-36: assemble a BATCH's COMMAND string from queued sub-actions (read-
    // only compose; no signing). The composer previews this, then signs the
    // BATCH via the generic action.advanced path with { action:'BATCH', params:{ COMMAND } }.
    host.register('batch.buildCommand', async (req, { sdkRegistry }) => {
        return buildBatchCommand({ ...req, sdkRegistry });
    });

    host.register('sdk.listActions', async (req, { sdkRegistry }) => {
        return listActions({ ...req, sdkRegistry });
    });

    host.register('sdk.getActionFormats', async (req, { sdkRegistry }) => {
        return getActionFormats({ ...req, sdkRegistry });
    });

    host.register('sdk.getActionFields', async (req, { sdkRegistry }) => {
        return getActionFields({ ...req, sdkRegistry });
    });

    host.register('sdk.validateAction', async (req, { sdkRegistry }) => {
        return validateActionDryRun({ ...req, sdkRegistry });
    });


    host.register('signer.register', async (req, { vault }) => {
        return registerSigner({ ...req, vault });
    });

    host.register('signer.list', async (req, { vault }) => {
        const walletId = /** @type {any} */ (req)?.walletId;
        if (typeof walletId !== 'string' || walletId.length === 0) {
            throw new Error('signer.list: walletId is required');
        }
        return listSignersForWallet(vault, walletId);
    });

    host.register('signer.unregister', async (req, { vault }) => {
        const signerId = /** @type {any} */ (req)?.signerId;
        if (typeof signerId !== 'string' || signerId.length === 0) {
            throw new Error('signer.unregister: signerId is required');
        }
        return { deleted: await unregisterSigner(vault, signerId) };
    });


    host.register('wallet.exportPrivateKey', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return exportPrivateKey({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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

    host.register('balances.address', async (req, { sdkRegistry, chainRegistry }) => {
        return addressBalances({ ...req, sdkRegistry, chainRegistry });
    });

    host.register('history.address', async (req, { sdkRegistry }) => {
        return addressHistory({ ...req, sdkRegistry });
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
    host.register('pendingTxs.forAddress', async (req, { vault, chainRegistry }) => {
        return livePendingTxs({ ...req, vault, chainRegistry });
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

    registerBridgeHandlers(host, { approvals, events: bridgeEvents, signThrottle, getAssetUrl });

    // PC-16: the auto-pay engine runs shell-side (next to the other
    // watchers) but must place its funds holds in THIS host's ledger so
    // they share one netting domain with the confirm-surface
    // reservations. Exposed as a property, not a handler: the ledger
    // never crosses a message boundary.
    host.reservationLedger = reservationLedger;

    return host;
}

