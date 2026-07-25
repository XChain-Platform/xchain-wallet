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

const {
    createWallet,
    createAccount,
    activateChain,
    renameWallet,
    renameAccount,
    importMnemonic,
    unlockWallet,
    receiveAddress,
    ensureNetworkAddresses,
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
    broadcastAction,
    dispenserAction,
    orderAction,
    cancelOrder,
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
    swapsForToken,
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
    if (accountIds.size === 0) return {};
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
        if (!a.accountId || !accountIds.has(a.accountId)) continue;
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
    const type = addressType ?? descriptor.defaultAddressType;

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

    //  §4.7: ONE reservation ledger per host, shared across every
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


    host.register('wallet.list', async (_req, { vault }) => {
        const wallets = await vault.wallets.list();
        return wallets.map(toSafeWallet);
    });

    host.register('wallet.exists', async (req, { vault }) => {
        const id = req?.walletId;
        if (typeof id !== 'string' || !id) return { exists: false };
        return { exists: (await vault.wallets.get(id)) !== null };
    });

    host.register('wallet.create', async (req, { vault, chainRegistry, sdkRegistry }) => {
        const r = await createWallet({ ...req, vault, chainRegistry, sdkRegistry });
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
        const activeChainIds = Array.isArray(req?.activeChainIds) && req.activeChainIds.length > 0
            ? req.activeChainIds
            : DEFAULT_ACTIVE_CHAIN_IDS;
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
        const activeChainIds = Array.isArray(req?.activeChainIds) && req.activeChainIds.length > 0
            ? req.activeChainIds
            : DEFAULT_ACTIVE_CHAIN_IDS;
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


    host.register('settings.get', async (_req, { vault, chainRegistry }) => {
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
        return getSettings(vault);
    });

    // : switch the active network AND make sure the wallet actually has
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
        const settings = await updateSettings(vault, { activeNetwork: network });

        let addresses = { created: [], existing: [], failed: [], skipped: 'no-wallet' };
        const walletId = req?.walletId;
        if (typeof walletId === 'string' && walletId.length > 0) {
            const signer = await pickSignerFromRequest({
                vault, walletId, signerId: req?.signerId, signerPool,
            }).catch(() => null);
            addresses = await ensureNetworkAddresses({
                vault, chainRegistry, sdkRegistry, walletId, network, signer: signer || undefined,
            });
        }
        return { settings, addresses };
    });

    host.register('settings.update', async (req, { vault }) => {
        const patch = req && typeof req === 'object' && 'patch' in req
            ? /** @type {Record<string, unknown>} */ (req.patch)
            : /** @type {Record<string, unknown>} */ (req ?? {});
        const result = await updateSettings(vault, patch);
        // Cluster S FOLLOWUP 1: refresh the sign-throttle limit cache
        // when the patch touches signThrottle so users see the change
        // take effect on the very next sign request.
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'signThrottle')) {
            throttleVault = vault;
            await refreshThrottleLimitsFromVault();
        }
        return result;
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
        return publishLabelsNow({
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
            onConflict: req?.onConflict,
            mode: req?.mode,
        });
        return {
            walletId: r.walletId,
            writes: r.writes,
            skipped: r.skipped,
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
            onConflict: req?.onConflict,
            mode: req?.mode,
            resolveBackupContent: resolveBackupPointerContent,
        });
        return {
            walletId: r.walletId,
            writes: r.writes,
            skipped: r.skipped,
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

    //  §5.3: the HOST half of the single-encode pipeline. Compose the
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
    host.register('action.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry }) => {
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
            if (!req?.to) throw new Error('action.composeForConfirm: to is required');
            if (!req?.tick) throw new Error('action.composeForConfirm: tick is required');
            if (req?.amount === undefined || req?.amount === null || req?.amount === '') {
                throw new Error('action.composeForConfirm: amount is required');
            }
            /** @type {Record<string, string>} */
            const params = { TICK: req.tick, AMOUNT: String(req.amount), DESTINATION: req.to };
            if (req.memo !== undefined) params.MEMO = req.memo;
            actionData = { action: 'SEND', params };
            // PC-26: a gated tick's SEND composes as BATCH(SEND, MESSAGE)
            // HERE, at the single-encode step, so the PSBT the modal
            // previews IS the guarded one and Approve signs it
            // byte-identically (sendToken skips its own guard on the
            // prebuilt path). Typed guard errors reject the confirm()
            // promise unwrapped, like any compose failure.
            const gatedPlan = await prepareGatedSend({
                sdkRegistry, chainRegistry, vault,
                walletId: req.walletId,
                chainId, source,
                to: req.to, tick: req.tick, amount: req.amount, memo: req.memo,
            });
            if (gatedPlan) actionData = gatedPlan.actionData;
            encoderOpts = {
                pubkey: source.publicKey,
                ...(req.fee !== undefined && { fee: req.fee }),
                ...(req.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req.rbf !== undefined && { rbf: req.rbf }),
            };
        }

        // Own addresses on this chain: change back to any of them is not a
        // tamper. Best-effort - the source address is always added by the
        // flow, so a resolve failure only loosens change detection to that.
        let ownAddresses = [source.address];
        try {
            const byChain = await addressesByChain(req, { vault, chainRegistry });
            const rows = byChain?.[chainId] || [];
            ownAddresses = rows.map((r) => r.address).filter(Boolean);
            if (!ownAddresses.includes(source.address)) ownAddresses.push(source.address);
        } catch {
            // fall through to [source.address]
        }

        return composeActionForConfirm({
            vault, chainRegistry, sdkRegistry, chainId, actionData, encoderOpts,
            source: source.address, ownAddresses,
        });
    });

    // : VOTE's wire params are built by sdk.voting.*Params, which lives
    // HERE, not in the renderer. The three VOTE forms each kept a hand-written
    // client-side mirror of that encoding to feed the generic compose route -
    // and a mirror that drifts is signed, not caught: the tamper check
    // verifies the PSBT against the params the encoder was handed, so a wrong
    // mirror produces a self-consistent PSBT for the WRONG ballot, and
    // castBallotAction's own builder never runs because `prebuiltPsbt`
    // short-circuits it. Composing through the real builder removes the mirror
    // (spec §1: the SDK owns the logic, the wallet owns the glass).
    //
    // No vault unlock and no signer: the builders are pure shape validation.
    host.register('action.vote.composeForConfirm', async (req, { vault, chainRegistry, sdkRegistry }) => {
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

        let ownAddresses = [source.address];
        try {
            const byChain = await addressesByChain(req, { vault, chainRegistry });
            const rows = byChain?.[chainId] || [];
            ownAddresses = rows.map((r) => r.address).filter(Boolean);
            if (!ownAddresses.includes(source.address)) ownAddresses.push(source.address);
        } catch {
            // fall through to [source.address]
        }

        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData: { action: 'VOTE', params },
            encoderOpts: {
                pubkey: source.publicKey,
                ...(req?.fee !== undefined && { fee: req.fee }),
                ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req?.rbf !== undefined && { rbf: req.rbf }),
            },
            source: source.address,
            ownAddresses,
        });
        // The built wire params ride back so the confirm page decodes its
        // intent from what the HOST composed, not from the editor state
        // (same shape as `messageParams` on the MESSAGE route).
        return { ...composed, voteParams: params };
    });

    //  §4: run sdk.preflight HOST-side (the SDK, its explorer endpoint,
    // and Tier-2 state all live here) and return the serializable report. The
    // popup's AbortController cannot cross the boundary; a superseded report
    // is simply ignored by the hook once it resolves. `bypassCache` powers
    // the Approve-time staleness re-check (§4.6).
    host.register('action.preflight', async (req, { sdkRegistry }) => {
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
        const localDeltas = [...callerDeltas, ...reserved];
        return sdk.preflight(req.actionString, {
            source: req.source,
            chain: chainId,
            localDeltas: localDeltas.length ? localDeltas : undefined,
            bypassCache: req.bypassCache === true,
            preflight: req.mode || 'report',
        });
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
        if (typeof sdk?.wallet?.broadcastTx !== 'function') {
            throw new Error(`broadcast.queue: SDK for "${entry.chainId}" lacks wallet.broadcastTx`);
        }
        // Panic-mode freeze. Broadcasting an already-signed tx invokes no signer,
        // so without this it sails straight through an active freeze - the exact
        // irreversible-effector gap the freeze exists to close. This host route
        // maintains its own queue and bypasses core drainQueuedBroadcast (which
        // already gates), so the same assertion is applied here at the new call site.
        flows.assertSigningAllowed();
        const result = await sdk.wallet.broadcastTx(entry.signedTxHex);
        q.splice(idx, 1);
        await persistQueue();
        return result;
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

        //  §5.5: also decode the XChain action carried inside, so the
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
    registerHwHandler('action.broadcast.hw', broadcastAction);
    registerHwHandler('action.dispenser.hw', dispenserAction);
    registerHwHandler('action.dividend.hw', dividendAction);
    registerHwHandler('action.createList.hw', createList);
    registerHwHandler('action.airdrop.hw', airdropAction);
    registerHwHandler('action.advanced.hw', advancedAction);
    registerHwHandler('action.order.hw', orderAction);
    registerHwHandler('action.cancelOrder.hw', cancelOrder);
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

    host.register('action.broadcast', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return broadcastAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
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

    // §41.4 COINPAY: buyer-side settlement for token/native-coin matches.
    host.register('action.coinpay', async (req, { vault, chainRegistry, sdkRegistry, signerPool }) => {
        return coinpayAction({ ...req, signer: await sessionSigner(req, vault, signerPool), vault, chainRegistry, sdkRegistry });
    });
    // : encode-only COINPAY for §20 watcher mode. A dedicated route rather
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

    //  §5.6 slice 3: compose-for-confirm for MESSAGE. MESSAGE is the one
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

        let ownAddresses = [source.address];
        try {
            const byChain = await addressesByChain(req, { vault, chainRegistry });
            const rows = byChain?.[broadcastChainId] || [];
            ownAddresses = rows.map((r) => r.address).filter(Boolean);
            if (!ownAddresses.includes(source.address)) ownAddresses.push(source.address);
        } catch {
            // fall through to [source.address]
        }

        const composed = await composeActionForConfirm({
            vault,
            chainRegistry,
            sdkRegistry,
            // The tx is funded, signed and broadcast on the DELIVERY chain,
            // which is not necessarily the recipient's chain (that one only
            // sets COIN and resolves their key).
            chainId: broadcastChainId,
            actionData: { action: 'MESSAGE', params },
            encoderOpts: {
                pubkey: source.publicKey,
                ...(req?.fee !== undefined && { fee: req.fee }),
                ...(req?.feePerKb !== undefined && { feePerKb: req.feePerKb }),
                ...(req?.rbf !== undefined && { rbf: req.rbf }),
            },
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
        return saveContact({ ...req, vault });
    });
    host.register('contacts.delete', async (req, { vault }) => {
        return deleteContact({ ...req, vault });
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
    host.register('swaps.forToken', async (req, { sdkRegistry }) => {
        return swapsForToken({ ...req, sdkRegistry });
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

    // §28.3 "Indexed" timeline stage: latest block the indexer has
    // processed for a chain. Read-only status probe; the flow degrades to
    // { watermark: null } rather than throwing when the explorer can't
    // report it, so a status outage never breaks the History view.
    host.register('indexer.watermark', async (req, { sdkRegistry }) => {
        return indexerWatermark({ ...req, sdkRegistry });
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

// §15.4 backup-pointer resolver. Turns a pointer's `location` into the
// raw encrypted §19.4 envelope text. Only https locations are fetched:
// a wallet must not silently reach out to an arbitrary http origin, and
// on-chain FILE references need SDK wiring that is deliberately left as a
// follow-up rather than half-implemented here. The envelope is still
// password-encrypted, so fetching it does not by itself expose funds.
async function resolveBackupPointerContent(pointer) {
    const location = pointer?.location;
    if (typeof location !== 'string' || location.trim().length === 0) {
        throw new Error('backup pointer has no location to resolve');
    }
    const loc = location.trim();
    let url;
    try {
        url = new URL(loc);
    } catch {
        throw new Error(`backup pointer location is not a URL: "${loc}". On-chain pointers are not supported yet.`);
    }
    if (url.protocol !== 'https:') {
        throw new Error(`unsupported backup-pointer location scheme "${url.protocol}" (only https is fetched).`);
    }
    if (typeof fetch !== 'function') {
        throw new Error('this shell cannot fetch a backup pointer (no fetch available).');
    }
    const resp = await fetch(url.toString(), { redirect: 'follow' });
    if (!resp.ok) {
        throw new Error(`backup pointer fetch failed: HTTP ${resp.status}`);
    }
    return await resp.text();
}
