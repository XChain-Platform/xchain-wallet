// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 2 smoke: Market view shell (§41.3).
//
// Scaffold check: MarketView renders the four-panel layout, reads
// market summary via messaging.getMarket, and wires into all three
// App.jsx shells' 'market' sub-route.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desk = join(wsRoot, 'packages', 'desktop');

// --- 1. Shared route exists --------------------------------------

const routePath = join(core, 'src', 'shared', 'routes', 'MarketView.jsx');
assert.ok(existsSync(routePath), 'MarketView.jsx exists');
const src = readFileSync(routePath, 'utf8');
assert.ok(/export function MarketView\b/.test(src),
    'MarketView is a named export');
assert.ok(/walletId.*chainId.*tick1.*tick2/s.test(src),
    'MarketView accepts the expected props');
assert.ok(/messaging\.getMarket\(/.test(src),
    'MarketView fetches the market summary via messaging.getMarket');

// --- 2. Panel wiring: real components + remaining stubs ------

// Chart panel (§41.3.1): Step 3 landed MarketChart; asserted here by
// import, not by stub text.
assert.ok(
    /import \{ MarketChart \}/.test(src),
    'MarketView imports MarketChart (Step 3)',
);
assert.ok(
    /<MarketChart\b/.test(src),
    'MarketView renders <MarketChart /> for the chart panel',
);

// Orderbook panel (§41.3.2): Step 4 landed OrderbookPanel.
assert.ok(
    /import \{ OrderbookPanel \}/.test(src),
    'MarketView imports OrderbookPanel (Step 4)',
);
assert.ok(
    /<OrderbookPanel\b/.test(src),
    'MarketView renders <OrderbookPanel /> for the orderbook panel',
);
assert.ok(
    /onPickPrice=\{\(price\)/.test(src),
    'MarketView threads price picks from the orderbook into local state',
);

// Recent trades panel (§41.3.3): Step 5 landed RecentTradesPanel.
assert.ok(
    /import \{ RecentTradesPanel \}/.test(src),
    'MarketView imports RecentTradesPanel (Step 5)',
);
assert.ok(
    /<RecentTradesPanel\b/.test(src),
    'MarketView renders <RecentTradesPanel />',
);

// Place order form (§41.3.4): Step 6 landed PlaceOrderPanel.
assert.ok(
    /import \{ PlaceOrderPanel \}/.test(src),
    'MarketView imports PlaceOrderPanel (Step 6)',
);
assert.ok(
    /<PlaceOrderPanel\b/.test(src) && /prefillPrice=\{prefillPrice\}/.test(src),
    'MarketView renders <PlaceOrderPanel /> with prefillPrice from orderbook clicks',
);

// Open orders panel (§41.3.5): Step 7 landed OpenOrdersPanel.
assert.ok(
    /import \{ OpenOrdersPanel \}/.test(src),
    'MarketView imports OpenOrdersPanel (Step 7)',
);
assert.ok(
    /<OpenOrdersPanel\b/.test(src),
    'MarketView renders <OpenOrdersPanel />',
);

// --- 3. Three-shell App.jsx routes MarketView ------------------

// The web shell keeps its DEX routing in `packages/web/src/surfaces/dex.jsx`
// rather than inline in App.jsx : a store-profile build swaps that
// module for a twin that imports nothing, which is how the surface is
// compiled out. The two files together are that shell's wiring, so read them
// as one - asserting on App.jsx alone would go green on a shell that has no
// DEX at all.
const WEB_DEX_SURFACE = join(web, 'src', 'surfaces', 'dex.jsx');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desk, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8')
        + (shell === 'web' ? readFileSync(WEB_DEX_SURFACE, 'utf8') : '');
    assert.ok(
        /import \{ MarketView \}/.test(app),
        `${shell} App imports MarketView`,
    );
    assert.ok(
        /<MarketView\b/.test(app),
        `${shell} App renders <MarketView /> on 'market' sub-route`,
    );
    assert.ok(
        /setUnlockedView\('markets'\)/.test(app),
        `${shell} App market-view back button returns to the markets list`,
    );
}

console.log(
    'OK: market-view smoke (MarketView §41.3 shell + all five panels live: MarketChart (Step 3) + OrderbookPanel (Step 4) + RecentTradesPanel (Step 5) + PlaceOrderPanel (Step 6) with prefillPrice threading from orderbook clicks + OpenOrdersPanel (Step 7); messaging.getMarket summary hydration; popup/web/desktop App routing market->markets)',
);
