// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Phase 4 — Step 13 of 23 — LINK two-panel creation form
// (§42.8.1).

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

const formPath = join(sharedRoutes, 'LinkForm.jsx');
assert.ok(existsSync(formPath), 'LinkForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function LinkForm\b/.test(src),
    'LinkForm is a named export');

// Two-panel composer: side panels carry chain picker + action_index.
assert.ok(/Chain A/.test(src), 'LinkForm renders the Chain A panel');
assert.ok(/Chain B/.test(src), 'LinkForm renders the Chain B panel');
assert.ok(/SidePanel/.test(src), 'LinkForm uses a SidePanel sub-component');

// Submit-on selector — defaults to chain A, can switch to chain B.
assert.ok(/submitOn/.test(src),
    'LinkForm tracks which chain the LINK is submitted on');
assert.ok(/Submit LINK on/.test(src),
    'LinkForm exposes a "Submit LINK on" selector');

// Decoded preview — calls getActionByIndex per side.
for (const call of [
    'messaging.getActionByIndex',
    'messaging.getAddressesByChain',
    'messaging.linkAction',
    'messaging.linkActionHw',
]) {
    assert.ok(src.includes(call), `LinkForm calls ${call}`);
}

// HW vs software signing branches.
assert.ok(/SignCredentials/.test(src), 'LinkForm uses SignCredentials');
assert.ok(/isHwSource/.test(src), 'LinkForm imports isHwSource for HW branching');

// --- Core flow ---

assert.equal(typeof flows.linkAction, 'function',
    'flows.linkAction re-exported');
await assert.rejects(
    async () => flows.linkAction({}),
    /linkAction: coin1 is required/,
    'linkAction guards coin1',
);
await assert.rejects(
    async () => flows.linkAction({ coin1: 'BTC' }),
    /linkAction: coin2 is required/,
    'linkAction guards coin2',
);
await assert.rejects(
    async () => flows.linkAction({ coin1: 'BTC', coin2: 'DOGE' }),
    /linkAction: coin1ActionIndex must be a non-empty integer string/,
    'linkAction guards coin1ActionIndex',
);
await assert.rejects(
    async () => flows.linkAction({ coin1: 'BTC', coin2: 'DOGE', coin1ActionIndex: '12' }),
    /linkAction: coin2ActionIndex must be a non-empty integer string/,
    'linkAction guards coin2ActionIndex',
);
await assert.rejects(
    async () => flows.linkAction({
        coin1: 'BTC', coin2: 'BTC', coin1ActionIndex: '5', coin2ActionIndex: '5',
    }),
    /linkAction: cannot link an action to itself/,
    'linkAction rejects identical (coin, action_index) pairs',
);

// --- Background host ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'action.link'"),
    'background host registers action.link');
assert.ok(bg.includes("'action.link.hw'"),
    'background host registers action.link.hw');
assert.ok(/linkAction\b/.test(bg), 'background host imports linkAction');

// --- Shell messaging helpers ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function linkAction\b/.test(m),
        `${shell} messaging.js exports linkAction`);
    assert.ok(/export function linkActionHw\b/.test(m),
        `${shell} messaging.js exports linkActionHw`);
}

// --- AdvancedActionsForm declares LINK as having a dedicated form ---

const advanced = readFileSync(join(sharedRoutes, 'AdvancedActionsForm.jsx'), 'utf8');
assert.ok(/'LINK'/.test(advanced),
    'AdvancedActionsForm marks LINK as having a dedicated form');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('LinkForm'),
        `${shell} App.jsx imports LinkForm`);
    assert.ok(app.includes("'link-form'"),
        `${shell} tracks 'link-form' sub-route`);
    assert.ok(/onLink: \(\) => setUnlockedView\('link-form'\)/.test(app),
        `${shell} ActionsMenu wires onLink → 'link-form'`);
    assert.ok(/<LinkForm\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <LinkForm> with the active walletId`);
    assert.ok(/Link cross-chain actions/.test(app),
        `${shell} ActionsMenu surfaces a "Link cross-chain actions" entry`);
}

console.log(
    'OK — link form smoke (LinkForm §42.8.1 two-panel composer + side-panel decoded preview + submit-on selector + linkAction core flow + bg handlers + 3-shell messaging + 3-shell App.jsx sub-route + ActionsMenu entry + Advanced form dedupe)',
);
