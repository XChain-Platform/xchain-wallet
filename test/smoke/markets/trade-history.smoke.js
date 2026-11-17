// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 8 smoke: Per-market trade history (§41.3.6).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

const panelPath = join(core, 'src', 'shared', 'components', 'TradeHistoryPanel.jsx');
assert.ok(existsSync(panelPath), 'TradeHistoryPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');

assert.ok(/export function TradeHistoryPanel\b/.test(src),
    'TradeHistoryPanel is a named export');
assert.ok(/messaging\.getMarketHistory\(/.test(src),
    'TradeHistoryPanel fetches via messaging.getMarketHistory');
assert.ok(/messaging\.getAddressesByChain\(/.test(src),
    'TradeHistoryPanel fans out across wallet addresses on the chain');
assert.ok(/address: addr\.address/.test(src),
    'TradeHistoryPanel passes the user address filter to getMarketHistory');
// The panel was simplified from a collapsible disclosure to an
// always-open panel that loads on mount (no aria-expanded / setExpanded).
assert.ok(!/aria-expanded=/.test(src) && !/setExpanded/.test(src),
    'TradeHistoryPanel is always-open (no collapsible toggle)');
assert.ok(/useEffect\([\s\S]{0,40}reload\(\);/.test(src),
    'TradeHistoryPanel loads its history on mount via reload()');
assert.ok(/onOpenTx/.test(src),
    'TradeHistoryPanel reserves an onOpenTx callback for tx detail');
assert.ok(/Refresh/.test(src),
    'TradeHistoryPanel exposes a Refresh action');
assert.ok(!/setInterval\(/.test(src),
    'TradeHistoryPanel does not poll (manual refresh only)');

// Operator ruling 2026-11-13: the Market page's My Orders tab is one list of
// the user's open orders and filled trades, newest first, with the status in
// the header filter. OpenOrdersPanel's unified mode reads the fills itself,
// per wallet address, so MarketView no longer renders TradeHistoryPanel.
const marketViewPath = join(core, 'src', 'shared', 'routes', 'MarketView.jsx');
const mv = readFileSync(marketViewPath, 'utf8');
assert.ok(!/<TradeHistoryPanel\b/.test(mv),
    'MarketView shows fills inside the one My Orders list');
assert.ok(/<OpenOrdersPanel\b[\s\S]*?status=\{orderStatus\}/.test(mv),
    'MarketView passes the header filter status to the My Orders list');
const ordersSrc = readFileSync(join(core, 'src', 'shared', 'components', 'OpenOrdersPanel.jsx'), 'utf8');
assert.ok(/messaging\.getMarketHistory\(\{[\s\S]*?address: addr\.address/.test(ordersSrc),
    'the My Orders list fans out getMarketHistory per wallet address for fills');

console.log(
    'OK: trade-history smoke (TradeHistoryPanel §41.3.6; fans out getMarketHistory per wallet address; no polling, manual Refresh; onOpenTx reserved; MarketView My Orders shows fills in one newest-first list)',
);
