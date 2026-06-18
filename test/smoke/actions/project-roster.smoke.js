// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the project-registry wallet surfaces: the "Official token"
// banner data path (normalizeTokenInfo projects passthrough) and the
// ProjectRosterForm two-sign LIST → wait-index → owner LINK flow
// (Project_Registry.md).

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

const formPath = join(sharedRoutes, 'ProjectRosterForm.jsx');
assert.ok(existsSync(formPath), 'ProjectRosterForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function ProjectRosterForm\b/.test(src),
    'ProjectRosterForm is a named export');

// Stage machine: two signs with an indexing wait between them.
for (const stage of ['compose', 'review-list', 'wait-index', 'review-link', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `form tracks stage "${stage}"`);
}

// Messaging surface: LIST submit, LINK submit, index polling, genesis
// lookup, current-roster prefill.
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getGenesisForToken',
    'messaging.getProjectForToken',
    'messaging.getActionByTxid',
    'messaging.createList',
    'messaging.createListHw',
    'messaging.linkAction',
    'messaging.linkActionHw',
]) {
    assert.ok(src.includes(call), `ProjectRosterForm calls ${call}`);
}

// The roster LIST is the TICK type (TYPE=1): the registry shape.
assert.ok(/TYPE:\s*'1'/.test(src), 'roster LIST uses TYPE=1 (TICK list)');

// Owner-validation surfaced, watcher mode blocked.
assert.ok(/ownerMismatch/.test(src), 'form warns on issuer/owner mismatch');
assert.ok(/isWatcherMode/.test(src), 'form blocks watcher mode');

// --- Core flow (roster prefill read) ---

assert.equal(typeof flows.getProjectForTick, 'function',
    'flows.getProjectForTick re-exported');
await assert.rejects(
    async () => flows.getProjectForTick({}),
    /sdkRegistry is required/,
    'getProjectForTick guards sdkRegistry',
);
await assert.rejects(
    async () => flows.getProjectForTick({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /tick is required/,
    'getProjectForTick guards tick',
);
// 400 (no roster yet) maps to null, not an error.
{
    const sdkRegistry = {
        get: () => ({ getProject: async () => { const e = new Error('Explorer returned HTTP 400 for /BTC/api/project/X'); throw e; } }),
    };
    const out = await flows.getProjectForTick({ sdkRegistry, chainId: 'bitcoin-mainnet', tick: 'X' });
    assert.equal(out, null, 'no-roster 400 resolves to null');
}

// --- normalizeTokenInfo projects passthrough (banner data) ---

const tokenInfoSrc = readFileSync(join(core, 'src', 'flows', 'tokenInfo.js'), 'utf8');
assert.ok(/projects/.test(tokenInfoSrc),
    'normalizeTokenInfo carries the explorer projects[] field');
const tokenDetail = readFileSync(join(sharedRoutes, 'TokenDetail.jsx'), 'utf8');
assert.ok(/officialBanner/.test(tokenDetail), 'TokenDetail renders the Official banner');
const manageSrc = readFileSync(join(sharedRoutes, 'ManageToken.jsx'), 'utf8');
assert.ok(/officialBanner/.test(manageSrc), 'ManageToken renders the Official banner');

// --- Background host ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'projects.byTick'"),
    'background host registers projects.byTick');
assert.ok(/getProjectForTick\b/.test(bg), 'background host imports getProjectForTick');

// --- Shell messaging helpers ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function getProjectForToken\b/.test(m),
        `${shell} messaging.js exports getProjectForToken`);
}

// --- ManageToken entry (owner-gated) + App.jsx wiring (3 shells) ---

assert.ok(/onManageRoster/.test(manageSrc), 'ManageToken accepts onManageRoster');
assert.ok(/id:\s*['"]manage-roster['"]/.test(manageSrc),
    'ManageToken renders the Official-list action');
assert.ok(/blockIssuerActions \? undefined : onManageRoster/.test(manageSrc),
    'ManageToken hides Official list from non-owners');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ProjectRosterForm'),
        `${shell} App.jsx imports ProjectRosterForm`);
    assert.ok(app.includes("'project-roster'"),
        `${shell} tracks 'project-roster' sub-route`);
    assert.ok(/onManageRoster=\{\(\) => openForm\('project-roster'\)\}/.test(app),
        `${shell} ManageToken wires onManageRoster`);
}

console.log(
    'OK: project-roster smoke (ProjectRosterForm stage machine LIST -> wait-index -> LINK, TYPE=1 roster, owner gate + watcher block, getProjectForTick flow + 400->null, banner passthrough, bg handler, 3-shell messaging + App.jsx wiring)',
);
