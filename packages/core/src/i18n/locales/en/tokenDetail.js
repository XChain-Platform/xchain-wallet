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
    'tokenDetail.actions.needsNetwork': 'needs a network connection.',
    'tokenDetail.actions.needsBalance': 'needs a balance of {tick}.',
    'tokenDetail.actions.needsPrice': 'needs a current price.',
    'tokenDetail.actions.needsSigner': 'needs a wallet that can sign; another phone signs for this one.',
    'tokenDetail.actions.empty': 'No actions are available for this asset.',
    'tokenDetail.actions.stopWatching': 'Stop watching',
    'tokenDetail.actions.listSaveFailed': "Couldn't save this change. Try again.",
    // The one line under each action row's title (G101).
    'tokenDetail.actionDescriptions.stopWatching': 'Remove {tick} from your watched tokens',
    'tokenDetail.actionDescriptions.pin': 'Keep {tick} first in Balances',
    'tokenDetail.actionDescriptions.unpin': 'Stop keeping {tick} first in Balances',
    'tokenDetail.actionDescriptions.hide': 'Collapse {tick} under Show hidden',
    'tokenDetail.actionDescriptions.unhide': 'Show {tick} in Balances again',
    'tokenDetail.actionDescriptions.send': 'Send {tick} to an address or contact',
    'tokenDetail.actionDescriptions.receive': 'Show an address that gets {tick}',
    'tokenDetail.actionDescriptions.exchange': 'Trade {tick} on the market',
    'tokenDetail.actionDescriptions.priceAlert': 'Get an alert when the {tick} price moves',
    'tokenDetail.actionDescriptions.manage': 'Mint, lock, distribute and more for {tick}',
    'tokenDetail.actionDescriptions.destroy': 'Burn part of your {tick} for good',
    'tokenDetail.actionDescriptions.sweep': 'Move every balance from one address to another',
    'tokenDetail.actionDescriptions.dispenser': 'Sell {tick} from a dispenser at your price',
    'tokenDetail.actionDescriptions.dispenserExplorer': 'Find open dispensers that sell {tick}',
    'tokenDetail.actionDescriptions.airdrop': 'Send {tick} to a list of addresses',
    'tokenDetail.actionDescriptions.swap': 'Trade {tick} for another token in one step',
    'tokenDetail.actionDescriptions.crossChainSwap': 'Trade {tick} for a token on another chain',
    'tokenDetail.actionDescriptions.bridgeMove': 'Move {tick} to another chain',
    'tokenDetail.actionDescriptions.mint': 'Add new {tick} supply',
    'tokenDetail.actionDescriptions.lock': 'Lock {tick} settings for good',
    'tokenDetail.actionDescriptions.description': 'Change the on-chain description of {tick}',
    'tokenDetail.actionDescriptions.transfer': 'Hand ownership of {tick} to another address',
    'tokenDetail.actionDescriptions.oracle': 'Publish what {tick} is worth in a currency',
    'tokenDetail.actionDescriptions.dividend': 'Pay every {tick} holder by their share',
    'tokenDetail.actionDescriptions.bridgeSettings': 'Choose the chains {tick} can move to',
    // The hero chart's name: a price line, the holding's value, or the balance.
    'tokenDetail.chart.price': 'Price chart',
    'tokenDetail.chart.value': 'Value chart',
    'tokenDetail.chart.balance': 'Balance chart',
    'tokenDetail.chart.balanceTrend': 'Balance trend',
    'tokenDetail.chart.valueTrend': 'Value trend',
    'tokenDetail.hero.value': 'Value',
    'tokenDetail.hero.balance': 'Balance',
    'tokenDetail.hero.showBalance': 'Show balance in {unit}',
    'tokenDetail.hero.showValue': 'Show value in {unit}',
    'tokenDetail.chart.valueOver': 'Value over {range}',
    'tokenDetail.chart.balanceOver': 'Balance over {range}',
    // The issuer's facts in the Details card.
    'tokenDetail.details.supplyCap': 'Supply cap',
    'tokenDetail.details.lockRow': '{name} lock',
    'tokenDetail.details.state': 'State',
};

addEnglish(messages);

export default messages;
