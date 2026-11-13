// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `market.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'market.reversePair': 'Reverse pair to {pair}',
    'market.reverseTitle': 'Reverse to {pair}',
    'market.stats.high24h': '24h high',
    'market.stats.low24h': '24h low',
    'market.stats.volume24h': '24h vol',
    'market.notFound.title': 'Market not found',
    'market.notFound.body': 'It may have been closed or not indexed yet.',
    'market.summary': 'Market summary',
    'market.refreshPrices': 'Refresh Prices',
    'market.stalePrice': 'The latest trade is over 24 hours old. Check the price before placing an order.',
    'market.loading': 'Loading market',
    'market.panels': 'Market panels',
    'market.change24hLabel': '24-hour change. {change}',
    'market.loadFailed': "Couldn't load {list}.",
    'market.removeFromWatchlist': 'Remove from watchlist',
    'market.addToWatchlist': 'Add to watchlist',
    'market.rangeChangeLabel': '{range} change: {change}',
    'market.change24hShort': '24h {change}',
    'market.priceChartLabel': '{pair} price chart',
    'market.priceLabel': '{pair} price',
    'market.myOrders': 'My orders',
    'market.trade.title': 'Trade {pair}',
    'market.trade.loadFailed': "Couldn't load the {list}.",
    'market.trade.orThe': ' or the ',
    'market.trade.prices': 'Prices',
    'market.trade.last': 'Last',
    'market.trade.bestBid': 'Best bid',
    'market.trade.bestAsk': 'Best ask',
    'market.trade.mode': 'Trade mode',
    'market.trade.buying': 'Buying',
    'market.trade.selling': 'Selling',
    // The swap ticket's chip names; a pair can hold the network coin, so they say asset.
    'market.trade.payAsset': 'Pay asset',
    'market.trade.getAsset': 'Get asset',
};

addEnglish(messages);

export default messages;
