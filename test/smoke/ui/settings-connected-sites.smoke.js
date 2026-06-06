// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §35 Settings — Step 14 — Connected Sites panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ConnectedSitesSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const popupMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js');
const webMsgPath = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');

const src = readFileSync(sectionPath, 'utf8');

// list / disconnect calls
assert.match(src, /messaging\.listConnectedSites\(\)/, 'lists sites via messaging');
assert.match(src, /messaging\.deleteConnectedSite\(\{\s*id\s*\}\)/, 'disconnects via messaging');

// Permissions summary surfaces chains, accounts, canSignMessage, canSignAction
for (const field of ['permissions.chains', 'permissions.accounts', 'permissions.canSignMessage', 'permissions.canSignAction']) {
    assert.ok(
        src.includes(field) || src.includes(field.replace('permissions.', '')),
        `permissions summary references ${field}`,
    );
}

// Empty state copy
assert.match(src, /No dApps connected/, 'empty-state copy present');

// Host wiring
const hostSrc = readFileSync(hostPath, 'utf8');
assert.match(hostSrc, /host\.register\('sites\.list'/, 'host registers sites.list');
assert.match(hostSrc, /host\.register\('sites\.delete'/, 'host registers sites.delete');

// Messaging wrappers
const popupMsg = readFileSync(popupMsgPath, 'utf8');
const webMsg = readFileSync(webMsgPath, 'utf8');
for (const fn of ['listConnectedSites', 'deleteConnectedSite']) {
    assert.match(popupMsg, new RegExp(`export function ${fn}`), `popup exports ${fn}`);
    assert.match(webMsg, new RegExp(`export function ${fn}`), `web exports ${fn}`);
}
assert.match(popupMsg, /sendMessage\('sites\.list'\)/, 'popup wires sites.list');
assert.match(webMsg, /sendMessage\('sites\.delete'/, 'web wires sites.delete');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ ConnectedSitesSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'connected-sites'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*ConnectedSitesSection/);

console.log('settings-connected-sites smoke OK');
