// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `mySwaps.*` keys: the My Swaps list row and the Swap
// Details page. Words another namespace already holds (Give, Get, Open,
// Cancelled, Status, Network, From, Transaction, the list labels, None,
// Activity, View on Explorer, Edit Swap, Cancel Swap) reuse that key, so
// each English text has one key. Every module that renders one of these keys
// imports this file, so the copy arrives with that module's chunk.

import { addEnglish } from '../../store.js';

const messages = {
    // A list row's name for a screen reader, and its swap number.
    'mySwaps.row.open': 'Open swap #{index}: give {give}, get {get}, {status}',
    'mySwaps.row.index': '#{index}',
    // The ring layout (wallet-orders-layout-1-ring): the row's trade in
    // words, its second line, and the fill ring's accessible name.
    'mySwaps.row.title': 'Swap {amount}',
    'mySwaps.row.for': 'for {amount}',
    'mySwaps.ring.filled': '{percent}% filled',
    // The Swap Details header and its Actions list (G101).
    'mySwaps.detail.swapping': 'Swapping',
    'mySwaps.detail.matches': 'Matches',
    'mySwaps.detail.placed': 'Placed',
    'mySwaps.actions.label': 'Swap actions',
    'mySwaps.actions.edit': 'Edit swap',
    // An action row's one-line description (G101), a phrase with no full stop.
    'mySwaps.actions.editDetail': 'Change the expiry or the allow and block lists',
    'mySwaps.actions.explorerDetail': "The swap's transaction",
    'mySwaps.actions.copyFailed': 'Copy failed: the clipboard is unavailable',
    'mySwaps.actions.cancel': 'Cancel swap',
    'mySwaps.actions.cancelDetail': 'Returns the {amount} still escrowed',
    // Status chip words no other namespace holds.
    'mySwaps.status.settled': 'Settled',
    // A cancelled swap reads Closed and a cancel in flight Closing (operator
    // 2026-11-14): short words keep the ring's status column narrow.
    'mySwaps.status.closed': 'Closed',
    'mySwaps.status.cancelling': 'Closing',
    'mySwaps.status.expired': 'Expired',
    'mySwaps.status.invalid': 'Invalid',
    // The Swap Details page.
    'mySwaps.detail.title': 'Swap Details',
    'mySwaps.detail.loading': 'Loading swap',
    'mySwaps.detail.notFoundTitle': 'Swap not found',
    'mySwaps.detail.notFoundBody': 'It may not be indexed yet. Go back and open it again in a moment.',
    'mySwaps.detail.copyTransaction': 'Copy transaction ID',
    'mySwaps.detail.listIndex': 'List #{index}',
};

addEnglish(messages);

export default messages;
