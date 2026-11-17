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
    // The Market page's header filter and explorer button (operator 2026-11-13).
    'market.filter.label': 'Filter market',
    // The search placeholder, Open and Filled reuse routes.addressList.search,
    // settings.developer.open and components.openOrdersPanel.filled.
    'market.filter.searchBook': 'Search the book by price or size',
    'market.filter.searchTrades': 'Search trades by price, amount or transaction',
    'market.filter.searchOrders': 'Search your orders by price, amount or transaction',
    'market.filter.orderStatus': 'Order status',
    'market.filter.allOrders': 'All orders',
    'market.filter.noMatches': 'No rows match the search.',
    'market.filter.noOrders': 'No orders on this market yet.',
    'market.openOnExplorer': 'Open this market on the explorer',
    'market.listRegion': 'Markets',
    'market.resizeList': 'Resize the market list',
    'market.resizeListHint': 'Drag to resize the market list, or press Enter to reset.',
    'market.trade.title': 'Trade {pair}',
    'market.trade.loadFailed': "Couldn't load the {list}.",
    'market.trade.orThe': ' or the ',
    'market.trade.buying': 'Buying',
    'market.trade.selling': 'Selling',
    // The swap ticket's chip names; a pair can hold the network coin, so they say asset.
    'market.trade.payAsset': 'Pay asset',
    'market.trade.getAsset': 'Get asset',
    // The Trade page's one action and the summary line above it, in every mode.
    'market.trade.placeOrder': 'Place Order',
    'market.trade.pillBuy': 'BUY',
    'market.trade.pillSell': 'SELL',
    'market.trade.summarySwapBuy': 'Buying {amount} for {value}',
    'market.trade.summarySwapSell': 'Selling {amount} for {value}',
    'market.trade.summaryLimitBuy': 'Buying {amount} at {price} each, for {value}',
    'market.trade.summaryLimitSell': 'Selling {amount} at {price} each, for {value}',
    'market.trade.summaryMarketBuy': 'Buying {amount} now at the best ask, for about {value}',
    'market.trade.summaryMarketSell': 'Selling {amount} now at the best bid, for about {value}',
    // The Market price field's hint: the side's best quote fills at once.
    'market.trade.bestAskFillsNow': 'Best ask, fills now',
    'market.trade.bestBidFillsNow': 'Best bid, fills now',
};

addEnglish(messages);

export default messages;
