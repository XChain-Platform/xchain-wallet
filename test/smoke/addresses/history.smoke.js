// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Phase 4 — Step 12 of 23 — History route + §23.5
// cross-chain thread rendering.

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

const formPath = join(sharedRoutes, 'History.jsx');
assert.ok(existsSync(formPath), 'History.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function History\b/.test(src),
    'History is a named export');

// §23.5 first-class visual elements present.
assert.ok(/🔗/.test(src), 'History renders the 🔗 LINK badge');
assert.ok(/connector/i.test(src),
    'History renders a vertical connector between threaded rows');
assert.ok(/Cross-chain actions/.test(src),
    'History exposes the "Cross-chain actions" filter view');
assert.ok(/detailDual/.test(src),
    'History renders a dual-side (side-by-side) detail card layout');

// Read-side data sources fan out via three messaging methods.
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getAddressHistory',
    'messaging.getLinksForAddress',
    'messaging.getActionByIndex',
]) {
    assert.ok(src.includes(call), `History calls ${call}`);
}

// --- Core flow ---

assert.equal(typeof flows.linksForAddress, 'function',
    'flows.linksForAddress re-exported');
await assert.rejects(
    async () => flows.linksForAddress({}),
    /linksForAddress: sdkRegistry is required/,
    'linksForAddress guards sdkRegistry',
);
await assert.rejects(
    async () => flows.linksForAddress({ sdkRegistry: {}, address: 'x' }),
    /linksForAddress: chainId is required/,
    'linksForAddress guards chainId',
);
await assert.rejects(
    async () => flows.linksForAddress({ sdkRegistry: {}, chainId: 'x' }),
    /linksForAddress: address is required/,
    'linksForAddress guards address',
);

// --- Background host ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'links.address'"),
    'background host registers links.address');
assert.ok(bg.includes("'history.address'"),
    'background host already registers history.address (existing)');
assert.ok(bg.includes("'actions.byIndex'"),
    'background host registers actions.byIndex (peer fetch for dual-side card)');
assert.ok(/linksForAddress\b/.test(bg),
    'background host imports linksForAddress flow');

// --- Shell messaging helpers ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function getAddressHistory\b/.test(m),
        `${shell} messaging.js exports getAddressHistory`);
    assert.ok(/export function getLinksForAddress\b/.test(m),
        `${shell} messaging.js exports getLinksForAddress`);
    assert.ok(/export function getActionByIndex\b/.test(m),
        `${shell} messaging.js exports getActionByIndex`);
}

// --- Home wires the new prop ---

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/onHistory/.test(home),
    'Home accepts onHistory prop');
assert.ok(/onClick=\{onHistory\}/.test(home),
    'Home renders the History button wired to onHistory');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('History'),
        `${shell} App.jsx imports the History component`);
    assert.ok(app.includes("'history'"),
        `${shell} tracks 'history' sub-route`);
    assert.ok(/onHistory=\{activeWalletId \? \(\) =>\s*setUnlockedView\('history'\)/.test(app),
        `${shell} wires Home.onHistory → 'history' sub-route`);
    assert.ok(/<History\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <History> with the active walletId`);
}

console.log(
    'OK — history smoke (History route §23 + §23.5 cross-chain threading: 🔗 badges + vertical connector + dual-side detail card + Cross-chain filter + linksForAddress flow + bg handler + 3-shell messaging + Home prop + 3-shell App.jsx sub-route)',
);
