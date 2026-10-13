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

    // --- send -----------------------------------------------------
    'send.memoForbiddenChars': 'Memo cannot contain | or ; characters.',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'It is already in your history. It may still read "Broadcast, '
        + 'awaiting network" for up to a minute before the network reports it.',

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
    'scan.error.wif':
        'A private key (WIF) was scanned. Use Import Wallet → Import WIF to add it deliberately.',
    'scan.error.mnemonic':
        'A recovery phrase was scanned. Use Import Wallet → Recovery phrase to add it deliberately.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        'A signed transaction was scanned. This screen cannot broadcast raw transaction hex. Use a compatible broadcasting tool.',
    'scan.error.backupPointer':
        'A backup pointer was scanned. Start Import Wallet, choose Restore from backup, and scan it there.',
    'scan.error.pairingCode':
        'A wallet pairing code was scanned. Start Pair a watcher or signer, and scan it there.',
    'scan.error.unknown':
        'This QR code contains text the wallet does not know how to use.',

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
        'This wallet could not complete the send. Nothing was broadcast, so no coins moved and no fee was paid. You can send again.',
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
        'This wallet does not read {action} data. The fields below are shown exactly as the network carries them.',
    'pending.detail.localRecordNote':
        'Taken from this wallet\'s own record of the send. The network has not reported the transaction data yet.',
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

};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull this dictionary as a
// code-split chunk. The named `en` export stays for existing consumers.
export default en;
