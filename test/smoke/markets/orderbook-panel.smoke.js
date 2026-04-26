// Phase 3 Step 4 smoke — Orderbook panel (§41.3.2).
//
// Runtime coverage of normalizeOrderbook (pure) + static wiring
// checks for OrderbookPanel (polling cadence, visibilitychange
// pause, click-to-prefill).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeOrderbook } from '../../../packages/core/src/market/orderbook.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. normalizeOrderbook handles empty + wrapped shapes -------

const empty = normalizeOrderbook(null);
assert.deepEqual(empty.bids, []);
assert.deepEqual(empty.asks, []);
assert.equal(empty.maxCumulative, 0);

// Explorer default shape: [{ asks, bids, market }]
const wrapped = normalizeOrderbook([{
    asks: [['0.0010', '50'], ['0.0012', '100']],
    bids: [['0.0008', '200'], ['0.0009', '50']],
}]);
assert.equal(wrapped.asks.length, 2);
assert.equal(wrapped.bids.length, 2);

// Also accepts the un-wrapped shape (future-compat).
const plain = normalizeOrderbook({
    asks: [['0.0010', '50'], ['0.0012', '100']],
    bids: [['0.0008', '200'], ['0.0009', '50']],
});
assert.equal(plain.asks.length, 2);
assert.equal(plain.bids.length, 2);

// --- 2. Sort orientation ---------------------------------------

// Bids sorted descending by price (best bid first = highest price).
assert.equal(wrapped.bids[0].price, 0.0009);
assert.equal(wrapped.bids[1].price, 0.0008);

// Asks sorted ascending by price (best ask first = lowest price).
assert.equal(wrapped.asks[0].price, 0.0010);
assert.equal(wrapped.asks[1].price, 0.0012);

// --- 3. Cumulative totals + depth bar input ---------------------

// Bids cumulative: 50 (0.0009), 250 (0.0008).
assert.equal(wrapped.bids[0].cumulative, 50);
assert.equal(wrapped.bids[1].cumulative, 250);
// Asks cumulative: 50 (0.0010), 150 (0.0012).
assert.equal(wrapped.asks[0].cumulative, 50);
assert.equal(wrapped.asks[1].cumulative, 150);
// maxCumulative is the larger of the two last cumulatives.
assert.equal(wrapped.maxCumulative, 250);

// --- 4. Display strings preserved ------------------------------

assert.equal(wrapped.bids[0].displayPrice, '0.0009',
    'price string preserved for precision');
assert.equal(wrapped.bids[0].displaySize, '50',
    'size string preserved for precision');

// --- 5. Mal-formed rows skipped --------------------------------

const mixed = normalizeOrderbook({
    bids: [['not-a-number', '50'], ['0.001', 'nope'], ['0.002', '100']],
    asks: [],
});
assert.equal(mixed.bids.length, 1, 'rows that fail Number() parse are dropped');
assert.equal(mixed.bids[0].price, 0.002);

// --- 6. Object-shape level row accepted ------------------------

const objShape = normalizeOrderbook({
    bids: [{ price: '0.01', amount: '10' }],
    asks: [{ price: '0.02', size: '20' }],
});
assert.equal(objShape.bids[0].price, 0.01);
assert.equal(objShape.asks[0].price, 0.02);

// --- 7. OrderbookPanel static wiring ---------------------------

const panelPath = join(core, 'src', 'shared', 'components', 'OrderbookPanel.jsx');
assert.ok(existsSync(panelPath), 'OrderbookPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function OrderbookPanel\b/.test(src),
    'OrderbookPanel is a named export');
assert.ok(/messaging\.getOrderbook\(/.test(src),
    'OrderbookPanel fetches via messaging.getOrderbook');
assert.ok(/normalizeOrderbook/.test(src),
    'OrderbookPanel normalises via the shared helper');
assert.ok(/POLL_INTERVAL_MS\s*=\s*5000/.test(src),
    'OrderbookPanel polls every 5s');
assert.ok(/document\.visibilityState === 'hidden'/.test(src),
    'OrderbookPanel pauses polling when the tab is hidden');
assert.ok(/onPickPrice\b/.test(src),
    'OrderbookPanel exposes onPickPrice for Place Order prefill');
assert.ok(/maxCumulative/.test(src)
    && /depthPct/.test(src),
    'OrderbookPanel renders a depth bar proportional to cumulative');

console.log(
    'OK — orderbook-panel smoke (normalizeOrderbook: wrapped + unwrapped shapes; bids descending + asks ascending; cumulative totals + maxCumulative across both sides; malformed rows dropped; display strings preserved for precision; OrderbookPanel fetches via messaging.getOrderbook + normalises + polls every 5s + pauses on visibilitychange + onPickPrice + depth-bar % of maxCumulative)',
);
