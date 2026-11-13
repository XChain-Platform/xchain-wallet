// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `tokenMarket.*` keys: the market rows on the coin
// and token detail page (TokenMarketRows).

import { addEnglish } from '../../store.js';

const messages = {
    'tokenMarket.label': 'Market',
    'tokenMarket.price': 'Price',
    'tokenMarket.priceDex': 'Price (DEX)',
    'tokenMarket.change24h': '24h change',
    'tokenMarket.high24h': '24h high',
    'tokenMarket.low24h': '24h low',
    'tokenMarket.marketCap': 'Market cap',
    'tokenMarket.volume24h': '24h volume',
    'tokenMarket.source': 'Price source',
    'tokenMarket.sourceAge': '{source}, {when}',
    'tokenMarket.sourceCoinGecko': 'CoinGecko',
    'tokenMarket.sourceDex': 'XChain DEX trades',
    'tokenMarket.sourceSample': 'Sample data',
    'tokenMarket.loading': 'Loading',
    'tokenMarket.none': 'No market data for this network',
    'tokenMarket.noTrades': 'No DEX trades yet',
    'tokenMarket.loadFailed': "Couldn't be read just now",
    'tokenMarket.disabled': 'Off in Settings, Privacy',
    'tokenMarket.dispenser': 'Dispenser',
    'tokenMarket.sellOrder': 'DEX sell order',
    'tokenMarket.buyOrder': 'DEX buy order',
    'tokenMarket.orderTerms': '{give} for {get}',
    'tokenMarket.tradesOn': 'Trades on',
    'tokenMarket.tradesOnNone': 'No open orders or dispensers',
    'tokenMarket.dispenserCount': '{count, plural, one {# dispenser} other {# dispensers}}',
    'tokenMarket.orderCount': '{count, plural, one {# DEX order} other {# DEX orders}}',
    'tokenMarket.countJoin': '{a}, {b}',
    'tokenMarket.openDex': 'Open DEX market',
    'tokenMarket.openDispensers': 'Open dispensers',
};

addEnglish(messages);

export default messages;
