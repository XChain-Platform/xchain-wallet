// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `actionWarnings.*` keys: the confirm screen's notice
// of what a transaction does that cannot be taken back (flows/actionWarnings.js
// picks the lines), and its notice when pre-flight expects the network to
// record the transaction as invalid. Every module that renders one of these
// keys imports this file, so the copy arrives with that module's chunk.

import { addEnglish } from '../../store.js';

const messages = {
    'actionWarnings.title': 'Before you approve',
    // Each kind is a bold title plus one short line, its most important fact
    // (G127 revised 2026-11-16: the notice must not take over the confirm
    // page). The longer explanations live on the forms and their help.
    'actionWarnings.noUndo.title': "You can't undo this",
    'actionWarnings.listTransfer.newOwnerOnly': 'The new owner controls this list from this block on.',
    'actionWarnings.listShare.title': 'Sharing is permanent',
    'actionWarnings.listShare.permanent': 'There is no unshare.',
    'actionWarnings.tokenTransfer.newOwnerOnly': 'After it confirms, only the new owner can administer this token.',
    'actionWarnings.tokenLock.permanent': 'A locked setting can never be changed again.',
    'actionWarnings.destroy.permanent': 'Destroyed tokens are burned for good.',
    'actionWarnings.addressLock.title': 'This address will be locked',
    'actionWarnings.addressLock.noEarlyWake': 'Nothing can lift the lock before its resume block.',
    'actionWarnings.tokenPause.title': 'This pauses the token',
    'actionWarnings.tokenPause.transfersRejected': 'New XChain actions with this token are rejected until the resume block.',
    'actionWarnings.sweep.everythingMoves': "Everything in the selected categories moves, even items the preview didn't list.",
    'actionWarnings.controllerBind.title': 'A contract will gate this address',
    'actionWarnings.controllerBind.gates': "It can veto or gate this address's actions for the bound class.",
    'actionWarnings.controllerUnbind.title': 'The policy stays for now',
    'actionWarnings.controllerUnbind.cooldown': 'The controller policy stays in force until the cooldown ends.',
    'actionWarnings.dispenserClose.title': 'Closing takes an hour',
    'actionWarnings.dispenserClose.escrowReturns': 'The remaining escrow returns to the owner after the 1-hour close window.',
    'actionWarnings.delegationClear.title': 'Your delegate stops voting',
    'actionWarnings.delegationClear.stops': 'Once this confirms, your delegate no longer votes with your token weight.',
    'actionWarnings.callback.recallsAll': 'This recalls every unit from all holders at the callback terms.',
    'actionWarnings.marketCreate.title': 'Market terms are final',
    'actionWarnings.marketCreate.oracleDuty': "You're the oracle: resolve or cancel it, or bettors are refunded on your public record.",
    'actionWarnings.marketResolve.paysOut': 'Backers of this outcome split the pot, and everyone else loses their stake.',
    'actionWarnings.marketCancel.refundsAll': 'Every open bet is refunded in full and the market ends.',
    'actionWarnings.bridgeMove.noUndo': "It can't be redirected once it applies, so check the address and chain.",
    // The Cancel Order and Cancel Swap notes their forms used to show (G105).
    'actionWarnings.orderCancel.title': 'Cancelling closes the order',
    'actionWarnings.orderCancel.closes': 'Any escrowed side returns to you.',
    'actionWarnings.swapCancel.title': 'Cancelling closes the swap offer',
    'actionWarnings.swapCancel.closes': 'The escrowed side returns to you.',
    // A failed pre-flight speaks in the confirm page's status notice
    // (confirmStandard.warning.*, G127).
};

addEnglish(messages);

export default messages;
