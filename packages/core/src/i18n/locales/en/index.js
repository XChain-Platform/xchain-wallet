// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English string dictionary (§54 / G173 ICU format).
//
// Keys live in one flat object; dotted keys (`home.lock`) express scope.
// JavaScript silently keeps the last of two identical keys, so
// test/smoke/core/i18n.smoke.js scans this source and fails on a repeat.
//
// Plural / select handling uses ICU MessageFormat-compatible syntax:
//
//   '{count, plural, one {# address} other {# addresses}}'
//   '{kind, select, mainnet {Live} testnet {Testnet} other {Other}}'
//
// `t()` in `i18n/index.js` renders the matched template through
// formatjs (`IntlMessageFormat` from `intl-messageformat`), so the full
// ICU grammar is available: plural, select, selectordinal, number and
// date skeletons, nested patterns and offset. Templates here use only
// plural and select today, which is a choice about the copy, not a
// limit of the runtime. The plural/select-only subset the wallet
// shipped before v0.334 survives as `legacyFormat()` in `i18n/index.js`
// and is reached only when formatjs refuses to parse a template.
//
// Adding a new locale: copy this directory to `locales/<bcp47>/index.js`,
// translate every value, then call
// `registerLocale('<bcp47>', dictionary)` from app boot.
//
// Until a locale is registered, missing keys fall back to English.

export const en = {
    // --- common ---------------------------------------------------
    'common.back': 'Back',
    'common.backToHome': 'Back to home',
    'common.cancel': 'Cancel',
    'common.clear': 'Clear',
    'common.tryAgain': 'Try again',
    'common.openNetworkSettings': 'Open Network settings',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.contactName': 'Contact name',

    // --- home -----------------------------------------------------
    'home.receive': 'Receive',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.empty.title': 'This wallet has no coins to send yet.',
    'send.empty.body': 'Receive funds on this chain before creating a send.',
    'send.review': 'Review and send',
    'send.backToEdit': 'Edit payment',
    'send.memoForbiddenChars': 'A memo cannot include a vertical bar (|) or semicolon (;).',
    'send.passwordHint': 'Enter your wallet password to sign this transaction.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First payment to this address. Send a small test first?',
    'send.testGate.body':
        'You are sending {amount} {ticker} to a new recipient. A small test payment helps you confirm the address before sending the full amount.',
    'send.testGate.sendSmall': 'Send a small test first',
    'send.testGate.continue': 'Continue with the full amount',
    'send.signerMode':
        'This wallet is in signer mode. It can sign transactions from a watch-only wallet, but it cannot send them to the network. To send from this device, change the mode under Settings, Wallet mode.',
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
    'send.queued.body':
        "Your transaction is signed but could not reach the network. It is waiting in the queued-transactions banner and only goes out when you broadcast it from there. The wallet reminds you when the network is back. Don't send this payment again.",
    'send.success.broadcastPending': 'Broadcast pending',
    'send.success.broadcastPendingBody':
        'The network accepted your transaction. It is waiting for confirmation, which usually takes a few blocks. You can leave this screen.',
    'send.success.copyTransactionId': 'Copy transaction ID',
    'send.success.copy': 'Copy',
    'send.success.viewOnExplorer': 'View in block explorer',
    'send.success.sendAnother': 'Send another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    'send.fields.chain': 'Chain',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.reviewLabel': 'Review payment',
    'send.review.createUnsigned': 'Create transaction for signing',
    'send.review.signOn': 'Sign on {device}',
    'send.review.sign': 'Sign',
    'send.review.submitAction': '{label}',
    'send.memoCount':
        '{used, number} / {max, number} {used, plural, one {byte} other {bytes}}',
    'send.advanced.label': 'Advanced send choices',
    'send.advanced.none': 'None',
    'send.advanced.feeBumping': 'Fee bumping',
    'send.advanced.allowed': 'Allowed',
    'send.advanced.notAllowed': 'Not allowed',
    'send.advanced.coinControl': 'Coin control',
    'send.advanced.coinControlEnabled': 'Coin control enabled',
    'send.advanced.coinControlReady': 'Choose exactly which unspent outputs fund this transaction.',
    'send.advanced.coinControlUnavailable': "Coin control is unavailable while spendable inputs can't be loaded.",
    'send.advanced.loadingInputs': 'Loading spendable inputs…',
    'send.advanced.inputs': 'Inputs',
    'send.advanced.noInputs': 'No spendable inputs found.',
    'send.advanced.changeAddress': 'Change address',
    'send.advanced.automaticChange': 'Automatic: {address}',
    'send.advanced.changeHint': 'Any leftover native coin returns here.',
    'send.advanced.availableCount': '{count} available',
    'send.advanced.selectAll': 'Select all',
    'send.advanced.clearSelection': 'Clear',
    'send.advanced.dust': 'Dust',
    'send.advanced.dustTitle': 'Below the {sats} sat dust threshold',
    'send.advanced.summaryLabel': 'Coin control summary',
    'send.advanced.selectedTotal': 'Selected total',
    'send.advanced.approxChange': 'Approx. change',
    'send.review.multiTokenPreview':
        'This payment includes more than one token. The balance preview shows one token at a time, but every recipient and amount appears under Details.',
    'send.review.details': 'Details ({count})',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherMode':
        'Watch-only mode creates a transaction without signing or sending it. Move the result to your signer wallet to sign and send it.',
    'send.watcherHardware':
        'This address is paired with {device}, but a watch-only wallet cannot sign. Pair the same {device} with your signer wallet to sign the transaction.',
    'send.walletUnlocked': 'Wallet unlocked. No password needed.',
    'send.useMax': 'Use max',
    'send.fromAddress': 'From address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.',
    'send.draft.discardLabel': 'Discard saved draft',
    'send.draft.discard': 'Discard',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.noAddress': 'No address on this chain. Use Receive to generate one first.',
    'send.destination.placeholder': 'Enter or paste an address or contact name',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save recipient',
    'send.saveRecipient.save': 'Save contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': "Choose the asset to send. The network's own coin is selected by default.",
    'send.balance.unavailable': 'Balance unavailable ({error})',
    'send.balance.available': '{amount} {ticker} available',
    'send.recipient.heading': 'Recipient {number}',
    'send.recipient.removeLabel': 'Remove recipient {number}',
    'send.recipient.remove': 'Remove',
    'send.recipient.addressLabel': 'Recipient {number} address',
    'send.recipient.tokenLabel': 'Recipient {number} token',
    'send.recipient.amountLabel': 'Recipient {number} amount',
    'send.recipient.selectToken': 'Select token for recipient {number}',
    'send.recipient.differentToken': 'Different token per recipient',
    'send.recipient.differentTokenOff': 'Off: every recipient gets {token}.',
    'send.recipient.tokenAbove': 'the token above',
    'send.recipient.total':
        'Total: {total} across {count, plural, one {# recipient} other {# recipients}}, in one transaction and one network fee.',
    'send.recipient.add': '+ Add recipient',
    'send.recipient.maximum':
        '{count, plural, one {You can include up to # recipient in one payment.} other {You can include up to # recipients in one payment.}} Create another payment for any additional recipients.',
    'send.gated.ready':
        'This token includes protected content. Its unlock key will be attached securely so the recipient can open the content. You can send it only to an address that has already made a transaction.',
    'send.gated.partial':
        'This token includes {total, plural, one {# protected content pack} other {# protected content packs}}, but this wallet has unlock keys for only {available}. The recipient cannot open the missing {missingCount, plural, one {pack} other {packs}}: {missing}… You can continue, or recover the missing keys by opening the content once from the address that received it.',
    'send.gated.blocked':
        'This token includes protected content, but this wallet has none of its unlock keys. The network will reject a payment without the key, and the recipient will not be able to open the content.',
    'send.gated.softwareSigner':
        'Recovering the key requires a software wallet because it must decrypt messages with the private key. Use a software wallet that holds this address to recover the key.',
    'send.gated.passwordLabel': 'Wallet password',
    'send.gated.passwordHint':
        'Scans messages sent to your addresses for the unlock key and stores it in this wallet.',
    'send.gated.recover': 'Recover keys',
    'send.networkFee': 'Network fee',
    'send.advanced': 'Advanced',
    'send.memo': 'Memo',
    'send.rbf.label': 'Allow a higher network fee later',
    'send.rbf.helpLabel': 'Learn about changing the network fee',
    'send.rbf.help':
        'Before confirmation, you can replace this transaction with one that pays a higher network fee. This can speed it up or cancel it.',
    'send.rbf.enabledHint':
        'You can speed up or cancel this transaction by paying a higher network fee before confirmation.',
    'send.rbf.unsupported': 'Changing the network fee later is not supported on {chain}.',
    'send.rbf.thisChain': 'this chain',
    'send.rbf.enabledLabel': 'Allow a higher network fee later',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'The transaction already appears in History. Its network status may take up to a minute to update.',

    // --- extension banner ----------------------------------------

    // --- xchain: URI intent labels (Cluster L FOLLOWUP 5) ---------
    'uri.intent.send': 'Send',
    'uri.intent.sendTo': 'Send to {address}',
    'uri.intent.sendToken': 'Send {tick}',
    'uri.intent.sendAssetTo': 'Send {tick} to {address}',
    'uri.intent.sendAmount': 'Send {amount} {tick}',
    'uri.intent.sendAmountTo': 'Send {amount} {tick} to {address}',
    'uri.intent.receive': 'Receive',
    'uri.intent.receiveAt': 'Receive at {address}',
    'uri.intent.receiveAsset': 'Receive {tick}',
    'uri.intent.receiveAssetAt': 'Receive {tick} at {address}',
    'uri.intent.receiveAmount': 'Receive {amount} {tick}',
    'uri.intent.receiveAmountAt': 'Receive {amount} {tick} at {address}',
    'uri.intent.execute': 'Call contract #{contract}',
    'uri.intent.executeMethod': 'Call {method} on contract #{contract}',
    'uri.intent.unknown': 'Unrecognized link',

    // --- scan route (Cluster R FOLLOWUP 2: i18n migration beachhead) -
    'scan.title': 'Scan',
    'scan.scannerAlt': 'Scan a QR code',
    'scan.routing': 'Scanned, routing…',
    'scan.pasteLabel': 'Or paste it here',
    'scan.pastePlaceholder': 'xchain:… / bitcoin:… / address / transaction hex',
    'scan.classifyPaste': 'Use pasted text',
    'scan.error.pasteEmpty': 'Paste something first.',
    'scan.error.unknownXchainIntent':
        'xchain: URI was scanned but the intent was not recognized. Try a clearer code.',
    'scan.error.paymentRequest':
        "This payment request doesn't match a supported chain or valid address.",
    'scan.error.wif':
        'This is a private key (WIF). In XChain Platform, open Import wallet and choose Import WIF.',
    'scan.error.mnemonic':
        'This is a recovery phrase. In XChain Platform, open Import wallet and choose Recovery phrase.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        "A signed transaction was scanned. This screen can't broadcast raw transaction hex. Use a compatible broadcasting tool.",
    'scan.error.backupPointer':
        'This is a backup pointer. In XChain Platform, open Import wallet, choose Encrypted backup, and scan it there.',
    'scan.error.pairingCode':
        'This is a wallet pairing code. In XChain Platform, open Pair a watcher or signer and scan it there.',
    'scan.error.unknown':
        "This QR code contains text the wallet doesn't know how to use.",

    // --- history --------------------------------------------------
    'history.title': 'History',
    'history.refresh': 'Refresh history',
    'history.refreshing': 'Refreshing history',
    'history.offline.cached': 'You are offline. Showing the last saved history. Network actions will be available when your connection returns.',
    'history.offline.empty': 'You are offline. Connect to load history and use network actions.',
    'history.offline.refreshFailed': "History didn't refresh. Showing the last saved history.",
    'history.showMore': 'Show more history',
    'history.itemsShown':
        '{shown, number} of {total, plural, one {# history item} other {# history items}} shown',
    'history.showMoreGroupEntries': 'Show more group entries ({shown} of {total} shown)',
    'history.recipients.noHoldersFound': 'No holders yet',
    'history.recipients.noRecipientsFound': 'No recipients yet',
    'history.recipients.noHoldersBody': 'Token holders appear here after balances are indexed.',
    'history.recipients.noRecipientsBody': 'Matching recipients appear here after history is indexed.',
    'history.loading': 'Loading history',
    'history.empty.noAddressesTitle': 'No addresses yet',
    'history.empty.noAddressesBody': 'History appears here after you generate an address and send or receive funds.',
    'history.empty.noMatchesTitle': 'No results for these filters',
    'history.empty.noSearchResultsTitle': 'No results for "{query}"',
    'history.empty.noMatchesBody': 'Matching history appears here after you reset or change the filters.',
    'history.empty.clearFilters': 'Reset filters',
    'history.empty.noCrossChainTitle': 'No cross-chain actions yet',
    'history.empty.noCrossChainBody':
        'Cross-chain transfers appear here after you send or receive one.',
    'history.empty.noActivityTitle': 'No activity yet',
    'history.empty.noActivityBody':
        'Activity appears here after you send or receive on a selected chain.',
    'history.filters.label': 'History filters',
    'history.filters.searchPlaceholder': 'Search action, address, token, txid, memo…',
    'history.filters.searchLabel': 'Search history',
    'history.filters.clearSearch': 'Clear history search',
    'history.filters.fromDate': 'From date',
    'history.filters.toDate': 'To date',
    'history.filters.additionalDetails': 'Additional details',
    'history.filters.fiatHelp': "Show local-currency values for the network's own coin.",
    'history.filters.fiatCurrency': 'Fiat: {currency}',
    'history.filters.showFiat': 'Show fiat',
    'history.filters.groupingMode': 'Grouping mode',
    'history.filters.grouped': 'Grouped',
    'history.filters.flat': 'Flat',
    'history.filters.advanced': 'Advanced filters',
    'history.filters.allActionTypes': 'All action types',
    'history.filters.actionType': 'action type',
    'history.filters.actionTypes': 'Action types',
    'history.filters.allStatuses': 'All statuses',
    'history.filters.status': 'status',
    'history.filters.statusHeader': 'Status',
    'history.filters.noSpecialFilters': 'No special filters',
    'history.filters.filter': 'filter',
    'history.filters.special': 'Special',
    'history.filters.multisigOnly': 'Multisig only',
    'history.filters.allChains': 'All chains',
    'history.filters.datePresets': 'Date range presets',
    'history.filters.last7Days': '7 days',
    'history.filters.last30Days': '30 days',
    'history.filters.allDates': 'All',
    'history.filters.dateZone': 'Day boundaries use local time.',
    'history.filters.activeRange': 'Active range: {from} to {to}',
    'history.filters.anyDate': 'any date',
    'history.filters.clearDateRange': 'Clear date range',
    'history.detail.label': 'Action detail',
    'history.detail.options': 'Action options',
    'history.detail.more': 'More',
    'history.detail.noAdditionalActions': 'No additional actions',
    'history.detail.view': 'Action detail view',
    'history.detail.copyRawJson': 'Copy raw JSON',
    'history.detail.peerHeading': 'Peer · {ticker} #{index}',
    'history.detail.loadingPeer': 'Loading the linked transaction…',
    'history.detail.peerError': "Couldn't load peer: {error}",
    'history.detail.copyPeerRawJson': 'Copy peer raw JSON',
    'history.detail.peerUnavailable':
        'Peer chain not bundled in this wallet; open the block explorer for {ticker} to view {ticker} #{index}.',
    'history.detail.openNewWindow': 'Open in new window',
    'history.contact.saveAs': 'Save {address} as',
    'history.contact.save': 'Save',
    'history.copy.clipboard': 'Copy to clipboard',
    'history.copy.copied': 'Copied',
    'history.copy.copiedTitle': 'Copied!',
    'history.copy.actionNumber': 'Copy action number',
    'history.copy.transactionId': 'Copy transaction ID',
    'history.copy.fromAddress': 'Copy from address',
    'history.copy.walletAddress': 'Copy address',
    'history.recipients.showHolders': 'Show holders',
    'history.recipients.showRecipients': 'Show recipients',
    'history.recipients.loadingHolders': 'Loading holders…',
    'history.recipients.loadingRecipients': 'Loading recipients…',
    'history.recipients.saved':
        'Saved {count, plural, one {# address} other {# addresses}} as a single contact "{name}".',
    'history.recipients.holderCount':
        '{count, plural, one {# holder} other {# holders}}',
    'history.recipients.recipientCount':
        '{count, plural, one {# recipient} other {# recipients}}',
    'history.recipients.moreNotShown': '… and {count} more not shown',
    'history.recipients.saveAsContact': 'Save {count} as one contact',
    'history.row.linkedTo': 'Linked to {ticker} #{index}',
    'history.row.block': 'Block {block}',
    'history.row.confirmations':
        '{count, plural, one {# Confirmation} other {# Confirmations}}',
    'history.row.receivedAt': 'Received at {label}',
    'history.group.latest': 'Latest {when}',
    'history.status.confirmed': 'Confirmed',
    'history.status.failed': 'Failed',
    'history.status.pending': 'Pending',
    'history.export.noMatchingRows': 'No rows match the current filters.',
    'history.export.noRows': 'There are no history rows to export.',
    'history.export.open': 'Export…',
    'history.export.title': 'Export history',
    'history.export.format': 'Format',
    'history.export.csv': 'CSV (RFC-4180; compact, opens in spreadsheets)',
    'history.export.json': 'JSON (preserves the full row including link / raw)',
    'history.export.columns': 'Columns',
    'history.export.rowCount':
        '{count, plural, one {# filtered row will be exported.} other {# filtered rows will be exported.}}',
    'history.export.confirm': 'Export',
    'history.export.preparing': 'Preparing…',
    'history.export.progress': 'Preparing {completed} of {total} rows…',
    'history.export.elapsed': '{seconds} seconds elapsed.',
    'history.export.slow': 'Export is taking longer than expected. Cancel, narrow the history filters, and try again.',

    // --- pending (unconfirmed) transactions -----------------------
    // Terminology is fixed: "pending" in every string a user reads,
    // "unconfirmed" only in data and method names. Nothing here may say
    // confirmed or accepted either, because a mempool sighting is
    // pre-validation: the indexer can still reject the action when the
    // block lands, and copy that promises otherwise is a lie the wallet
    // has no way to take back.
    // Backend component names ("indexer", "decoder", "utxo-tracker") stay
    // out of the strings: say "the service" for a backend that is behind or
    // cannot answer, matching humanizeError's backend_behind copy, and keep
    // "the network" for the chain and the mempool, which is what the sibling
    // pending strings above already mean by it.
    'pending.row.awaitingNetwork': 'awaiting network',
    'pending.row.seen': 'pending',
    'pending.row.notSeen': 'not seen by network',
    'pending.row.dropped': 'no longer seen by network',
    'pending.row.replaced': 'replaced',
    'pending.row.confirmed': 'confirmed',
    // The wallet gave up before the network took the send. Its own record is
    // the only trace, so the row says so plainly rather than "pending".
    'pending.row.failed': 'failed, never sent',

    'pending.detail.sectionLabel': 'Pending transaction',
    'pending.detail.failedSectionLabel': 'Failed transaction',
    'pending.detail.failed': 'Failed before it reached the network',
    'pending.detail.failedHelp':
        "This wallet couldn't complete the send. Nothing was broadcast, so no coins moved and no fee was paid. You can send again.",
    'pending.detail.technicalDetails': 'Technical details',
    'pending.detail.dismissFailed': 'Remove from history',
    // A transaction this wallet proved into a block that no feed will ever
    // list: a plain coin transfer, or an action the service recorded nothing
    // for. Both say what the block settled and what it did not.
    'pending.detail.confirmedSectionLabel': 'Confirmed transaction',
    'pending.detail.confirmed': 'Confirmed on the network',
    'pending.detail.confirmedHelp':
        'This transaction is in the permanent network record. It moved coins only, so there is no other action to show.',
    'pending.detail.confirmedNoEffect': 'Confirmed, no effect',
    'pending.detail.confirmedNoEffectHelp':
        'This transaction is in the permanent network record, but it did not complete an action. Any coin movement still took effect.',
    'pending.detail.confirmedBlock': 'Included in block {block}',
    'pending.detail.awaitingNetwork': 'Broadcast, awaiting network',
    'pending.detail.seen': 'Held by the network, waiting for a block',
    'pending.detail.notSeen': 'Not seen by the network',
    'pending.detail.dropped': 'No longer seen by the network',
    'pending.detail.replaced': 'Replaced by a newer transaction',
    'pending.detail.awaitingNetworkHelp':
        'The transaction has been sent. It can take a minute before the network reports it.',
    'pending.detail.seenHelp':
        'The network has this transaction, but it is still waiting to be added to its permanent record.',
    'pending.detail.notSeenHelp':
        'The network has not reported this transaction since it was sent, so it may never have arrived.',
    'pending.detail.droppedHelp':
        'The network reported this transaction earlier but no longer does, and it is not in the permanent record.',
    'pending.detail.replacedHelp':
        'This wallet replaced this transaction with a newer one. Follow the replacement instead.',
    'pending.detail.notValidated': 'Pending, not yet validated by the service.',
    'pending.detail.firstSeen': 'First seen by the network {when}',
    'pending.detail.broadcastAt': 'Broadcast from this wallet {when}',
    'pending.detail.replacementTx': 'Replacement transaction: {txHash}',
    'pending.detail.decodedHeading': 'What this transaction does',
    'pending.detail.sendOutput': '{amount} {tick} to {destination}',
    'pending.detail.memo': 'Memo: {memo}',
    'pending.detail.undecodable':
        "This wallet doesn't read {action} data. The fields below are shown exactly as the network carries them.",
    'pending.detail.localRecordNote':
        "Taken from this wallet's own record of the send. The network hasn't reported the transaction data yet.",
    'pending.detail.noData': 'No action data has been reported for this transaction yet.',

    // M2.5: the amount annotation on a pending row. Verbs still in
    // progress, never a settled figure and never a signed one: the
    // wallet only puts a side on this when it recognized one of the
    // parties as its own, and "moves" is everything it knows otherwise.
    // The caveat travels with the figure as its accessible name, because
    // the styling that sets it apart from the settled amounts below it
    // is not something a screen reader conveys.
    'pending.amount.entry': '{amount} {tick}',
    'pending.amount.separator': ', ',
    'pending.amount.sending': 'sending {amounts}',
    'pending.amount.receiving': 'receiving {amounts}',
    'pending.amount.moving': 'moves {amounts}',
    'pending.amount.caveat': 'Pending, not yet validated by the service: {summary}',

    // --- count labels --------------------------------------------
    'cosigner.allowedRecipientCount':
        '{count, plural, one {# address} other {# addresses}}',
    'cosigner.windowActionCount':
        '{count, plural, one {# action} other {# actions}}',
    'cosigner.rollingActionLimit':
        '{count, plural, one {# action} other {# actions}} per {hours}h',
    'governance.poll.turnout':
        '{quorum} of supply and at least {count, plural, one {# voter} other {# voters}}.',
    'governance.poll.callbackDelay':
        ' It runs {count, plural, one {# block} other {# blocks}} after the poll closes.',
    'contracts.stateKeyCount':
        '{count, plural, one {# state key} other {# state keys}}. Tap Expand to view.',
    'airdrop.underlyingTokenNoun':
        '{count, plural, one {token} other {tokens}}',
    'airdrop.holderCountsUnavailable':
        'Holder counts unavailable for {count, plural, one {# token} other {# tokens}}',
    'airdrop.someHolderCountsUnavailable':
        'Holder counts unavailable for {failed, number} of {total, plural, one {# token} other {# tokens}}',
    'sleep.durationBlocks':
        '{count, plural, one {# block} other {# blocks}}',
    'tokenDetail.fileCount':
        '{count, plural, one {# file} other {# files}}',

    // --- errors ---------------------------------------------------
};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull this dictionary as a
// code-split chunk. The named `en` export stays for existing consumers.
export default en;
