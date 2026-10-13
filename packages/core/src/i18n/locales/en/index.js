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
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',

    // --- home -----------------------------------------------------
    'home.receive': 'Receive',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.review': 'Review & Send',
    'send.backToEdit': 'Back to edit',
    'send.memoForbiddenChars': "Memo can't contain | or ; characters.",
    'send.passwordHint': 'Required to sign.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First send to this address. Test it first?',
    'send.testGate.body':
        "You're sending {amount} {ticker} to a new recipient. A small test send confirms the address works before the full amount goes out.",
    'send.testGate.sendSmall': 'Send a small test first',
    'send.testGate.continue': "I've verified, continue",
    'send.signerMode':
        "This wallet is in signer mode, so it doesn't send or broadcast. It signs transactions passed in from a watcher wallet. Switch the mode under Settings, Wallet Mode to send from this device.",
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
    'send.queued.body':
        "Your transaction is signed but couldn't reach the network just now. It's waiting in the queued-transactions banner and won't go out until you broadcast it from there; the wallet reminds you when the network is back. Don't send this payment again.",
    'send.success.broadcastPending': 'Broadcast pending',
    'send.success.broadcastPendingBody':
        'Your transaction is on its way. It will confirm in the next few blocks; you can leave this screen at any time.',
    'send.success.copyTransactionId': 'Copy transaction id',
    'send.success.copy': 'Copy',
    'send.success.viewOnExplorer': 'View on explorer',
    'send.success.sendAnother': 'Send another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    'send.fields.chain': 'Chain',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.reviewLabel': 'Review send',
    'send.review.createUnsigned': 'Create unsigned transaction',
    'send.review.signOn': 'Sign on {device}',
    'send.review.sign': 'Sign',
    'send.review.submitAction': '{label}: send',
    'send.memoCount': '{used} / {max} characters',
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
        'This send moves more than one token, and the balance preview covers a single token at a time. Every recipient and amount is listed under Details below.',
    'send.review.details': 'Details ({count})',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherMode':
        'Watcher mode: this wallet will build an unsigned transaction instead of signing and broadcasting. Bring the result to your Signer-mode wallet to sign.',
    'send.watcherHardware':
        "Source address is paired to {device} on this wallet, but watcher mode doesn't sign here. Pair the same {device} on your Signer-mode wallet to sign the transaction this step produces.",
    'send.walletUnlocked': 'Wallet unlocked. No password needed.',
    'send.useMax': 'Use Max',
    'send.fromAddress': 'From address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished Send draft was saved. Restore it to continue. Nothing was submitted.',
    'send.draft.discardLabel': 'Discard saved draft',
    'send.draft.discard': 'Discard',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.noAddress': 'No address on this chain. Use Receive to generate one first.',
    'send.destination.placeholder': 'Enter or paste an address or name…',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save recipient',
    'send.saveRecipient.nameLabel': 'Contact name',
    'send.saveRecipient.save': 'Save contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': 'Tick. Native coin by default.',
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
        'Total: {total} across {count} recipients, in one transaction and one network fee.',
    'send.recipient.add': '+ Add recipient',
    'send.recipient.maximum':
        '{count} recipients is the most one send carries. Use an airdrop to distribute to a longer list.',
    'send.gated.ready':
        'This token has gated content. The unlock key will be securely attached to this send so the recipient can open it. Gated tokens can only be sent to addresses that have made at least one transaction.',
    'send.gated.partial':
        "This token has {total} gated content packs and this wallet holds keys for only {available} of them. The recipient won't be able to open the missing pack(s): {missing}… You can still send, or recover the missing keys first (unlock the content once from the address that received it).",
    'send.gated.blocked':
        'This token has gated content, and this wallet holds none of its unlock keys. Sending without the key attached would be rejected by the network, and the recipient could never open the content.',
    'send.gated.softwareSigner':
        "Key recovery needs a software signer (the scan decrypts messages with the address's private key, which this signer can't do). If this wallet published the content, the key is already stored and this notice won't appear; otherwise recover the key from a software wallet holding this address.",
    'send.gated.passwordLabel': 'Wallet password (scan for keys)',
    'send.gated.passwordHint':
        'Scans messages sent to your addresses for the unlock key and stores it in this wallet.',
    'send.gated.recover': 'Recover keys',
    'send.networkFee': 'Network fee',
    'send.advanced': 'Advanced',
    'send.memo': 'Memo',
    'send.rbf.label': 'Allow fee bumping (replace-by-fee)',
    'send.rbf.helpLabel': 'Replace-by-fee help',
    'send.rbf.help':
        'Allows this unconfirmed transaction to be replaced with one that pays a higher fee, so it can confirm sooner or be cancelled.',
    'send.rbf.enabledHint':
        'Allows this transaction to be sped up or cancelled with a higher fee before confirmation.',
    'send.rbf.unsupported': "Fee bumping isn't supported on {chain}.",
    'send.rbf.thisChain': 'this chain',
    'send.rbf.enabledLabel': 'Replace-by-fee enabled',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'It\'s already in your history. It may still read "Broadcast, '
        + 'awaiting network" for up to a minute before the network reports it.',

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
        'A private key (WIF) was scanned. Use Import Wallet → Import WIF to add it deliberately.',
    'scan.error.mnemonic':
        'A recovery phrase was scanned. Use Import Wallet → Recovery phrase to add it deliberately.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        "A signed transaction was scanned. This screen can't broadcast raw transaction hex. Use a compatible broadcasting tool.",
    'scan.error.backupPointer':
        'A backup pointer was scanned. Start Import Wallet, choose Restore from backup, and scan it there.',
    'scan.error.pairingCode':
        'A wallet pairing code was scanned. Start Pair a watcher or signer, and scan it there.',
    'scan.error.unknown':
        "This QR code contains text the wallet doesn't know how to use.",

    // --- history --------------------------------------------------
    'history.title': 'History',
    'history.refresh': 'Refresh history',
    'history.refreshing': 'Refreshing history',
    'history.showMore': 'Show more history',
    'history.itemsShown': '{shown} of {total} history items shown',
    'history.showMoreGroupEntries': 'Show more group entries ({shown} of {total} shown)',
    'history.recipients.noHoldersFound': 'No holders found',
    'history.recipients.noRecipientsFound': 'No recipients found',
    'history.recipients.noHoldersBody': 'Token holders appear here after balances are indexed.',
    'history.recipients.noRecipientsBody': 'Matching recipients appear here after history is indexed.',
    'history.loading': 'Loading history',
    'history.empty.noAddressesTitle': 'No addresses yet',
    'history.empty.noAddressesBody': 'Generate a receive address to populate history.',
    'history.empty.noMatchesTitle': 'No matches for the current filters',
    'history.empty.noSearchResultsTitle': 'No results for "{query}"',
    'history.empty.noMatchesBody': 'Adjust or clear the filters to see more history.',
    'history.empty.clearFilters': 'Clear filters',
    'history.empty.noCrossChainTitle': 'No cross-chain actions yet',
    'history.empty.noCrossChainBody':
        'Cross-chain transfers sent or received by this wallet appear here.',
    'history.empty.noActivityTitle': 'No activity yet',
    'history.empty.noActivityBody':
        'Once you send or receive on the selected chains, the activity feed populates.',
    'history.filters.label': 'History filters',
    'history.filters.searchPlaceholder': 'Search action, address, token, txid, memo…',
    'history.filters.searchLabel': 'Search history',
    'history.filters.clearSearch': 'Clear history search',
    'history.filters.fromDate': 'From date',
    'history.filters.toDate': 'To date',
    'history.filters.additionalDetails': 'Additional details',
    'history.filters.fiatHelp': 'Show the fiat equivalent for native-coin amounts',
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
    'history.contact.name': 'Contact name',
    'history.contact.save': 'Save',
    'history.copy.clipboard': 'Copy to clipboard',
    'history.copy.copied': 'Copied',
    'history.copy.copiedTitle': 'Copied!',
    'history.copy.actionNumber': 'Copy action number',
    'history.copy.transactionId': 'Copy transaction ID',
    'history.copy.fromAddress': 'Copy from address',
    'history.copy.walletAddress': 'Copy wallet address',
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
    'history.row.confirmations': '{count} Confirms',
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
    'pending.row.generic': 'pending',
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
        'A block carries this transaction. It moved coins only, so the service has no action to report for it.',
    'pending.detail.confirmedNoEffect': 'Confirmed, no effect',
    'pending.detail.confirmedNoEffectHelp':
        'A block carries this transaction, and the service recorded no action for it. Any coins it moved have moved; nothing else took effect.',
    'pending.detail.confirmedBlock': 'Included in block {block}',
    'pending.detail.awaitingNetwork': 'Broadcast, awaiting network',
    'pending.detail.seen': 'Held by the network, waiting for a block',
    'pending.detail.notSeen': 'Not seen by the network',
    'pending.detail.dropped': 'No longer seen by the network',
    'pending.detail.replaced': 'Replaced by a newer transaction',
    'pending.detail.awaitingNetworkHelp':
        'The transaction has been sent. It can take a minute before any node reports holding it.',
    'pending.detail.seenHelp':
        'A node is holding this transaction, and no miner has put it in a block yet.',
    'pending.detail.notSeenHelp':
        'Nothing has reported this transaction since it was broadcast, so it may never have reached the network.',
    'pending.detail.droppedHelp':
        'A node reported this transaction earlier and no longer does, and no block carries it yet.',
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

    // --- errors ---------------------------------------------------
};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull this dictionary as a
// code-split chunk. The named `en` export stays for existing consumers.
export default en;
