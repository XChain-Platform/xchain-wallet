// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `components.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'components.placeOrderPanel.itWaitsInTheQueued':
        "It waits in the queued-transactions banner until you broadcast it from there, and the wallet reminds you when the network is back, so don't place it again.",
    'components.placeOrderPanel.orderPlaced': 'Order placed',
    'components.placeOrderPanel.placeAnother': 'Place another',
    'components.placeOrderPanel.coinpayAutoPayIsArmed':
        'CoinPay auto-pay is armed for this order. You can turn it off any time from the open-orders list.',
    'components.placeOrderPanel.theOrderWasPlacedBut': "The order was placed, but auto-pay couldn't be armed",
    'components.placeOrderPanel.matchesWillNeedManualPayment':
        '. Matches will need manual payment from Payments due.',
    'components.placeOrderPanel.reviewOrder': 'Review order',
    'components.placeOrderPanel.editOrder': 'Edit order',
    'components.placeOrderPanel.createUnsignedTransaction': 'Create unsigned transaction',
    'components.placeOrderPanel.signOn': 'Sign on {value}',
    'components.placeOrderPanel.placeOrder': 'Place {side} order',
    'components.placeOrderPanel.market': 'Market',
    'components.placeOrderPanel.side': 'Side',
    'components.placeOrderPanel.buy': 'Buy',
    'components.placeOrderPanel.sell': 'Sell',
    'components.placeOrderPanel.give': 'Give',
    'components.placeOrderPanel.get': 'Get',
    'components.placeOrderPanel.price': 'Price',
    'components.placeOrderPanel.expiration': 'Expiration',
    'components.placeOrderPanel.settlementAddress': 'Settlement address',
    'components.placeOrderPanel.watcherModeBuildsAnUnsigned':
        'Watcher mode builds an unsigned transaction for your Signer-mode wallet.',
    'components.placeOrderPanel.placeOrder2': 'Place order',
    'components.placeOrderPanel.loadingWalletBalances': 'Loading wallet balances…',
    'components.placeOrderPanel.orderSide': 'Order side',
    'components.placeOrderPanel.priceAndAmount': 'Price and amount',
    'components.placeOrderPanel.price2': 'Price ({tick2})',
    'components.placeOrderPanel.size': 'Size ({tick1})',
    'components.placeOrderPanel.custom': 'Custom…',
    'components.placeOrderPanel.customExpiration': 'Custom expiration',
    'components.placeOrderPanel.thisOrderGives': 'This order gives',
    'components.placeOrderPanel.soEachMatchSettlesVia': ', so each match settles via CoinPay: the',
    'components.placeOrderPanel.paymentMustBeSentWithin':
        'payment must be sent within the payment window (about 2 hours) or the match expires.',
    'components.placeOrderPanel.enableCoinpayAutoPay': 'Enable CoinPay auto-pay',
    'components.placeOrderPanel.outstandingAutoPayExposureOn': 'Outstanding auto-pay exposure on this network:',
    'components.placeOrderPanel.fromThisOrder': ' (+ {thisOrderGive} {coinTicker} from this order)',
    'components.placeOrderPanel.evenIfTheServiceThat':
        '. Even if the service that reports matches were fully compromised, auto-pay could send no more than this.',
    'components.placeOrderPanel.autoPayExposureFromThis': 'Auto-pay exposure from this order: up to',
    'components.placeOrderPanel.iUnderstandTheWalletMust':
        'I understand the wallet must stay open for auto-pay to work.',
    'components.placeOrderPanel.autoPayIsUnavailableIn':
        'Auto-pay is unavailable in watch-only mode; you will be notified when a match needs payment.',
    'components.placeOrderPanel.autoPayIsUnavailableFor':
        'Auto-pay is unavailable for hardware signers (unattended signing needs a software key); you will be notified when a match needs payment.',
    'components.tickItemsEditor.tokensOnePerLine': 'Tokens (one per line)',
    'components.tickItemsEditor.tick1Tick2': 'TICK1\nTICK2',
    'components.tickItemsEditor.addFromTokenPicker': 'Add from token picker',
    'components.tickItemsEditor.tokenOrder': 'Token order',
    'components.tickItemsEditor.positionOf': '{accessibleItem}, position {value} of {length}',
    'components.tickItemsEditor.coinFor': 'Coin for {accessibleItem}',
    'components.tickItemsEditor.moveUp': 'Move {accessibleItem} up',
    'components.tickItemsEditor.moveDown': 'Move {accessibleItem} down',
    'components.tickItemsEditor.remove': 'Remove {accessibleItem}',
    'components.tickItemsEditor.invalid': ' · {length} invalid',
    'components.tickItemsEditor.checking': ' · checking…',
    'components.tickItemsEditor.found': ' · {length} found',
    'components.tickItemsEditor.notFound': ' · {length} not found',
    'components.tickItemsEditor.notChecked': ' · {uncheckedTicks} not checked',
    'components.tickItemsEditor.notATokenName': 'Not a token name:',
    'components.tickItemsEditor.notFoundOn': 'Not found on',
    'components.tickItemsEditor.theNetworkLeavesAnUnknown':
        '. The network leaves an unknown token out of the list, so',
    'components.tickItemsEditor.it': 'it',
    'components.tickItemsEditor.they': 'they',
    'components.tickItemsEditor.willNotBeAMember': "won't be a member.",
    'components.tickItemsEditor.notChecked2': 'Not checked:',
    'components.psbtIntentPanel.decodingTransaction': 'Decoding transaction…',
    'components.psbtIntentPanel.thisTransactionCouldNotBe':
        "This transaction couldn't be decoded, so the wallet can't show you what it does. Only continue if you trust where it came from.",
    'components.psbtIntentPanel.verifyTheAmountsAndDestinations':
        'Verify the amounts and destinations below before you sign.',
    'components.psbtIntentPanel.ordinaryPaymentThisTransactionCarries':
        'Ordinary payment: this transaction carries no XChain action.',
    'components.psbtIntentPanel.inputs': 'Inputs (',
    'components.psbtIntentPanel.whatThisTransactionSpends': ') - what this transaction spends',
    'components.psbtIntentPanel.unknownInput': 'Unknown input',
    'components.psbtIntentPanel.signsWithYourKey': 'Signs with your key',
    'components.psbtIntentPanel.yourAddress': 'Your address',
    'components.psbtIntentPanel.otherSigner': 'Other signer',
    'components.psbtIntentPanel.unknownSourceScript': '(unknown source script)',
    'components.psbtIntentPanel.amountUnknown': 'amount unknown',
    'components.psbtIntentPanel.outputs': 'Outputs (',
    'components.psbtIntentPanel.whereTheCoinsGo': ') - where the coins go',
    'components.psbtIntentPanel.changeBackToYou': 'Change (back to you)',
    'components.psbtIntentPanel.recipient': 'Recipient',
    'components.psbtIntentPanel.dataNonAddressOutput': '(data / non-address output)',
    'components.psbtIntentPanel.leavingThisWallet': 'Leaving this wallet',
    'components.psbtIntentPanel.unavailable': 'unavailable',
    'components.psbtIntentPanel.totalIn': 'Total in',
    'components.psbtIntentPanel.totalOut': 'Total out',
    'components.openOrdersPanel.openOrders': 'Open orders',
    'components.openOrdersPanel.orderCancellation': 'order cancellation',
    'components.openOrdersPanel.loadingOpenOrders': 'Loading open orders…',
    'components.openOrdersPanel.noOpenOrdersOnThis': 'No open orders on this market.',
    'components.openOrdersPanel.size': 'Size (',
    'components.openOrdersPanel.filled': 'Filled',
    'components.openOrdersPanel.filled2': '••••• filled',
    'components.openOrdersPanel.filled3': '{filled}/{size} filled',
    'components.openOrdersPanel.open': 'open',
    'components.openOrdersPanel.coinpayAutoPay': 'CoinPay auto-pay {value}',
    'components.openOrdersPanel.cancelOrder': 'Cancel order #',
    'components.openOrdersPanel.from': 'from',
    'components.openOrdersPanel.thisSubmitsACancellationTransaction':
        "This submits a cancellation transaction for the remaining order. Once confirmed, it can't be undone.",
    'components.openOrdersPanel.cancelOrder2': 'Cancel order',
    'components.confirmActionModal.confirm': 'Confirm {value}',
    'components.confirmActionModal.signingWith': 'Signing with',
    'components.confirmActionModal.messageToSign': 'Message to sign',
    'components.confirmActionModal.signingAddress': 'Signing address',
    'components.confirmActionModal.twoTransactionsBothSignedNow':
        'Two transactions, both signed now and broadcast in order:',
    'components.confirmActionModal.protocolFee': 'Protocol fee:',
    'components.confirmActionModal.sentOnChainAndNot':
        ' (sent on-chain and not refunded if the action is rejected)',
    'components.confirmActionModal.protocolFeeEstimateUnavailable': 'Protocol fee estimate unavailable.',
    'components.confirmActionModal.aHardwareDeviceVerifiesNative':
        'A hardware device verifies native outputs and destinations only; the action data is obfuscated on-chain, so this screen is where you verify the action intent.',
    'components.confirmActionModal.reChecking': 'Re-checking…',
    'components.confirmActionModal.signingFor': 'Signing for',
    'components.confirmActionModal.secondsCheckYourHardwareWallet':
        'seconds. Check your hardware wallet screen if one is connected.',
    'components.confirmActionModal.signingIsTakingLongerThan':
        "Signing is taking longer than expected. Keep this screen open and check the device or wallet service. Before trying again, check History and the queued-transactions banner so you don't submit the same transaction twice.",
    'components.confirmActionModal.signedNotBroadcastYet': 'Signed - not broadcast yet.',
    'components.gatedFileViewer.couldNotDecodeTheUnlocked':
        "Couldn't decode the unlocked file. Try unlocking it again.",
    'components.gatedFileViewer.thisFileIsLargerThan':
        "This file is larger than 5 MB and can't be previewed safely. Download it to view the full file.",
    'components.gatedFileViewer.imagePreviewFailedToLoad':
        'Image preview failed to load. Download the file to view it.',
    'components.gatedFileViewer.loadingImagePreview': 'Loading image preview…',
    'components.gatedFileViewer.unlockedGatedImage': 'Unlocked gated image',
    'components.gatedFileViewer.imagePreviewIsUnavailableDownload':
        'Image preview is unavailable. Download the file to view it.',
    'components.gatedFileViewer.pdfPreviewIsDisabledFor':
        'PDF preview is disabled for security. Download the file and open it in your PDF viewer.',
    'components.gatedFileViewer.thisFileTypeCanT':
        "This file type can't be previewed. Download it to view with a matching application.",
    'components.gatedFileViewer.unlockedFile': 'Unlocked file',
    'components.gatedFileViewer.bytes': '{formatDecimalAmountValue} bytes · ',
    'components.gatedFileViewer.detected': 'detected:',
    'components.gatedFileViewer.publishedAs': ' · published as: {declared}',
    'components.gatedFileViewer.thePublishedFileType': 'The published file type (',
    'components.gatedFileViewer.doesnTMatchTheActual': ") doesn't match the actual content (",
    'components.gatedFileViewer.treatThisFileWithCaution': '). Treat this file with caution.',
    'components.gatedFileViewer.close': 'Close',
    'components.gatedFileViewer.download': 'Download',
    'components.watcherResultPanel.unsignedTransactionReadyForSigning':
        'Unsigned transaction, ready for signing',
    'components.watcherResultPanel.takeThisTransactionToYour':
        'Take this transaction to your Signer-mode wallet. Paste the code, or scan the animated QR. Signing authorizes this transaction only, so verify its details again on the signer. Then paste the signed transaction into a Normal-mode wallet to broadcast.',
    'components.watcherResultPanel.encoding': 'Encoding',
    'components.watcherResultPanel.unsignedTransactionHex': 'Unsigned transaction (code)',
    'components.watcherResultPanel.unsignedTransactionHex2': 'Unsigned transaction code',
    'components.watcherResultPanel.copyHex': 'Copy code',
    'components.watcherResultPanel.copyUnsignedTransactionHex': 'Copy unsigned transaction code',
    'components.watcherResultPanel.animatedQrFormat': 'Animated QR format',
    'components.watcherResultPanel.qrFormat': 'QR format',
    'components.watcherResultPanel.animatedQr': 'Animated QR (',
    'components.watcherResultPanel.unsignedTransactionAnimatedQr': 'Unsigned transaction animated QR',
    'components.watcherResultPanel.plainTextChunks': 'Plain-text chunks',
    'components.watcherResultPanel.unsignedTransaction': 'Unsigned transaction {formatLabel}',
    'components.watcherResultPanel.buildAnother': 'Build another',
    'components.derivationPathCrossCheck.hardwareSignerVerification': 'Hardware signer verification',
    'components.derivationPathCrossCheck.signingWithHardwareDevice': 'Signing with hardware device',
    'components.derivationPathCrossCheck.derivationPathHelpLabel': 'Derivation path help',
    'components.derivationPathCrossCheck.locatesThisAccountWithinYour':
        'Locates this account within your recovery phrase. Compare it with your device to make sure you sign from the intended account.',
    'components.derivationPathCrossCheck.verify': 'Verify',
    'components.derivationPathCrossCheck.both': 'both',
    'components.derivationPathCrossCheck.theDerivationPathAndAddress':
        'the derivation path and address on your',
    'components.derivationPathCrossCheck.matchTheValuesAboveApprove':
        'match the values above. Approve only when both match.',
    'components.derivationPathCrossCheck.ifEitherValueIsDifferent':
        'If either value is different, the device may be using a different account or signing address. Reject on the device. Nothing is signed, and you can check the selected account before trying again.',
    'components.derivationPathCrossCheck.trezorDisplaysTheAddressAnd':
        'Trezor displays the address and the derivation path side-by-side on the confirmation screen.',
    'components.derivationPathCrossCheck.ledgerDisplaysTheAddressOn':
        'Ledger displays the address on the main screen. On Nano models, press the right button to step through to the path; on Stax, the path appears below the address.',
    'components.derivationPathCrossCheck.stepThroughTheDeviceScreens':
        'Step through the device screens to compare both values.',
    'components.derivationPathCrossCheck.iVeVerifiedThePath':
        "I've verified the path and address on my {deviceLabel}.",
    'components.logConsole.searchMessages': 'Search messages…',
    'components.logConsole.searchLogMessages': 'Search log messages',
    'components.logConsole.copyAllLogEntries': 'Copy all log entries',
    'components.logConsole.copyFilteredLogEntriesPlus':
        'Copy filtered log entries plus entries hidden by the active filters',
    'components.logConsole.copyFailedClipboardUnavailable': 'Copy failed: clipboard unavailable',
    'components.logConsole.copyAll': 'Copy all',
    'components.logConsole.clearLogBuffer': 'Clear log buffer',
    'components.logConsole.recentConsoleEntries': 'Recent console entries',
    'components.logConsole.noLogEntriesYetTrigger':
        'No log entries yet. Trigger an action and recent console output will appear here.',
    'components.logConsole.showing': 'Showing',
    'components.logConsole.of': 'of',
    'components.logConsole.matchingEntries': 'matching entries',
    'components.logConsole.total': 'total).',
    'components.operatorPublisherMode.oracleValue': 'oracle value',
    'components.operatorPublisherMode.publisherMode': 'Publisher mode',
    'components.operatorPublisherMode.leavePublisherMode': 'Leave publisher mode',
    'components.operatorPublisherMode.enterPublisherMode': 'Enter publisher mode',
    'components.operatorPublisherMode.publisherModeCreatesAnOn':
        "Publisher mode creates an on-chain update of the selected feed reference with the value you enter. You review each update before it's signed and sent.",
    'components.operatorPublisherMode.chooseLeavePublisherModeTo':
        'Choose Leave publisher mode to close the form and return to the dashboard.',
    'components.operatorPublisherMode.chooseEnterPublisherModeTo':
        'Choose Enter publisher mode to open the form.',
    'components.operatorPublisherMode.feedReferenceNumber': 'Feed reference number',
    'components.operatorPublisherMode.preFilledFromTheMost':
        'Pre-filled from the most recent feed you created. Override it to publish to a different feed.',
    'components.operatorPublisherMode.noFeedFoundForThis':
        'No feed found for this address. Enter its reference number, or create a feed first.',
    'components.operatorPublisherMode.theFeedValueToPublish':
        'The feed value to publish. The previous value clears on success; the next value is one keystroke away.',
    'components.operatorPublisherMode.loadingSourceAddress': 'Loading source address…',
    'components.operatorPublisherMode.watcherModeBuildsAnUnsigned':
        'Watcher mode builds an unsigned transaction for a Signer-mode wallet.',
    'components.operatorPublisherMode.lastPublishedTxid': 'Last published transaction ID:',
    'components.operatorPublisherMode.publishValue': 'Publish value',
    'components.operatorPublisherMode.loadingFeed': 'Loading the most recent feed for this address.',
    'components.operatorPublisherMode.sourceNotInWallet': "This wallet doesn't contain the source address on this network.",
    'components.operatorPublisherMode.sourceLoadFailed': "Couldn't load the source address. Try again.",
    'components.operatorPublisherMode.sourceStillLoading': 'Source address is still loading.',
    'components.operatorPublisherMode.feedRequired': 'Feed reference number is required.',
    'components.operatorPublisherMode.feedWholeNumber': 'Feed reference number must be a positive whole number.',
    'components.operatorPublisherMode.valueRequired': 'Value is required.',
    'components.operatorPublisherMode.valueNumber': 'Value must be a number.',
    'components.balanceChanges.balanceChanges': 'Balance changes',
    'components.balanceChanges.calculatingPreview': 'Calculating preview…',
    'components.balanceChanges.weCouldnTEstimateThis':
        'We couldn’t estimate this transaction’s effect (preview unavailable).',
    'components.balanceChanges.sideEffects': 'Side effects',
    'components.balanceChanges.unknown': 'unknown',
    'components.balanceChanges.balanceUnknown': 'Balance unknown',
    'components.balanceChanges.fiatUnavailable': 'Fiat unavailable ({fiatCurrency})',
    'components.tradeHistoryPanel.tradeHistory': 'Trade history',
    'components.tradeHistoryPanel.refresh': 'Refresh',
    'components.tradeHistoryPanel.loadingTradeHistory': 'Loading trade history…',
    'components.tradeHistoryPanel.noTradesOnThisMarket': 'No trades on this market yet.',
    'components.tradeHistoryPanel.time': 'Time',
    'components.tradeHistoryPanel.openTransaction': 'Open transaction {txHash}',
    'components.contractConsentPanel.whereThisComesFrom': 'Where this comes from',
    'components.contractConsentPanel.reportedByTheXchainIndex':
        'Reported by the XChain index, not checked against the chain by this wallet.',
    'components.contractConsentPanel.permissionYouGrant': 'Permission you grant',
    'components.contractConsentPanel.theWalletCouldnTLook':
        'The wallet couldn’t look up which actions you would grant this contract permission to take. Try again, or continue only if you trust the author.',
    'components.contractConsentPanel.maxFeeItCanTake': 'Max fee it can take',
    'components.contractConsentPanel.noLimitOfItsOwn': 'No limit of its own, so the network limit applies.',
    'components.contractConsentPanel.anythingByContinuingYouGrant':
        'Anything. By continuing, you grant this contract permission to take any action the protocol allows on your behalf. The contract set no limits on itself, so continue only if you trust the author.',
    'components.contractConsentPanel.youGrantNoActionPermissions':
        'You grant no action permissions: this contract declared it can take no actions on your behalf.',
    'components.contractConsentPanel.byContinuingYouGrantThis':
        'By continuing, you grant this contract permission to:',
    'components.contractConsentPanel.itCan': 'It can',
    'components.orderbookPanel.orderBook': 'Order book',
    'components.orderbookPanel.buyBids': 'Buy bids',
    'components.orderbookPanel.sellAsks': 'Sell asks',
    'components.orderbookPanel.loadingOrderBook': 'Loading order book…',
    'components.orderbookPanel.orderBookLevels': '{title} order book levels',
    'components.orderbookPanel.price': 'Price (',
    'components.orderbookPanel.total': 'Total (',
    'components.orderbookPanel.pickPrice': 'Pick {value} price {displayPrice}',
    'components.collectiblesView.collectiblesAppearHereAfterThis':
        'Collectibles appear here after this wallet receives them.',
    'components.collectiblesView.collectibles': 'Collectibles',
    'components.collectiblesView.hiddenCollectibles': 'Hidden collectibles',
    'components.collectiblesView.openDetails': 'Open {value} details',
    'components.priceAlertForm.direction': 'Direction',
    'components.priceAlertForm.targetPrice': 'Target price',
    'components.priceAlertForm.saveChanges': 'Save changes',
    'components.priceAlertForm.addAlert': 'Add alert',
    'components.priceAlertForm.isAlready': 'is already',
    'components.priceAlertForm.above': 'above',
    'components.priceAlertForm.below': 'below',
    'components.priceAlertForm.thatPriceThisAlertWill': 'that price. This alert will fire on the next check.',
    'components.recentTradesPanel.recentTrades': 'Recent trades',
    'components.recentTradesPanel.openTransaction': 'Open transaction {tx_hash}',
    'components.recentTradesPanel.loadingRecentTrades': 'Loading recent trades…',
    'components.recentTradesPanel.noTradesYet': 'No trades yet.',
    'components.listPickerScreen.chooseAList': 'Choose a list',
    'components.listPickerScreen.loadingLists': 'Loading lists…',
    'components.listPickerScreen.noAddressListsYet': 'No address lists yet',
    'components.listPickerScreen.noPublishedListsYet': 'No published lists yet',
    'components.listPickerScreen.addressListsPublishedFromThis':
        'Address lists published from this network appear here.',
    'components.listPickerScreen.listsPublishedFromThisChain': 'Lists published from this network appear here.',
    'components.listPickerScreen.searchLists': 'Search lists',
    'components.listPickerScreen.noMatchingLists': 'No matching lists',
    'components.listPickerScreen.tryADifferentSearch': 'Try a different search.',
    'components.rawPsbtViewer.developerRawView': 'Developer · raw view',
    'components.rawPsbtViewer.actionFields': 'Action fields',
    'components.rawPsbtViewer.parsedInputsOutputs': 'Parsed inputs / outputs',
    'components.rawPsbtViewer.parserNotWiredYetSee':
        '(parser not wired yet; see the signing request code above for the raw data)',
    'components.totalBalanceHero.activeAddressBalance': 'Active address balance',
    'components.totalBalanceHero.balanceActions': 'Balance actions',
    'components.totalBalanceHero.openSettings': 'Open settings',
    'components.totalBalanceHero.balanceSummary': 'Balance summary',
    'components.totalBalanceHero.24HourChange': '24-hour change. {label}; {formatFiatAmountForSpeechValue}',
    'components.totalBalanceHero.24h': ') · 24h',
    'components.contactsPickerScreen.noContactsYet': 'No contacts yet',
    'components.contactsPickerScreen.savedContactsWithAddressesAppear':
        'Saved contacts with addresses appear here.',
    'components.contactsPickerScreen.searchContacts': 'Search contacts',
    'components.marketChart.chart': 'Chart',
    'components.marketChart.thePriceChartIsUnavailable': 'The price chart is unavailable right now.',
    'components.marketChart.timeframe': 'Timeframe',
    'components.marketChart.chartTimeframe': 'Chart timeframe',
    'components.marketChart.loadingPriceChart': 'Loading price chart',
    'components.marketChart.noTradesYetInThis': 'No trades yet in this market.',
    'components.networkFilter.searchNetworks': 'Search networks…',
    'components.networkFilter.searchNetworks2': 'Search networks',
    'components.networkFilter.noMatchingNetworks': 'No matching networks.',
    'components.originIdentity.hostEnding': 'Host ending',
    'components.originIdentity.siteDomain': 'Site domain',
    'components.originIdentity.fullOrigin': 'Full origin',
    'components.originIdentity.punycodeDomainVerifyTheSite':
        'Punycode domain. Verify the site address carefully before approving.',
    'components.originIdentity.possibleLookalikeDomainConfirmThat':
        'Possible lookalike domain. Confirm that the highlighted site domain is the one you expect.',
    'components.portfolioChart.portfolioPerformance': 'Portfolio performance',
    'components.portfolioChart.change': '{label} change. {value}; {formatFiatValue}',
    'components.portfolioChart.loadingPriceHistory': 'Loading price history…',
    'components.portfolioChart.portfolioPerformanceChart': 'Portfolio performance chart',
    'components.portfolioChart.noPriceHistoryForThis': 'No price history for this range yet.',
    'components.preflightPanel.preFlightUnavailableProceedingIs':
        'Pre-flight unavailable; proceeding is at your discretion.',
    'components.preflightPanel.signAnyway': 'Sign anyway',
    'components.preflightPanel.partialCheck': 'Partial check',
    'components.preflightPanel.couldNotVerify': "Couldn't verify (",
    'components.preflightPanel.checkedAtBlock': 'Checked at block',
    'components.resumeConfirmCard.unfinishedTransactions': 'Unfinished transactions',
    'components.resumeConfirmCard.finish': 'Finish',
    'components.resumeConfirmCard.notSentYetApproveTo': 'Not sent yet. Approve to sign and send it.',
    'components.resumeConfirmCard.actionToSubmit': 'Action to submit:',
    'components.resumeConfirmCard.discardUnfinished': 'Discard unfinished {label}',
    'components.actionIntentSummary.balanceUnknown': 'balance unknown',
    'components.actionIntentSummary.unknown': '→ unknown',
    'components.networkStatusIndicator.networkStatus': 'Network status',
    'components.networkStatusIndicator.allSelectedChainsAreReachable': 'All selected networks are reachable.',
    'components.networkStatusIndicator.checkingSelectedChains': 'Checking selected networks.',
    'components.networkStatusIndicator.noSelectedChainIsReachable': 'No selected network is reachable.',
    'components.networkStatusIndicator.networkSettings': 'Network settings',
    'components.platformSwitcher.xchainPlatformSites': 'XChain platform sites',
    'components.platformSwitcher.currentSite': '{label}, current site',
    'components.platformSwitcher.youAreHere': 'you are here',
    'components.amountField.useMaxAvailableAmount': 'Use max available amount',
    'components.amountField.max': 'Max',
    'components.amountField.switchInputTo': 'Switch input to {value}',
    'components.amountField.switchInputTo2': 'Switch input to {fiatCcy}',
    'components.layoutModeToggle.openAs': 'Open as',
    'components.layoutModeToggle.chooseHowTheWalletOpens':
        'Choose how the wallet opens from the extension toolbar.',
    'components.layoutModeToggle.popup': 'Popup',
    'components.layoutModeToggle.sidebar': 'Sidebar',
    'components.marketLifecycleTimeline.loadingTimeline': 'Loading timeline…',
    'components.marketLifecycleTimeline.noLifecycleEventsYet': 'No lifecycle events yet.',
    'components.marketLifecycleTimeline.tradeLifecycle': 'Trade lifecycle',
    'components.marketLifecycleTimeline.block': 'block {formatDecimalAmountValue}',
    'components.messageConfirmScreen.signThisMessage': 'Sign this message',
    'components.messageConfirmScreen.requiredToSign': 'Required to sign.',
    'components.psbtConfirmScreen.signTransaction': 'Sign transaction',
    'components.diagnosticDetails.showingTheFirst': 'Showing the first',
    'components.diagnosticDetails.findings': 'findings.',
    'components.mnemonicGrid.recoveryPhraseHiddenMakeSure':
        'Recovery phrase hidden. Make sure no one can see your screen before revealing it.',
    'components.queuedResultPanel.currentStageWaitingToBroadcast': 'Current stage: Waiting to broadcast',
    'components.queuedResultPanel.isSignedButCouldnT':
        "is signed but couldn't reach the network just now. It's waiting in the queued-transactions banner and only goes out when you broadcast it from there; the wallet reminds you when the network is back. Don't submit this again.",
    'components.lockedTokenContext.on': 'on',
    'components.ownerWithdrawWarning.deployerCanWithdraw': 'Deployer can withdraw',
    'components.ownerWithdrawWarning.onlySendTokensHereIf':
        'Only send tokens here if you trust the deployer.',
    'components.sparkline.priceTrend': 'Price trend',
    'components.tokenField.selectAToken': 'Select a token',
    'components.hwFirmwareBanner.openVendorUpdateTool': 'Open vendor update tool',
    'components.keyQR.qrCode': 'QR code',
    'components.learnNote.goodToKnow': 'Good to know',
    'components.relativeTime.exactTime': '{label}. Exact time: {exact}',
    'components.collectiblesView.hideHidden':
        '{count, plural, one {Hide # hidden collectible} other {Hide # hidden collectibles}}',
    'components.collectiblesView.showHidden':
        '{count, plural, one {Show # hidden collectible} other {Show # hidden collectibles}}',
    'components.tickItemsEditor.validCount':
        '{count, plural, one {# valid token name} other {# valid token names}}',
    'components.tickItemsEditor.duplicatesIgnored':
        ' · {count, plural, one {# duplicate ignored} other {# duplicates ignored}}',
    'components.networkFilter.networkCount': '{count, plural, one {# network} other {# networks}}',
    'components.networkFilterDropdown.filterByNetworkAll': 'Filter by network: All networks, {count, plural, one {# network} other {# networks}}',
    'components.totalBalanceHero.refreshPortfolio': 'Refresh portfolio',
    'components.totalBalanceHero.refreshingPortfolio': 'Refreshing portfolio',
    'components.totalBalanceHero.hideFilters': 'Hide filters',
    'components.totalBalanceHero.showFilters': 'Show filters',
    'components.totalBalanceHero.hideChart': 'Hide chart',
    'components.totalBalanceHero.showChart': 'Show chart',
    'components.totalBalanceHero.showBalance': 'Show balance',
    'components.totalBalanceHero.hideBalance': 'Hide balance',
    'components.stalenessLabel.updated': 'Updated {when}',
    'components.stalenessLabel.offline': 'Offline, showing saved data',
    'components.placeOrderPanel.weMonitorForMatchesOn':
        'We monitor for matches on your orders and send payment for them automatically.',
};

addEnglish(messages);

export default messages;
