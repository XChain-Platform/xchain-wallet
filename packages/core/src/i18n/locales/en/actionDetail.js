// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `actionDetail.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- action routes -------------------------------------------
    'actionDetail.back': 'Back to history',
    'actionDetail.title': 'Action',
    'actionDetail.empty.title': 'No action selected',
    'actionDetail.empty.body': 'Action details appear here after one is selected.',
    'actionDetail.offline':
        'You are offline. Showing saved action details. Network actions will be available when your connection returns.',

    // --- Actions tab: the action list (G101, G102, 2026-11-13) ---
    'actionDetail.actions.label': 'Actions for this transaction',
    'actionDetail.actions.speedUp': 'Speed up',
    'actionDetail.actions.speedingUp': 'Speeding up…',
    'actionDetail.actions.speedUpDescription': 'Send it again with a higher fee so it confirms sooner',
    'actionDetail.actions.dismissFailed': 'Remove from history',
    'actionDetail.actions.dismissFailedDescription': 'Clear this failed send from your history',
    'actionDetail.actions.viewDispenser': 'View dispenser',
    'actionDetail.actions.viewDispenserDescription': 'Open the dispenser this action created',
    'actionDetail.actions.openNewWindow': 'Open in new window',
    'actionDetail.actions.openNewWindowDescription': 'Keep this action open in its own window',
    'actionDetail.actions.viewOnExplorer': 'View on the explorer',
    'actionDetail.actions.viewOn': 'View on {explorer}',
    'actionDetail.actions.explorerDescription': 'See this transaction on a block explorer',
    'actionDetail.actions.shareReceipt': 'Share receipt',
    'actionDetail.actions.shareReceiptDescription': 'Share the public facts of this transaction',
    'actionDetail.actions.copyReceipt': 'Copy receipt',
    'actionDetail.actions.copyReceiptDescription': 'Copy the public facts of this transaction',
    'actionDetail.actions.saveContact': 'Save as contact',
    'actionDetail.actions.saveContactDescription': "Save the other party's address to your contacts",
    'actionDetail.actions.cancelTransaction': 'Cancel transaction',
    'actionDetail.actions.cancelling': 'Cancelling…',
    'actionDetail.actions.cancelDescription': 'Send the coins back to this wallet before it confirms',
    'actionDetail.receipt.shareTitle': 'XChain transaction receipt',
    'actionDetail.receipt.copied': 'Transaction receipt copied.',
    'actionDetail.receipt.shareUnavailable': 'Sharing is unavailable.',

    // --- hero and status bar -------------------------------------
    'actionDetail.hero.to': 'Sent to',
    'actionDetail.hero.from': 'Received from',
    'actionDetail.hero.source': 'Made from',
    'actionDetail.status.label': 'Transaction Status',
    'actionDetail.status.confirmed': 'Transaction confirmed',
    'actionDetail.step.signed': 'Signed',
    'actionDetail.step.broadcast': 'Broadcast',
    'actionDetail.step.processed': 'Processed',
    'actionDetail.step.dropped': 'Dropped',
    'actionDetail.step.notSeen': 'Not Seen',
    'actionDetail.stepState.done': 'Complete',
    'actionDetail.stepState.current': 'In Progress',
    'actionDetail.stepState.todo': 'Not Started',
    'actionDetail.stepState.problem': 'Stopped',

    // --- Actions | Details ----------------------------------------
    'actionDetail.view.label': 'Action View',
    'actionDetail.field.verification': 'Verification',
    'actionDetail.field.firstSeen': 'First seen',
    'actionDetail.field.broadcastAt': 'Broadcast time',
    'actionDetail.field.replacement': 'Replacement transaction',
    'actionDetail.field.failureDetails': 'Failure details',
    'actionDetail.field.output': 'Output {number}',
    'actionDetail.output.amountTo': '{amount} {tick} to',
    'actionDetail.help.networkFee': 'What the network charged to include this transaction in a block, paid in the network coin.',
    'actionDetail.help.total': 'The amount plus the network fee: everything this transaction took from the wallet.',
    'actionDetail.contact.help': 'The name this address is saved under in your contacts.',
    'actionDetail.contact.nameRequired': 'Name is required.',
};

addEnglish(messages);

export default messages;
