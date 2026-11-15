// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `txTimeline.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'txTimeline.transactionConfirmed': 'Transaction confirmed.',
    'txTimeline.transactionStatus': 'Transaction status',
    'txTimeline.fullyProcessedAtBlock': 'Fully processed · the service has reached block {block, number}',
    'txTimeline.confirmedAtBlock': 'Confirmed at block {block, number}',
    'txTimeline.mempool.seenLabel': 'Held by the network',
    'txTimeline.mempool.seenSub': 'A node is holding it, waiting for a miner to include it in a block',
    'txTimeline.mempool.awaitingNetworkSub': 'Sent. No node has reported holding it yet, which can take a minute',
    'txTimeline.mempool.notSeenSub': 'No node has reported holding this transaction. It may not have reached the network',
    'txTimeline.mempool.failedLabel': 'Failed',
    'txTimeline.mempool.droppedSub': 'The network stopped reporting this transaction and it did not confirm',
    'txTimeline.mempool.replacedLabel': 'Replaced',
    'txTimeline.mempool.replacedSub': 'You replaced this transaction with a higher-fee version',
    'txTimeline.mempool.localFailureSub': "This send did not reach the network. Review the failure reason in this transaction's details, correct the problem, and try again",
    'txTimeline.mempool.acceptedLabel': 'Accepted',
    'txTimeline.mempool.acceptedSub': 'Picked up when the block was mined',
    'txTimeline.mempool.pendingBroadcastLabel': 'Pending broadcast',
    'txTimeline.signed.label': 'Signed',
    'txTimeline.signed.approved': 'Approved and signed',
    'txTimeline.signed.notReached': 'Not reached: the send failed first',
    'txTimeline.signed.waiting': 'Waiting for you to approve and sign',
    'txTimeline.broadcast.label': 'Broadcast',
    'txTimeline.broadcast.neverSent': 'Never sent',
    'txTimeline.broadcast.notSentYet': 'Not sent yet',
    'txTimeline.confirmed.label': 'Confirmed',
    'txTimeline.processed.label': 'Processed',
    'txTimeline.processed.noAction': 'The service records no action for this transaction',
    'txTimeline.processed.catchingUp': 'The service is still catching up to this block',
    'txTimeline.processed.searchable': 'Fully processed and searchable',
    'txTimeline.processed.waitingToConfirm': 'Waiting to confirm before it can be processed',
    'txTimeline.state.complete': 'Complete',
    'txTimeline.state.currentFailed': 'Current stage: Failed',
    'txTimeline.state.current': 'Current stage',
    'txTimeline.state.notStarted': 'Not started',
};

addEnglish(messages);

export default messages;
