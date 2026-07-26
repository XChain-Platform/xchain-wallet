// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-21 trade lifecycle history (dispenser slice): the
// dispenserLifecycleFor query wrapper (closes/edits/expires), its host +
// 3-shell messaging wiring, and the DispenserDetail Lifecycle tab that
// merges dispenses + refill/edit/close/expire events into one timeline.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Flow wrapper ----
assert.equal(typeof flows.dispenserLifecycleFor, 'function', 'flows.dispenserLifecycleFor exported');
const q = read('packages', 'core', 'src', 'flows', 'dispenserQueries.js');
assert.match(q, /getDispenserCloses/, 'wrapper dispatches to getDispenserCloses');
assert.match(q, /getDispenserEdits/, 'wrapper dispatches to getDispenserEdits');
assert.match(q, /getDispenserExpires/, 'wrapper dispatches to getDispenserExpires');
await assert.rejects(
    flows.dispenserLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'bogus', query: 'x' }),
    /unknown kind/,
    'rejects an unknown lifecycle kind',
);

// ---- Host + 3-shell messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('dispensers\.lifecycle'/, 'host registers dispensers.lifecycle');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    assert.ok(read(...shell).includes("'dispensers.lifecycle'"), `${shell.join('/')} exposes dispensers.lifecycle`);
}

// ---- DispenserDetail Lifecycle tab ----
const dd = read('packages', 'core', 'src', 'shared', 'routes', 'DispenserDetail.jsx');
assert.match(dd, /getDispenserLifecycle/, 'DispenserDetail loads the lifecycle events');
// D-45: 'cancels' (the owner's own cancel, which opens the 1-hour close window)
// must be loaded alongside 'closes' (the completion written when it ends), or the
// cancel is invisible on the timeline for the whole hour after it is taken.
assert.match(dd, /\['edits', 'cancels', 'closes', 'expires'\]/, 'loads refills/edits, the cancel request, closes, and expires');
assert.match(dd, /lifecycleTimeline/, 'merges events into one timeline');
assert.match(dd, /setTab\('lifecycle'\)/, 'has a Lifecycle tab');
assert.match(dd, /dispenser_action_index/, 'scopes events to this dispenser by action index');

console.log('dispenser-lifecycle smoke: all assertions passed');
