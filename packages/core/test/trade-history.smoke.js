// Phase 3 Step 8 smoke — Per-market trade history (§41.3.6).

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
assert.ok(/aria-expanded=/.test(src) && /setExpanded/.test(src),
    'TradeHistoryPanel has a collapsible toggle with aria-expanded');
assert.ok(/onOpenTx/.test(src),
    'TradeHistoryPanel reserves an onOpenTx callback for tx detail');
assert.ok(/Refresh/.test(src),
    'TradeHistoryPanel exposes a Refresh action');
assert.ok(!/setInterval\(/.test(src),
    'TradeHistoryPanel does not poll (manual refresh only)');

const marketViewPath = join(core, 'src', 'shared', 'routes', 'MarketView.jsx');
const mv = readFileSync(marketViewPath, 'utf8');
assert.ok(/import\s*\{\s*TradeHistoryPanel\s*\}/.test(mv),
    'MarketView imports TradeHistoryPanel');
assert.ok(/<TradeHistoryPanel\b/.test(mv),
    'MarketView renders TradeHistoryPanel');

const openOrdersIdx = mv.indexOf('<OpenOrdersPanel');
const tradeHistoryIdx = mv.indexOf('<TradeHistoryPanel');
assert.ok(openOrdersIdx > 0 && tradeHistoryIdx > openOrdersIdx,
    'TradeHistoryPanel rendered below OpenOrdersPanel');

console.log(
    'OK — trade-history smoke (TradeHistoryPanel §41.3.6 collapsible; fans out getMarketHistory per wallet address; no polling, manual Refresh; onOpenTx reserved; rendered below OpenOrdersPanel in MarketView)',
);
