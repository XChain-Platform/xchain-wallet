// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-21 trade lifecycle history (ORDER + SWAP slice): the
// orderLifecycleFor / swapLifecycleFor query wrappers (edits/matches/
// expires/cancels), their host + 3-shell messaging wiring, the shared
// MarketLifecycleTimeline component, and its wiring into MyOrdersView /
// MySwapsView as a per-row expandable timeline.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Flow wrappers ----
assert.equal(typeof flows.orderLifecycleFor, 'function', 'flows.orderLifecycleFor exported');
assert.equal(typeof flows.swapLifecycleFor, 'function', 'flows.swapLifecycleFor exported');
const mq = read('packages', 'core', 'src', 'flows', 'marketQueries.js');
for (const m of ['getOrderEdits', 'getOrderMatches', 'getOrderExpires', 'getOrderCancels']) {
    assert.match(mq, new RegExp(m), `order wrapper dispatches to ${m}`);
}
for (const m of ['getSwapEdits', 'getSwapMatches', 'getSwapExpires', 'getSwapCancels']) {
    assert.match(mq, new RegExp(m), `swap wrapper dispatches to ${m}`);
}
await assert.rejects(
    flows.orderLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'bogus', query: 'x' }),
    /unknown kind/,
    'order wrapper rejects an unknown lifecycle kind',
);
await assert.rejects(
    flows.swapLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'edits' }),
    /query is required/,
    'swap wrapper requires a query for non-match kinds',
);
// Matches read the recent global feed with an empty query.
let matchesQuery;
await flows.orderLifecycleFor({
    sdkRegistry: { get: () => ({ getOrderMatches: async (q, t) => { matchesQuery = [q, t]; return { data: [] }; } }) },
    chainId: 'c', kind: 'matches',
});
assert.deepEqual(matchesQuery, ['', 'block'], 'matches lane queries recent feed by block');

// ---- Host + 3-shell messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('orders\.lifecycle'/, 'host registers orders.lifecycle');
assert.match(host, /host\.register\('swaps\.lifecycle'/, 'host registers swaps.lifecycle');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    assert.ok(src.includes("'orders.lifecycle'"), `${shell.join('/')} exposes orders.lifecycle`);
    assert.ok(src.includes("'swaps.lifecycle'"), `${shell.join('/')} exposes swaps.lifecycle`);
}

// ---- Shared timeline component ----
const tl = read('packages', 'core', 'src', 'shared', 'components', 'MarketLifecycleTimeline.jsx');
assert.match(tl, /getOrderLifecycle/, 'component picks the order messaging path');
assert.match(tl, /getSwapLifecycle/, 'component picks the swap messaging path');
assert.match(tl, /order_action_index/, 'filters address-scoped events by order action index');
assert.match(tl, /swap_action_index/, 'filters address-scoped events by swap action index');
assert.match(tl, /give_action_index/, 'filters matches by the matched-order indexes');
assert.match(tl, /created/, 'merges the trade creation into the timeline');

// ---- Wired into both views ----
for (const [view, kind] of [['MyOrdersView.jsx', 'order'], ['MySwapsView.jsx', 'swap']]) {
    const src = read('packages', 'core', 'src', 'shared', 'routes', view);
    assert.match(src, /MarketLifecycleTimeline/, `${view} renders the lifecycle timeline`);
    assert.match(src, /timelineKey/, `${view} tracks the expanded row`);
    assert.match(src, new RegExp(`kind="${kind}"`), `${view} renders the ${kind} timeline`);
}

console.log('market-lifecycle smoke: all assertions passed');
