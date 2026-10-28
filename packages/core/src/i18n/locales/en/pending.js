// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `pending.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
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
    'pending.detail.replacedElsewhere': 'Replaced',
    'pending.detail.awaitingNetworkHelp':
        'The transaction has been sent. It can take a minute before the network reports it.',
    'pending.detail.seenHelp':
        "The network has this transaction, but it's still waiting to be added to its permanent record.",
    'pending.detail.notSeenHelp':
        "The network hasn't reported this transaction since it was sent, so it may never have arrived.",
    'pending.detail.droppedHelp':
        "The network reported this transaction earlier but no longer does, and it isn't in the permanent record.",
    'pending.detail.replacedHelp':
        'This wallet replaced this transaction with a newer one. Follow the replacement instead.',
    'pending.detail.replacedElsewhereHelp': "Another transaction spent the same coins. This one won't confirm.",
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
    'pending.detail.localRecordNoteIn':
        "Taken from this wallet's own record of the incoming transfer. The network hasn't reported the transaction data yet.",
    'pending.detail.localRecordNoteSelf':
        "Taken from this wallet's own record of the transfer. The network hasn't reported the transaction data yet.",
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

addEnglish(messages);

export default messages;
