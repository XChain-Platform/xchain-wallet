// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the retired Cross-chain templates page (§42.8.4): the page,
// its links and its template library are gone, while the Action queue
// it used to prefill stays.

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
const templatesDir = join(core, 'src', 'templates', 'cross-chain');

// The library had no reader once the page went, so it went too.
assert.ok(!existsSync(templatesDir),
    'the cross-chain template library is deleted');

assert.ok(!existsSync(join(sharedRoutes, 'CrossChainTemplates.jsx')),
    'the retired CrossChainTemplates page is deleted');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(!app.includes('CrossChainTemplates'),
        `${shell} App.jsx no longer imports CrossChainTemplates`);
    assert.ok(!app.includes("'cross-chain-templates'"),
        `${shell} no longer routes 'cross-chain-templates'`);
    assert.ok(!surfacesEntry(app, 'cross-chain-templates', 'Cross-chain templates'),
        `${shell} ActionsMenu no longer surfaces a "Cross-chain templates" entry`);
    assert.ok(app.includes('<ParallelComposer'),
        `${shell} still renders the Action queue`);
}

console.log(
    'OK: cross-chain templates smoke (the Cross-chain templates page, its links and its template library are retired while the Action queue stays)',
);
