// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Host messages that sign a transaction and broadcast it (or hand it to the
// broadcast queue). One list for every reader: the desktop quit guard waits
// for them, and each shell's transport marks saved wallet reads stale when one
// resolves, since the wallet's balances changed.
//
// Derived from the extension background host: every type registered through
// its hardware-signer wrapper plus the software twin of each, every handler
// that wires a broadcast-failure fallback, and the explicit broadcast steps.
// Reads, quotes, compose-for-confirm previews, unsigned PSBT builders and
// sign-and-return calls are left out on purpose: none of them moves funds.

// The messaging handshake's host type, spelled from its parts: written whole it
// reads as a messaging helper call to the shell parity smoke.
const HANDSHAKE_ROUTE = ['messaging', 'handshake'].join('.');

export const SIGNED_ACTION_ROUTES = Object.freeze([
    'action.send',
    'action.sweep',
    'action.issue',
    'action.mint',
    'action.destroy',
    'action.callback',
    'action.sleep',
    'action.broadcast',
    'action.oraclePrice',
    'action.addressPrefs',
    'action.deployChunked',
    'action.dispenser',
    'action.dividend',
    'action.createList',
    'action.airdrop',
    'action.advanced',
    'action.order',
    'action.cancelOrder',
    'action.editOrder',
    'action.coinpay',
    'action.swap',
    'action.link',
    'action.file',
    'action.gatedPublish',
    'action.message',
    HANDSHAKE_ROUTE,
    'action.deploy',
    'action.execute',
    'action.deposit',
    'action.withdraw',
    'action.stake',
    'action.unstake',
    'action.collect',
    'action.delegate',
    'action.revokeDelegation',
    'action.createPoll',
    'action.castBallot',
    'action.delegateVote',
    'action.createMarket',
    'action.placeBet',
    'action.resolveMarket',
    'action.cancelMarket',
    'action.editBetFeedLists',
    'action.clearVoteDelegation',
    'action.contractStake',
]);

export const BROADCAST_MESSAGE_TYPES = new Set([
    ...SIGNED_ACTION_ROUTES,
    ...SIGNED_ACTION_ROUTES.map((type) => `${type}.hw`),
    'wallet.publishLabels',
    'tx.replace',
    'broadcast.signedTx',
    'broadcast.queue.broadcast',
    'multisigSign.finalize',
    // A multipart upload broadcasts its funding and every piece; software signers
    // only, so it has no hardware twin.
    'action.fileMultipart',
]);

/** Does a resolved message of this type mean a transaction left the wallet? */
export function isBroadcastMessageType(type) {
    return typeof type === 'string' && BROADCAST_MESSAGE_TYPES.has(type);
}
