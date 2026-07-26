// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export { createWallet } from './createWallet.js';
export { createAccount } from './createAccount.js';
export { activateChain } from './activateChain.js';
export { renameWallet } from './renameWallet.js';
export { renameAccount } from './renameAccount.js';
export {
    unlockWallet,
    unlockWalletRecord,
    withUnlocked,
    withUnlockedRecord,
    WalletNotFoundError,
} from './unlockWallet.js';
export {
    importMnemonic,
    normalizeMnemonic,
    detectMnemonicFormat,
    InvalidMnemonicError,
    UnknownMnemonicFormatError,
} from './importMnemonic.js';
export { submitAction } from './submitAction.js';
export { sendToken, normalizeSource } from './sendToken.js';
export { buildSendPsbt } from './buildSendPsbt.js';
export { composeActionForConfirm } from './composeActionForConfirm.js';
export { createReservationLedger } from './reservationLedger.js';
export { buildActionPsbt } from './buildActionPsbt.js';
export { sweepToken } from './sweepToken.js';
export { sweepPreview } from './sweepPreview.js';
export { issueToken } from './issueToken.js';
export { mintToken } from './mintToken.js';
export { destroyToken } from './destroyToken.js';
export { callbackAction } from './callbackAction.js';
export { tokenHolderSummary, mulFloorDecimal, addDecimal } from './tokenHolders.js';
export { sleepAction } from './sleepAction.js';
export { sleepStateFor, interpretSleep } from './sleepQueries.js';
export { broadcastAction } from './broadcastAction.js';
export {
    buildBatchCommand,
    validateBatchConstraints,
    BATCH_FORBIDDEN_ACTIONS,
    BATCH_SINGLETON_ACTIONS,
} from './batchCommand.js';
export { oraclePriceAction } from './oraclePriceAction.js';
export {
    addressPreferencesAction,
    currentAddressPreferences,
    feePreferenceLabel,
    requireMemoLabel,
    dispenserPreferenceLabel,
    DEFAULT_PREFERENCES,
    VALID_FEE_PREFERENCE,
    VALID_REQUIRE_MEMO,
    VALID_DISPENSER_PREFERENCE,
} from './addressPreferences.js';
export {
    myOracleFeeds,
    oracleConsumers,
    toQuote,
    pairKey,
    quoteDeviationPct,
    activationCountdownText,
    ORACLE_ACTIVATION_DELAY_S,
} from './oracleQueries.js';
export { dispenserAction } from './dispenserAction.js';
export { orderAction, cancelOrder, editOrder } from './orderAction.js';
export {
    isNativeGiveOrder,
    recordAutopayConsent,
    listAutopayOrders,
    setAutopayEnabled,
    autopayExposureBase,
    resolveOrderActionIndexes,
    recordAutopayPayment,
    disableAutopayForAddress,
} from './autopayConsent.js';
export { buildCoinpayPsbtRequest, coinpayAction } from './coinpayAction.js';
export { swapAction } from './swapAction.js';
export { linkAction } from './linkAction.js';
export { fileAction, fileActionParams } from './fileAction.js';
export {
    gatedPublishAction,
    buildGatedPublishPsbtRequest,
    MAX_GATED_PLAINTEXT_BYTES,
} from './gatedPublishAction.js';
export {
    MAX_COMPILED_ACTION_BYTES,
    maxPublicFileBytes,
    maxGatedPlaintextBytes,
    publicFileActionString,
    gatedBatchActionString,
} from './fileSizeLimits.js';
export { getProjectForTick } from './projectQueries.js';
export { getMessagingInbox, getMessagingInboxSweep } from './messagingInbox.js';
export {
    unlockGatedFile,
    unlockGatedPack,
    unlockGatedFileForAddress,
    listGatedFiles,
    scanGatedKeyHandoffs,
    buildKeyHandoffPayload,
    getCachedGatedKey,
    clearGatedContentCaches,
    recoverGatedKeysForTick,
    copyGatedKeysToWallet,
} from './gatedContent.js';
export {
    prepareGatedSend,
    gatedSendReadiness,
    getGatedGroupsForSend,
    resolveGatedSendKeys,
    clearGatedGroupsCache,
    gatedGroupThreshold,
    splitGroupsByThreshold,
    GatedSendKeysMissingError,
    GatedRecipientPubkeyMissingError,
} from './gatedSendGuard.js';
export {
    GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS,
    gateMinAmountScheduledHeight,
    isGateMinAmountActive,
    resolveGateMinAmountActive,
} from './protocolActivations.js';
export {
    messageAction,
    buildMessageParams,
    handshakeAction,
    getRecipientPubkey,
    PubkeyNotFoundError,
    PubkeyMismatchError,
} from './messageAction.js';
export {
    listContacts,
    findContactByAddress,
    saveContact,
    deleteContact,
} from './contacts.js';
export {
    buildRecentDestinations,
    filterSuggestions,
} from './recentDestinations.js';
export { checkRecipientNovelty } from './recipientNovelty.js';
export { classifySignRisk } from './signRiskClassifier.js';
export {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    fetchNativeSendFeeTiers,
    customFeeEstimate,
    perByteRateToDisplay,
    displayRateToPerByte,
    settingsCustomToDisplayRate,
    displayRateToSettingsCustom,
    satsToCoinDecimal,
} from './feeEstimate.js';
export {
    isEntryReplaceable,
    sendRbfRequest,
    replaceFromHistoryEntry,
    RbfNotSupportedError,
    RbfInvalidEntryError,
} from './rbfReplace.js';
export {
    getFiatRate,
    refreshFiatRates,
    subscribeFiatRates,
    configureFiatRateSource,
    coinToFiat,
    fiatToCoin,
} from './priceLookup.js';
export {
    getCoinpayObligationsForAddress,
    getCoinpaysForAddress,
} from './coinpayQueries.js';
export {
    dispensersForSource,
    dispensersForAddress,
    dispensersForToken,
    dispenserByActionIndex,
    dispensesFor,
    dispenserLifecycleFor,
} from './dispenserQueries.js';
export {
    contractsForSource,
    contractsForAddress,
    contractsBrowseAll,
    depositsForAddress,
    withdrawalsForAddress,
} from './contractQueries.js';
export {
    contractByActionIndex,
    actionByIndex,
    contractState,
    contractBalance,
    executionsForContract,
    contractManifestFor,
} from './contractDetail.js';
export { deployAction } from './deployAction.js';
export {
    planChunkedDeploy,
    chunkCarrierParams,
    assembleParams,
    verifyRecordedChunks,
    deployChunkedRun,
    listPendingDeploysForWallet,
    clearPendingDeploy,
} from './deployChunked.js';
export { executeAction } from './executeAction.js';
export { controllerBindParams, controllerActionClasses } from './controllerBind.js';
export { depositAction, withdrawAction } from './contractFundsActions.js';
export {
    stakesForAddress,
    delegationsForAddress,
    rewardsForAddress,
    rewardClaimsForAddress,
    validatorsForChain,
    capabilityThresholds,
    contractStakesForAddress,
    contractUnstakesForAddress,
    slashEventsForAddress,
} from './stakingQueries.js';
export { stakeAction } from './stakeAction.js';
export { contractStakeAction } from './contractStakeAction.js';
export { unstakeAction, collectAction } from './unstakeClaimActions.js';
export { delegateAction, revokeDelegationAction } from './delegateRevokeActions.js';
export {
    createPollAction,
    castBallotAction,
    delegateVoteAction,
    clearVoteDelegationAction,
} from './voteActions.js';
export {
    pollsForChain,
    pollDetail,
    pollResults,
    votesForQuery,
} from './voteQueries.js';
export {
    createMarketAction,
    placeBetAction,
    resolveMarketAction,
    cancelMarketAction,
} from './betActions.js';
export {
    betFeedsForChain,
    betFeedDetail,
    betsForQuery,
    oracleStats,
    projectBetPayout,
    projectBetFeedCreateFee,
} from './betQueries.js';
export { broadcastsForAddress } from './broadcastQueries.js';
export { linksForAddress } from './linkQueries.js';
export {
    tokenInfoFor,
    extractImageUrl,
    normalizeTokenInfo,
    descriptionJsonUrl,
    legacyJsonToTis,
    tisToMediaBundle,
    fetchTisBundle,
} from './tokenInfo.js';
export { searchPlatformTokens } from './searchTokens.js';
export { listOwnedTokens } from './listOwnedTokens.js';
export { createMultisigConfig } from './createMultisigConfig.js';
export { receiveMultisigAddress, listMultisigReceiveAddresses } from './multisigAddress.js';
export {
    startMultisigSigningSession,
    getMultisigSigningSession,
    listMultisigSigningSessions,
    cancelMultisigSigningSession,
    contributeMultisigNonce,
    contributeMultisigSignature,
    aggregateMultisigSession,
    finalizeMultisigSigningSession,
    pendingCosignerPubkeys,
} from './multisigSigning.js';
export { signMultisigLocally } from './multisigSignLocally.js';
export { passiveCoSign } from './passiveCoSign.js';
export { passiveCoSignForAccount, CoSignerAccountNotFoundError } from './passiveCoSignForAccount.js';
export { provisionCoSignerAccount } from './provisionCoSignerAccount.js';
export { previewCoSignRequest } from './previewCoSignRequest.js';
export { listCoSignerAccounts, findCoSignerAccountByAddress, getCoSignerAccount } from './coSignerAccountQueries.js';
export { updateCoSignerAccount, CoSignerAccountNotFoundError as CoSignerAccountUpdateNotFoundError } from './updateCoSignerAccount.js';
export {
    contractValidate,
    contractCheckCodeSize,
    contractSuggestGasLimit,
} from './contractUtilities.js';
export { dividendAction, holdersFor } from './dividendAction.js';
export { createList } from './createList.js';
export { airdropAction } from './airdropAction.js';
export { actionByTxid, listByActionIndex, listsForSource } from './listQueries.js';
export {
    savePendingAirdrop,
    listPendingAirdropsForWallet,
    updatePendingAirdrop,
    clearPendingAirdrop,
} from './pendingAirdrops.js';
export { advancedAction } from './advancedAction.js';
export {
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
} from './marketQueries.js';
export {
    listWatchlistForWallet,
    saveWatchlistEntry,
    clearWatchlistEntry,
} from './watchlist.js';
export {
    listAlertsForWallet,
    saveAlert,
    clearAlert,
    markAlertTriggered,
    rearmAlert,
} from './priceAlerts.js';
export {
    listActions,
    getActionFormats,
    getActionFields,
    validateActionDryRun,
} from './sdkIntrospection.js';
export {
    registerSigner,
    listSignersForWallet,
    unregisterSigner,
    findSigner,
} from './registerSigner.js';
export {
    resolveSigner,
    buildRemoteSigner,
    SignerResolutionError,
} from './resolveSigner.js';
export { seedSettingsForChains, ensureSettings } from './seedSettings.js';
export { getSettings, updateSettings } from './settings.js';
export { removeWallet } from './removeWallet.js';
export { receiveAddress, NoMatchingAccountError } from './receiveAddress.js';
// : derive the first address per chain when the active network changes,
// so switching networks cannot strand a wallet with no addresses.
export { ensureNetworkAddresses } from './ensureNetworkAddresses.js';
export { unconfirmedPendingDeltas } from './pendingDeltas.js';
export {
    verifyReceiveAddress,
    HardwareAddressMismatchError,
    NotHardwareAddressError,
} from './verifyReceiveAddress.js';
export { dispenserAddress } from './dispenserAddress.js';
export { resolveActiveAddresses, setActiveAddress } from './activeAddress.js';
export { isBindingPoll, bindingPollErrors, CALLBACK_ON_VALUES } from './bindingPoll.js';
export { unclaimedRewards, cooldownStatus, cooldownText, toBaseUnits, fromBaseUnits } from './stakingDashboard.js';
export {
    addressBalances,
    addressHistory,
    chainTipBlockTime,
    indexerWatermark,
    walletBalances,
} from './balances.js';
export {
    verifyAddressBalance,
    verifyAddressAction,
} from './verifyBalances.js';
export {
    reconcileAddressSigners,
    AmbiguousSignerMatchError,
} from './reconcileAddressSigners.js';
export {
    importWif,
    InvalidWifError,
    WrongPasswordError,
} from './importWif.js';
export { importSingleWif } from './importSingleWif.js';
export {
    exportPrivateKey,
    AddressNotFoundError,
    NoKeyForAddressError,
    ImportedKeyMissingError,
} from './exportPrivateKey.js';
export {
    exportBackupFile,
    importBackupFile,
    restoreFromBackupPointer,
    BackupConflictError,
    BackupPointerUnresolvedError,
    BACKUP_PAYLOAD_VERSION,
} from './backupFile.js';
export { dryRunRestore, DEFAULT_DRY_RUN_GAP } from './dryRunRestore.js';
export {
    buildLabelSyncPayload,
    applyLabelSyncPayload,
    publishLabelsNow,
    NoFundedAddressError,
    WifOnlyLabelSyncUnsupportedError,
    LABEL_SYNC_PAYLOAD_VERSION,
} from './labelSync.js';
export { signMessageFlow, signPsbtFlow } from './signFlows.js';
export { createDemoWallet } from './createDemoWallet.js';
export {
    resolveAdsForNextTx,
    resolveAdsPlanForNextTx,
    stepAdsAccumulator,
    commitAdsStep,
} from './ads.js';
export { checkReachability } from './reachability.js';
export {
    emptyLockoutState,
    delayForAttempts,
    getLockoutState,
    getRemainingMs,
    recordFailure as recordLockoutFailure,
    recordSuccess as recordLockoutSuccess,
    clearLockoutState,
} from './lockoutTracking.js';
export {
    isBiometricSupported,
    isBiometricRegistered,
    clearBiometricCredential,
    registerBiometricCredential,
    unlockWithBiometric,
    BiometricUnsupportedError,
    BiometricNotRegisteredError,
    BiometricPrfUnavailableError,
} from './biometricUnlock.js';
export {
    emptyPanicModeState,
    getPanicModeState,
    getPanicRemainingMs,
    isSigningFrozen,
    activatePanicMode,
    deactivatePanicMode,
    clearPanicModeState,
    assertSigningAllowed,
    configurePanicModePersistence,
    applyExternalPanicModeState,
    PanicModeActiveError,
    DEFAULT_DURATION_MS as PANIC_MODE_DEFAULT_DURATION_MS,
    MIN_DURATION_MS as PANIC_MODE_MIN_DURATION_MS,
    MAX_DURATION_MS as PANIC_MODE_MAX_DURATION_MS,
} from './panicMode.js';
export {
    isDuressConfigured,
    setDuressPassphrase,
    clearDuressPassphrase,
    isDuressMatch,
    tripDuressIfMatch,
    DuressNotConfiguredError,
} from './duressPassphrase.js';
export {
    revealMnemonic,
    NoMnemonicForWifOnlyError,
} from './revealMnemonic.js';
export {
    enqueueSignedTx,
    listQueuedBroadcasts,
    drainQueuedBroadcast,
    discardQueuedBroadcast,
    NoQueuedTxError,
} from './queuedBroadcast.js';
// §5.3 broadcast-failure permanence. Exported because BOTH queues need the
// same verdict: the core PendingTx drain above, and the extension host's own
// on-demand queue, which would otherwise retry a dead transaction forever.
export { classifyBroadcastFailure } from './broadcastPermanence.js';
export { diagnosticDump, createErrorRingBuffer } from './diagnosticDump.js';
export {
    markBackupVerified,
    getBackupVerifiedAt,
    dismissBackupReminder,
    computeBackupReminderState,
} from './backupReminder.js';
export {
    entriesToCsv,
    entriesToJson,
    buildExportFilename,
    filterEntriesByDateRange,
    EXPORT_COLUMNS,
} from './historyExport.js';
export {
    markDemoWallet,
    getDemoWalletId,
    getDemoWalletPassword,
    getDemoWalletExpiry,
    clearDemoWalletId,
    isDemoWallet,
    isDemoWalletExpired,
    DEMO_DEFAULT_TTL_MS,
} from './demoMode.js';
export {
    synthesizeDemoBalances,
    synthesizeDemoStaking,
    synthesizeDemoContractStakes,
    synthesizeDemoContractMeta,
    synthesizeDemoHistory,
    synthesizeDemoLinks,
    synthesizeDemoDefiPositions,
    synthesizeDemoMarketActivity,
    synthesizeDemoMessages,
    synthesizeDemoContacts,
    synthesizeDemoDispensers,
    synthesizeDemoDispenses,
} from './demoFixtures.js';
export {
    discoverUsedAddresses,
    DEFAULT_GAP_LIMIT,
    DEFAULT_PER_QUERY_TIMEOUT_MS,
    DEFAULT_CHAIN_TIMEOUT_MS,
} from './discoverUsedAddresses.js';
export {
    createSignThrottle,
    SIGN_THROTTLE_DEFAULT_BURST,
    SIGN_THROTTLE_DEFAULT_WINDOW_MS,
} from './signThrottle.js';
export {
    normalizeOrigin,
    parseWildcardPattern,
    normalizeBlocklistEntry,
    isOriginBlocked,
    listBlockedOrigins,
    addBlockedOrigin,
    removeBlockedOrigin,
    listBlocklistAuditLog,
    clearBlocklistAuditLog,
} from './blocklist.js';
export {
    refreshChainRegistry,
    createChainRegistryStatus,
} from './refreshChainRegistry.js';
export {
    listCustomChains,
    addCustomChain,
    removeCustomChain,
} from './customChains.js';
export {
    getDividendRecipients,
    getAirdropRecipients,
} from './recipientsByAction.js';
export {
    refreshFirmwareManifest,
    resolveActiveFirmwareManifest,
    createInMemoryFirmwareManifestCache,
    FIRMWARE_MANIFEST_CACHE_KEY,
} from './firmwareManifestRefresh.js';
export {
    getActiveNetwork,
    isChainOnActiveNetwork,
    filterChainIdsByActiveNetwork,
} from './effectiveNetwork.js';
export {
    createPriceOracle,
    COINGECKO_SUPPORTED_CHAINS,
} from './priceOracle.js';
