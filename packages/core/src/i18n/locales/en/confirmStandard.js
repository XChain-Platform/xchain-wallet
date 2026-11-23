// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `confirmStandard.*` keys: the one confirm page every
// action, message and transaction signs from (G127, the Confirm Standard).
// shared/utils/confirmStandardModel.js picks the lines and
// shared/components/ConfirmStandard.jsx draws them.

import { addEnglish } from '../../store.js';

// Shared with other screens rather than copied here: Approve
// (extension.connect.approve), From (send.fields.from), the message label
// (components.confirmActionModal.messageToSign), "Sign this message"
// (components.messageConfirmScreen.signThisMessage) and the irreversible
// notice's title (actionWarnings.title).
const messages = {
    // A fee that will be paid but whose amount is not known yet keeps its row
    // in the facts card instead of being left out.
    'confirmStandard.feeNotKnown': 'Not known yet',
    'confirmStandard.facts': 'Action details',
    'confirmStandard.fact.actionCode': 'Action code',
    'confirmStandard.fact.locks': 'Locks',
    // What leaves the wallet, when the action sentence does not say it.
    'confirmStandard.fact.youSend': 'You send',
    'confirmStandard.fact.assetRecipients.one': '{amount} to {count} recipient',
    'confirmStandard.fact.assetRecipients.other': '{amount} to {count} recipients',
    'confirmStandard.lockChip': '{what} locked',
    'confirmStandard.checking': 'Checking with the network…',
    'confirmStandard.change': 'Change',
    'confirmStandard.changeNone': 'None, under {amount} {ticker} goes to the fee',
    'confirmStandard.notRefunded': '{value}, not refunded if rejected',

    // The action sentence, for the kinds the decoder's own summary reads
    // less plainly than the operator's examples.
    'confirmStandard.sentence.sendTo': 'Send {amount} {tick} to',
    'confirmStandard.sentence.sendMany': 'Send {totals} to {count} recipients',
    'confirmStandard.sentence.assetCount': '{count} assets',
    'confirmStandard.sentence.issue': 'Issue a new token, {tick}',
    'confirmStandard.sentence.buy': 'Buy {get} for {give}',
    // A user-chosen name (a list's, a file's, a contract's) can be very long,
    // so it sits on its own line above these short fixed sentences (operator
    // 2026-11-16).
    'confirmStandard.sentence.publishFile': 'Publish as a public file',
    'confirmStandard.sentence.publishGatedFile': 'Publish as a gated file',
    // A list transfer names the list on its own line, never its raw id, and
    // the address under it is the new owner's (confirmStandard.newOwner).
    'confirmStandard.sentence.transferList': 'Transfer list to the new owner',
    'confirmStandard.sentence.transferThisList': 'Transfer this list to the new owner',
    'confirmStandard.sentence.shareList': 'Share list on every chain',
    'confirmStandard.newOwner': 'New owner',
    'confirmStandard.fact.list': 'List',
    'confirmStandard.fact.members': 'Members',
    'confirmStandard.sentence.signTransaction': 'Sign this transaction',
    'confirmStandard.sentence.unknownAction': 'Unknown action',
    'confirmStandard.sentence.review': 'Review this action',

    // The status notice, the first thing on the page: green only on the
    // indexer's own full approval, red for anything short of it.
    'confirmStandard.status.checked': 'Checked: this will go through.',
    'confirmStandard.status.unknownAction': 'Unknown action',
    'confirmStandard.status.unknownActionBody': "This wallet can't explain what this action does. Only approve it if you trust where it came from.",
    'confirmStandard.warning.fail': 'This will fail',
    'confirmStandard.warning.failUnexplained': 'The network check gave no reason.',
    'confirmStandard.warning.signAnyway': 'Tick Sign anyway to approve it.',
    'confirmStandard.warning.warn': 'Check this before you approve',
    'confirmStandard.warning.partial': 'Only partly checked',
    'confirmStandard.warning.partialBody': 'The network checked only part of this action, so the rest may still fail.',
    'confirmStandard.warning.partialBatch': 'The network confirmed {accepted} of {total} commands in this transaction. The rest carry no network approval.',
    'confirmStandard.warning.restricted': 'Only some of the checks could run for this action.',
    // A blue note, not a warning: the network approved, and the only checks
    // left are ones it makes when the action settles (operator 2026-11-17).
    'confirmStandard.settleChecks.title': 'Checked When It Settles',
    'confirmStandard.settleChecks.body': "The network approved this action. Some of this token's limits are checked when it settles.",
    // One short line, never a block: the status notice's title on its own.
    'confirmStandard.warning.notCheckedLine': 'Not checked with the network, so it may still fail.',
    // True whether the network was unreachable or answered but declined to
    // judge; the finding's own reason renders beneath it.
    'confirmStandard.warning.unreached': 'A network verdict was not reached, so only local checks ran.',
    'confirmStandard.warning.oracleFeesOwed': "This batch owes oracle usage fees the check can't confirm are covered. Check each amount owed before you approve.",

    // A blocking pre-flight finding disables Approve. Other incomplete steps
    // say why at the top of the page (G129) after a tap and send nothing.
    'confirmStandard.blocked.password': 'Enter your password to approve.',
    'confirmStandard.blocked.passwordField': 'Enter your password.',
    'confirmStandard.blocked.device': 'Connect and unlock your device to approve.',
    'confirmStandard.blocked.deviceConfirm': 'Tick that you checked the details on your device to approve.',
    'confirmStandard.blocked.checking': 'Wait for the network check to finish, then approve.',
    'confirmStandard.blocked.fails': "This will fail, so Approve won't send it.",
    'confirmStandard.blocked.signAnyway': 'Tick Sign anyway at the top to approve it.',
    'confirmStandard.blocked.offline': "You're offline. Reconnect to approve.",
    'confirmStandard.blocked.testSend': 'Choose how to handle the test send above, then approve.',
    'confirmStandard.blocked.wallet': 'Choose a wallet to approve with.',
    'confirmStandard.blocked.signInAddress': 'Choose the address to sign in with.',
    'confirmStandard.blocked.confirmStep': 'Finish the step above Approve, then approve.',
};

addEnglish(messages);

export default messages;
