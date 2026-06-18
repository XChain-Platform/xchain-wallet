// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 4: priceLookup flow.

import { strict as assert } from 'node:assert';
import {
    getFiatRate,
    coinToFiat,
    fiatToCoin,
} from '../../../packages/core/src/flows/priceLookup.js';

// --- getFiatRate -------------------------------------------------------

const btc = getFiatRate({ chainCoin: 'bitcoin' });
assert.ok(btc);
assert.equal(btc.rate, 40000);
assert.equal(btc.chainCoin, 'bitcoin');
assert.equal(btc.fiatCurrency, 'USD');
assert.equal(btc.source, 'static-placeholder');
assert.match(btc.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);

const ltc = getFiatRate({ chainCoin: 'litecoin' });
assert.ok(ltc);
assert.equal(ltc.rate, 80);

const doge = getFiatRate({ chainCoin: 'dogecoin' });
assert.ok(doge);
assert.equal(doge.rate, 0.10);

// Unknown coin → null
assert.equal(getFiatRate({ chainCoin: 'monero' }), null);

// Non-USD currency → null (placeholder table is single-currency)
assert.equal(getFiatRate({ chainCoin: 'bitcoin', fiatCurrency: 'EUR' }), null);

// Missing args → null
assert.equal(getFiatRate({}), null);
assert.equal(getFiatRate({ chainCoin: '' }), null);

// --- coinToFiat --------------------------------------------------------

assert.equal(coinToFiat('1', btc), 40000);
assert.equal(coinToFiat('0.5', btc), 20000);
assert.equal(coinToFiat(0.001, btc), 40, 'numeric input accepted');
assert.equal(coinToFiat('not a number', btc), null);
assert.equal(coinToFiat('1', null), null);
assert.equal(coinToFiat('1', { rate: 'oops' }), null);

// --- fiatToCoin --------------------------------------------------------

assert.equal(fiatToCoin('40000', btc), '1');
assert.equal(fiatToCoin('20000', btc), '0.5');
assert.equal(fiatToCoin('100', doge), '1000', '$100 ÷ $0.10/DOGE = 1000 DOGE');
assert.equal(fiatToCoin('not a number', btc), null);
assert.equal(fiatToCoin('-5', btc), null, 'negative fiat → null');
assert.equal(fiatToCoin('40000', { rate: 0 }), null, 'zero rate → null');
assert.equal(fiatToCoin('40000', null), null);

// Round-trip with default 8-decimal precision
const round = fiatToCoin('1234.56', btc);
assert.match(round, /^0\.0308\d*/, 'preserves precision to 8 decimals');

console.log('price-lookup smoke OK');
