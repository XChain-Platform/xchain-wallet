// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 14 of 23: Parallel cross-chain composer
// (§42.8.2).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'ParallelComposer.jsx');
assert.ok(existsSync(formPath), 'ParallelComposer.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function ParallelComposer\b/.test(src),
    'ParallelComposer is a named export');

// 4-stage flow: compose → review → signing → done.
for (const stage of ['compose', 'review', 'signing', 'done']) {
    assert.ok(src.includes(`'${stage}'`),
        `ParallelComposer tracks the '${stage}' stage`);
}

// Per-row data: chainId / fromAddressId / action / paramsJson + status.
for (const field of ['chainId', 'fromAddressId', 'action', 'paramsJson', 'status']) {
    assert.ok(src.includes(field),
        `ParallelComposer rows carry ${field}`);
}

// Spec warning + acknowledgment gate before starting the sign loop.
assert.ok(/not atomic/i.test(src),
    'ParallelComposer surfaces the no-rollback warning');
assert.ok(/acknowledgedNoRollback/.test(src),
    'ParallelComposer requires explicit ack before signing');
assert.ok(/Sign all/.test(src),
    'ParallelComposer renders the "Sign all" submit button');

// Sequential sign loop reuses the existing advanced-action handler.
for (const call of [
    'messaging.advancedAction',
    'messaging.advancedActionHw',
    'messaging.getAddressesByChain',
    'messaging.listActions',
]) {
    assert.ok(src.includes(call), `ParallelComposer calls ${call}`);
}

// Skip + retry semantics for failed rows.
assert.ok(/'skipped'/.test(src),
    'ParallelComposer can mark rows as skipped');
assert.ok(/'failed'/.test(src),
    'ParallelComposer tracks per-row failure state');

// HW vs software signing branches.
assert.ok(/SignCredentials/.test(src), 'ParallelComposer uses SignCredentials');
assert.ok(/isHwSource/.test(src), 'ParallelComposer branches on isHwSource');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ParallelComposer'),
        `${shell} App.jsx imports ParallelComposer`);
    assert.ok(app.includes("'parallel-compose'"),
        `${shell} tracks 'parallel-compose' sub-route`);
    assert.ok(/onParallel: \(\) => setUnlockedView\('parallel-compose'\)/.test(app),
        `${shell} ActionsMenu wires onParallel → 'parallel-compose'`);
    assert.ok(/<ParallelComposer\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <ParallelComposer> with the active walletId`);
    assert.ok(surfacesEntry(app, 'parallel', 'Parallel cross-chain actions'),
        `${shell} ActionsMenu surfaces the "Parallel cross-chain actions" entry`);
}

console.log(
    'OK: parallel composer smoke (ParallelComposer §42.8.2 multi-row draft list + 4-stage compose/review/signing/done flow + sequential advancedAction calls + per-row pending/submitting/success/failed/skipped state + no-rollback ack gate + HW vs software signing + 3-shell App.jsx + ActionsMenu entry)',
);
