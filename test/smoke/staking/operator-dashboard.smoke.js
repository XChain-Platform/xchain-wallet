// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 11 of 23: Operator / validator dashboard
// (§42.7.5).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'OperatorDashboard.jsx');
assert.ok(existsSync(formPath), 'OperatorDashboard.jsx exists');
const src = readFileSync(formPath, 'utf8');
const publisherPath = join(core, 'src', 'shared', 'components', 'OperatorPublisherMode.jsx');
assert.ok(existsSync(publisherPath), 'OperatorPublisherMode.jsx exists');
const publisherSrc = readFileSync(publisherPath, 'utf8');
const surfaceSrc = `${src}\n${publisherSrc}`;

assert.ok(/export function OperatorDashboard\b/.test(src),
    'OperatorDashboard is a named export');

// Six read-side data sources fetched in parallel.
for (const call of [
    'messaging.getStakesForAddress',
    'messaging.getDelegationsForAddress',
    'messaging.getRewardsForAddress',
    'messaging.getRewardClaimsForAddress',
    'messaging.getBroadcastsForAddress',
    'messaging.getValidatorsForChain',
]) {
    assert.ok(src.includes(call), `OperatorDashboard calls ${call}`);
}

// Six expected sections rendered.
for (const heading of [
    'Staking status',
    'Delegation chain',
    'Validator performance',
    'Rewards trajectory',
    'Publishing activity',
    'Publisher mode',
]) {
    assert.ok(surfaceSrc.includes(heading), `OperatorDashboard renders "${heading}" section`);
}

// Publisher mode v3 BROADCAST quick-compose: pre-fills feed, rapid value entry.
assert.ok(/VERSION:\s*['"]3['"]/.test(publisherSrc),
    'PublisherMode submits VERSION=3 (feed-result BROADCAST)');
assert.ok(/BROADCAST_ACTION_INDEX/.test(publisherSrc),
    'PublisherMode references BROADCAST_ACTION_INDEX (v3 feed pointer)');
assert.ok(/useOwnerActionLane/.test(publisherSrc),
    'PublisherMode uses the shared owner-action lane');
assert.ok(/software:\s*['"]broadcastAction['"]/.test(publisherSrc),
    'PublisherMode selects the software broadcast method through the owner-action lane');
assert.ok(/hardware:\s*['"]broadcastActionHw['"]/.test(publisherSrc),
    'PublisherMode selects the hardware broadcast method through the owner-action lane');
assert.ok(/ActionConfirmScreen/.test(publisherSrc),
    'PublisherMode renders the shared confirm screen');
assert.ok(/WatcherResultPanel/.test(publisherSrc),
    'PublisherMode renders an unsigned watcher result');
assert.ok(/setValue\(''\)/.test(publisherSrc),
    'PublisherMode clears the value input on success for rapid successive entry');
assert.ok(/action_format/.test(src) && !/\.version\b|\.VERSION\b/.test(src),
    'OperatorDashboard reads the BROADCAST action_format field');

// Auto-find self in validator roster by signing pubkey.
assert.ok(/signing_pubkey|SIGNING_PUBKEY/.test(src),
    'OperatorDashboard joins validator roster by signing pubkey');
assert.ok(/splitRewards\(rewards\.rows, rewardClaims\.rows\)/.test(src),
    'OperatorDashboard includes claim-ledger rows in its reward split');
assert.ok(/unclaimedRewards\(\{ rewards: rows, claims \}\)/.test(src),
    'OperatorDashboard uses the canonical accrued-minus-valid-claims helper');

// --- Core flow ---

assert.equal(typeof flows.broadcastsForAddress, 'function',
    'flows.broadcastsForAddress re-exported');
await assert.rejects(
    async () => flows.broadcastsForAddress({}),
    /broadcastsForAddress: sdkRegistry is required/,
    'broadcastsForAddress guards sdkRegistry',
);
await assert.rejects(
    async () => flows.broadcastsForAddress({ sdkRegistry: {}, address: 'x' }),
    /broadcastsForAddress: chainId is required/,
    'broadcastsForAddress guards chainId',
);
await assert.rejects(
    async () => flows.broadcastsForAddress({ sdkRegistry: {}, chainId: 'x' }),
    /broadcastsForAddress: address is required/,
    'broadcastsForAddress guards address',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'broadcasts.forAddress'"),
    'background host registers broadcasts.forAddress');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function getBroadcastsForAddress\b/.test(m),
        `${shell} messaging.js exports getBroadcastsForAddress`);
}

// --- StakeDetail wires the entry point (More ▸ Operator view) ---

const detail = readFileSync(join(sharedRoutes, 'StakeDetail.jsx'), 'utf8');
assert.ok(/onOpenOperatorDashboard/.test(detail),
    'StakeDetail accepts onOpenOperatorDashboard prop');
assert.ok(/Operator view/.test(detail),
    'StakeDetail renders the Operator view action');

// --- App.jsx wiring ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('OperatorDashboard'),
        `${shell} App.jsx imports OperatorDashboard`);
    assert.ok(app.includes("'operator-dashboard'"),
        `${shell} tracks operator-dashboard sub-route`);
    assert.ok(/onOpenOperatorDashboard=\{\(\)\s*=>\s*setUnlockedView\('operator-dashboard'\)/.test(app),
        `${shell} wires StakeDetail.onOpenOperatorDashboard → operator-dashboard`);
    assert.ok(/<OperatorDashboard\b[\s\S]*?address=\{stakingRef\.address\}/.test(app),
        `${shell} App.jsx passes the stakingRef.address through to OperatorDashboard`);
}

console.log(
    'OK: operator dashboard smoke (OperatorDashboard 5-section read-only view + Publisher-mode v3 BROADCAST quick-compose with rapid value entry + broadcastsForAddress flow + bg handler + 3-shell messaging + StakeDetail.onOpenOperatorDashboard prop + 3-shell App.jsx sub-route)',
);
