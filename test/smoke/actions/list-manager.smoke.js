// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-10 "My Lists" (LIST v0 create / v1 fork manager):
// MyLists, ListCreateForm, ListDetail, ListForkForm; the `listsForSource`
// read; the shared background host + 3-shell messaging wiring; and
// route registration (LeftNav, MenuRoute, command palette, App.jsx).

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
const sharedComponents = join(core, 'src', 'shared', 'components');

// --- Route files exist and export the expected component ---

for (const [file, exportName] of [
    ['MyLists.jsx', 'MyLists'],
    ['ListCreateForm.jsx', 'ListCreateForm'],
    ['ListDetail.jsx', 'ListDetail'],
    ['ListForkForm.jsx', 'ListForkForm'],
]) {
    const p = join(sharedRoutes, file);
    assert.ok(existsSync(p), `${file} exists`);
    const src = readFileSync(p, 'utf8');
    assert.ok(new RegExp(`export function ${exportName}\\b`).test(src),
        `${file} is a named export (${exportName})`);
}

const myListsSrc = readFileSync(join(sharedRoutes, 'MyLists.jsx'), 'utf8');
const createSrc = readFileSync(join(sharedRoutes, 'ListCreateForm.jsx'), 'utf8');
const detailSrc = readFileSync(join(sharedRoutes, 'ListDetail.jsx'), 'utf8');
const forkSrc = readFileSync(join(sharedRoutes, 'ListForkForm.jsx'), 'utf8');

// --- MyLists: fans out the new read over every address, per chain ---

assert.ok(myListsSrc.includes('messaging.getListsForSource'),
    'MyLists calls messaging.getListsForSource');
assert.ok(myListsSrc.includes('messaging.getAddressesByChain'),
    'MyLists loads addresses to fan the query out over');

// --- ListCreateForm: reuses the existing LIST v0 plumbing verbatim ---

for (const call of [
    'messaging.createList',
    'messaging.createListHw',
    'messaging.buildActionPsbtRequest',
]) {
    assert.ok(createSrc.includes(call), `ListCreateForm calls ${call}`);
}
assert.ok(/VERSION:\s*'0'/.test(createSrc), 'ListCreateForm submits LIST v0 (create)');
assert.ok(/airdropLib\.parsePaste|airdropLib\.classifyRecipients/.test(createSrc),
    'ListCreateForm reuses the AirdropForm address-paste parser');
// An ADDRESS list is only valid on the chain it is published to, so the
// parser has to be told which chain that is (the indexer drops items that are
// not addresses for that coin+network while still storing the list).
assert.ok(/classifyRecipients\(\s*\n?\s*parts,\s*\n?\s*\{\s*coin: recipientCoin, network: recipientNetwork\s*\}/m.test(createSrc),
    'ListCreateForm validates pasted addresses against the active chain');
assert.ok(/permanent public on-chain data/.test(createSrc),
    'ListCreateForm shows the pasted/contact-book address privacy line');
assert.ok(/bigger transaction/.test(createSrc),
    'ListCreateForm shows a fee-scales-with-member-count hint');
assert.ok(/isWatcherMode/.test(createSrc), 'ListCreateForm is watcher-mode aware (single tx: supported, not blocked)');
assert.ok(/isHwSource/.test(createSrc), 'ListCreateForm checks for a hardware source');

// --- ListDetail: membership + fork-lineage read, honest "used by" gap ---

assert.ok(detailSrc.includes('messaging.getListByActionIndex'),
    'ListDetail calls messaging.getListByActionIndex');
assert.ok(/data\.list\b/.test(detailSrc), 'ListDetail reads membership from data.list');
assert.ok(/data\.edits\b/.test(detailSrc), 'ListDetail reads the fork delta from data.edits');
assert.ok(/no reverse lookup/.test(detailSrc),
    'ListDetail states plainly that no list-to-consumer reverse lookup exists');
assert.ok(/onFork/.test(detailSrc), 'ListDetail exposes a Fork & edit action');

// --- ListForkForm: v1 ADD/REMOVE, two-leg chaining, repoint rail ---

assert.ok(/VERSION:\s*'1'/.test(forkSrc), 'ListForkForm submits LIST v1 (fork)');
assert.ok(/EDIT:\s*(needsAdd \? '1' : '2'|'2')/.test(forkSrc),
    'ListForkForm sets EDIT to 1 (add) or 2 (remove) per protocol (one direction per v1 action)');
assert.ok(/twoPhase/.test(forkSrc),
    'ListForkForm recognizes the add-and-remove case needs two chained transactions');
assert.ok(/wait-index/.test(forkSrc), 'ListForkForm has a wait-index stage for the two-leg case');
assert.ok(/Not available in watcher mode/.test(forkSrc),
    'ListForkForm blocks watcher mode only for the two-leg (add+remove) case');
assert.ok(/REPOINT_TARGETS/.test(forkSrc), 'ListForkForm defines the repoint-rail consumer classes');
assert.ok(/stays live everywhere it is referenced/.test(forkSrc),
    'ListForkForm shows the unconditional "old list stays live" warning');
for (const pcItem of ['PC-04', 'PC-19', 'PC-17']) {
    assert.ok(forkSrc.includes(pcItem), `ListForkForm's repoint rail references ${pcItem}`);
}
assert.ok(/built: false/.test(forkSrc),
    'ListForkForm renders the repoint targets as disabled (none of PC-04/17/19 ship an edit surface yet)');

// --- Core flow: listsForSource ---

assert.equal(typeof flows.listsForSource, 'function', 'flows.listsForSource re-exported');
await assert.rejects(
    async () => flows.listsForSource({}),
    /sdkRegistry is required/,
    'listsForSource guards sdkRegistry',
);
await assert.rejects(
    async () => flows.listsForSource({ sdkRegistry: {}, address: '1abc' }),
    /chainId is required/,
    'listsForSource guards chainId',
);
await assert.rejects(
    async () => flows.listsForSource({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /address is required/,
    'listsForSource guards address',
);
{
    let seen = null;
    const sdkRegistry = { get: () => ({ getLists: async (q, t) => { seen = [q, t]; return { data: [] }; } }) };
    const out = await flows.listsForSource({ sdkRegistry, chainId: 'bitcoin-mainnet', address: '1abc' });
    assert.deepEqual(seen, ['1abc', 'address'], 'listsForSource queries getLists(address, "address")');
    assert.deepEqual(out, { data: [] }, 'listsForSource returns the explorer response verbatim');
}

// --- Background host: shared handler registration ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'lists.forSource'"), 'background host registers lists.forSource');
assert.ok(/listsForSource\b/.test(bg), 'background host imports listsForSource');

// --- Shell messaging helpers (3 shells) ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function getListsForSource\b/.test(m),
        `${shell} messaging.js exports getListsForSource`);
    assert.ok(m.includes("'lists.forSource'"), `${shell} messaging.js dispatches lists.forSource`);
}

// --- Registration: LeftNav, BottomTabBar, MenuRoute, command palette ---

const leftNav = readFileSync(join(sharedComponents, 'LeftNav.jsx'), 'utf8');
assert.ok(/id:\s*'lists'/.test(leftNav), 'LeftNav lists a "lists" nav item');
assert.ok(/lists:\s*\[.*'list-detail'.*'list-create'.*'list-fork'/.test(leftNav.replace(/\s+/g, ' ')),
    'LeftNav groups list-detail/list-create/list-fork under the Lists highlight');

const bottomBar = readFileSync(join(sharedComponents, 'BottomTabBar.jsx'), 'utf8');
assert.ok(/id:\s*'lists'/.test(bottomBar), 'BottomTabBar lists a "lists" item in its More sheet');

const menuRoute = readFileSync(join(sharedRoutes, 'MenuRoute.jsx'), 'utf8');
assert.ok(/onLists/.test(menuRoute), 'MenuRoute accepts onLists');
assert.ok(/id:\s*'lists'/.test(menuRoute), 'MenuRoute renders a My Lists entry');

const commandRegistry = readFileSync(join(core, 'src', 'shared', 'commandPalette', 'commandRegistry.js'), 'utf8');
assert.ok(/nav-lists/.test(commandRegistry), 'Command palette has a nav-lists command');
assert.ok(/create-list/.test(commandRegistry), 'Command palette has a create-list command');

// --- App.jsx wiring (web + desktop; extension popup UI wiring is a follow-up) ---

for (const [shell, appPath] of [
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    for (const comp of ['MyLists', 'ListDetail', 'ListCreateForm', 'ListForkForm']) {
        assert.ok(app.includes(comp), `${shell} App.jsx imports ${comp}`);
    }
    for (const view of ["'lists'", "'list-detail'", "'list-create'", "'list-fork'"]) {
        assert.ok(app.includes(view), `${shell} tracks ${view} sub-route`);
    }
}

console.log(
    'OK: list-manager smoke (MyLists/ListCreateForm/ListDetail/ListForkForm exist + wired; '
    + 'LIST v0 create reuses createList/createListHw/buildActionPsbtRequest; LIST v1 fork chains '
    + 'add-then-remove with a wait-index leg and blocks watcher mode only for that case; honest '
    + '"used by" + repoint-rail gaps; listsForSource flow + host + 3-shell messaging; '
    + 'LeftNav/BottomTabBar/MenuRoute/command-palette/App.jsx registration)',
);
