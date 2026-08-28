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
// Keys live in a flat object so collisions are lint-time errors, not
// runtime surprises. Dotted keys (`home.lock`) express scope.
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
    'common.cancel': 'Cancel',
    'common.next': 'Next',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.confirmPassword': 'Confirm password',

    // --- branding -------------------------------------------------
    'brand.productName': 'XChain Wallet',
    'brand.tagline': 'The self-custodial wallet for the XChain Platform.',

    // --- session / lock -------------------------------------------
    'session.locked': 'Wallet locked.',
    'session.unlock': 'Unlock',
    'session.lock': 'Lock',
    'session.incorrectPassword': 'Incorrect password.',

    // --- home -----------------------------------------------------
    'home.noWallets': 'No wallets found.',
    'home.loadingBalances': 'Loading balances…',
    'home.noAddresses': 'No addresses yet. Use Receive to generate one.',
    'home.send': 'Send',
    'home.receive': 'Receive',
    'home.balanceUnavailable': 'Balance unavailable: {reason}',
    'home.addressCount': '{count, plural, one {# address} other {# addresses}}',

    // --- onboarding ----------------------------------------------
    'onboarding.create': 'Create a new wallet',
    'onboarding.import': 'I already have a wallet',
    'create.title': 'Create a new wallet',
    'create.passwordHelp':
        "Your password encrypts the wallet on this device. If you forget it, use the recovery phrase on the next screen to restore access. It cannot be recovered any other way.",
    'create.walletName': 'Wallet name',
    'create.passwordMinHint': 'At least {min} characters.',
    'create.passwordMismatch': 'Passwords do not match.',
    'create.mnemonicTitle': 'Write down your recovery phrase',
    'create.mnemonicHelp':
        'These twelve words are the ONLY way to recover your wallet if you lose access to this device. Write them down on paper and store them somewhere safe. Never type them into a website, email, or photo.',
    'create.mnemonicAck':
        'I have written down my recovery phrase and stored it safely.',
    'create.createWallet': 'Create wallet',
    'create.failed': 'Failed to create wallet.',

    'import.title': 'Import an existing wallet',
    'import.help':
        'Enter a BIP39 recovery phrase (12, 15, 18, 21, or 24 words) or a Counterwallet 12-word mnemonic. The format is detected automatically.',
    'import.phrase': 'Recovery phrase',
    'import.phraseRequired': 'Recovery phrase is required.',
    'import.wordCount':
        'Expected 12, 15, 18, 21, or 24 words (got {count}).',
    'import.failed': 'Failed to import wallet.',
    'import.submit': 'Import',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.review': 'Review & Send',
    'send.pickSourceFirst': 'Pick a source address first.',
    'send.destinationRequired': 'Destination address is required.',
    'send.tickRequired': 'Token ticker is required.',
    'send.amountPositive': 'Amount must be a positive number.',
    'send.memoForbiddenChars': 'Memo cannot contain | or ; characters.',
    'send.passwordHint': 'Required to sign.',
    'send.sent': 'Sent',
    'send.txid': 'Transaction ID',
    'send.noAddresses':
        'No addresses on any chain yet. Use Receive to generate one.',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'It is already in your history. It may still read "Broadcast, '
        + 'awaiting network" for up to a minute before the network reports it.',
    'send.failed': 'Send failed.',

    // --- extension banner ----------------------------------------
    'extBanner.detected': 'XChain Wallet extension detected.',
    'extBanner.hint':
        'Your extension wallet is ready. Click its icon in the browser toolbar to open it.',
    'extBanner.dismiss': 'Dismiss',

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
    'scan.pasteLabel': 'Or paste a payload',
    'scan.pastePlaceholder': 'xchain:… / bitcoin:… / address / transaction hex',
    'scan.classifyPaste': 'Classify pasted payload',
    'scan.error.pasteEmpty': 'Paste a payload first.',
    'scan.error.unknownXchainIntent':
        'xchain: URI was scanned but the intent was not recognized. Try a clearer code.',
    'scan.error.wif':
        'A private key (WIF) was scanned. Use Import Wallet → Import WIF to add it deliberately.',
    'scan.error.mnemonic':
        'A recovery phrase was scanned. Use Import Wallet → Recovery phrase to add it deliberately.',
    'scan.error.xcwChunk':
        'Multi-frame transaction chunk {n}/{total}. Open the Sign panel to capture every frame.',
    'scan.error.unknown':
        'Scanned content was not recognized ({type}). Try a clearer code.',

    // --- pending (unconfirmed) transactions -----------------------
    // Terminology is fixed: "pending" in every string a user reads,
    // "unconfirmed" only in data and method names. Nothing here may say
    // confirmed or accepted either, because a mempool sighting is
    // pre-validation: the indexer can still reject the action when the
    // block lands, and copy that promises otherwise is a lie the wallet
    // has no way to take back.
    'pending.row.awaitingNetwork': 'awaiting network',
    'pending.row.seen': 'pending',
    'pending.row.notSeen': 'not seen by network',
    'pending.row.dropped': 'no longer in mempool',
    'pending.row.replaced': 'replaced',
    'pending.row.generic': 'pending',

    'pending.detail.sectionLabel': 'Pending transaction',
    'pending.detail.awaitingNetwork': 'Broadcast, awaiting network',
    'pending.detail.seen': 'In the mempool, waiting for a block',
    'pending.detail.notSeen': 'Not seen by the network',
    'pending.detail.dropped': 'No longer in the mempool',
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
    'pending.detail.notValidated': 'Pending, not yet validated by the indexer.',
    'pending.detail.firstSeen': 'First seen by the network {when}',
    'pending.detail.broadcastAt': 'Broadcast from this wallet {when}',
    'pending.detail.replacementTx': 'Replacement transaction: {txHash}',
    'pending.detail.decodedHeading': 'What this transaction does',
    'pending.detail.sendOutput': '{amount} {tick} to {destination}',
    'pending.detail.memo': 'Memo: {memo}',
    'pending.detail.undecodable':
        'This wallet does not read {action} data. The fields below are shown exactly as the network carries them.',
    'pending.detail.localRecordNote':
        'Taken from this wallet\'s own record of the send. The network has not reported the transaction data yet.',
    'pending.detail.noData': 'No action data has been reported for this transaction yet.',

    // --- errors ---------------------------------------------------
    'error.vaultClosed': 'Wallet is locked. Unlock to continue.',
    'error.genericLoad': 'Failed to load.',
};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull this dictionary as a
// code-split chunk. The named `en` export stays for existing consumers.
export default en;
