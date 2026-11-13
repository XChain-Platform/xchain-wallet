// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `tokenDetail.*` keys: the coin and token detail
// page's tabs and its Actions grid.

import { addEnglish } from '../../store.js';

const messages = {
    'tokenDetail.rangeChange': '{range} change. {change}',
    'tokenDetail.tabs.label': 'Coin or token view',
    'tokenDetail.tabs.actions': 'Actions',
    'tokenDetail.tabs.details': 'Details',
    'tokenDetail.tabs.history': 'History',
    'tokenDetail.history.label': '{tick} history',
    'tokenDetail.history.loading': 'Loading history',
    'tokenDetail.history.emptyTitle': 'No {tick} history yet',
    'tokenDetail.history.emptyBody': 'Sends, receives and other actions with {tick} appear here.',
    'tokenDetail.history.failedTitle': 'History is unavailable',
    'tokenDetail.history.failedBody': "It couldn't be read just now. Try again in a moment.",
    'tokenDetail.actions.label': 'Actions for {tick}',
    'tokenDetail.actions.send': 'Send',
    'tokenDetail.actions.receive': 'Receive',
    'tokenDetail.actions.exchange': 'Exchange',
    'tokenDetail.actions.priceAlert': 'Price alert',
    'tokenDetail.actions.explorerTitle': 'Open {tick} on the XChain explorer',
    'tokenDetail.actions.manage': 'Manage token',
    'tokenDetail.actions.ownerHeading': 'You issued this token',
    'tokenDetail.actions.reason': '{label}: {reason}',
    'tokenDetail.actions.needsNetwork': 'needs a network connection.',
    'tokenDetail.actions.needsBalance': 'needs a balance of {tick}.',
    'tokenDetail.actions.needsPrice': 'needs a current price.',
    'tokenDetail.actions.needsSigner': 'needs a wallet that can sign; this one is watch-only.',
    'tokenDetail.actions.watcherSend': "This wallet is watch-only and can't sign. Send from its paired signer.",
    'tokenDetail.actions.empty': 'No actions are available for this asset.',
};

addEnglish(messages);

export default messages;
