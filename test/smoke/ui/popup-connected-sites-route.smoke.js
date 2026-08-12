// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The MV3 popup needs Connected Sites as its own screen.
//
// a later change gave the popup a Settings route and, with it, the only path to
// dApp permissions: Settings -> Connected Sites, one level deeper than
// the other shells put it. Two things fell out of that. The palette's
// static `nav-connected-sites` command navigated to a route the popup's
// union did not contain (so it dead-ended), and `sitesToCommands` was
// skipped outright, because it refuses to build commands for a shell
// with nowhere to send them.
//
// What this pins:
//   1. a shared core route exists and mounts the SHARED section, not a
//      popup-local fork of the panel;
//   2. the popup's route union and render branch carry it;
//   3. the section-deep-link helper special-cases 'connected-sites' to
//      the top-level route instead of nesting it under Settings;
//   4. the palette loads sites and feeds them to sitesToCommands.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const route = read('packages', 'core', 'src', 'shared', 'routes', 'ConnectedSites.jsx');
const popupApp = read('packages', 'extension', 'src', 'popup', 'App.jsx');
const registry = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');

// --- 1. A shared route over the shared section ------------------------

assert.ok(
    /export function ConnectedSites\(/.test(route),
    'core exports a ConnectedSites route',
);
assert.ok(
    /import \{ ConnectedSitesSection \} from '\.\.\/components\/settings\/ConnectedSitesSection\.jsx'/.test(route),
    'the route mounts the SHARED section (not a fork of the panel body)',
);
assert.ok(
    /<ConnectedSitesSection \/>/.test(route),
    'the route renders the section with no props of its own, so behaviour cannot drift',
);
assert.ok(
    /<PageHeader onBack=\{onBack\} title="Connected Sites" \/>/.test(route),
    'the route owns its header and hands back to the shell',
);
// Its own screen means its own state: nothing about Settings may leak in.
assert.ok(
    !/Settings/.test(route.replace(/\/\/.*$/gm, '')),
    'the route does not reach into Settings outside its comments',
);

// --- 2. The popup route ----------------------------------------------

assert.ok(
    /import \{ ConnectedSites \} from '@xchain-wallet\/core\/shared\/routes\/ConnectedSites\.jsx'/.test(popupApp),
    'popup imports the shared route',
);
assert.ok(
    /\| 'connected-sites'\}/.test(popupApp),
    "popup's route union includes 'connected-sites'",
);
assert.ok(
    /unlockedView === 'connected-sites'/.test(popupApp),
    'popup renders a standalone connected-sites view',
);
assert.ok(
    /<ConnectedSites onBack=\{\(\) => setUnlockedView\('home'\)\} \/>/.test(popupApp),
    'the popup view hands back to Home, the screen it was reached from',
);

// --- 3. The deep-link helper prefers the top-level route --------------

const helper = popupApp.slice(
    popupApp.indexOf('const openSettingsSection'),
    popupApp.indexOf('const paletteCommands'),
);
assert.ok(helper.length > 0, 'openSettingsSection is defined before the palette commands');
assert.ok(
    /sectionId === 'connected-sites'/.test(helper)
    && /setUnlockedView\('connected-sites'\)/.test(helper),
    "openSettingsSection routes 'connected-sites' to the top-level view, not into Settings",
);
const cutoff = helper.indexOf("setUnlockedView('settings')");
assert.ok(
    cutoff > helper.indexOf("sectionId === 'connected-sites'"),
    'the connected-sites branch returns BEFORE the generic Settings deep-link',
);

// --- 4. The palette feeds it -----------------------------------------

assert.ok(
    /sitesToCommands/.test(popupApp),
    'popup imports and uses sitesToCommands',
);
assert.ok(
    /sitesToCommands\(paletteSites, \{ openConnectedSites: \(\) => setUnlockedView\('connected-sites'\) \}\)/.test(popupApp),
    'popup wires site commands to the standalone route',
);
assert.ok(
    /messaging\.listConnectedSites\(\)/.test(popupApp),
    'popup loads connected sites for the palette',
);
// sitesToCommands is a no-op without the ctx handler; the stale comment
// saying the popup has no such view would send the next reader the wrong way.
assert.ok(
    !/popup, which has no connected-sites view/.test(registry),
    'commandRegistry no longer claims the popup lacks a connected-sites view',
);
// The static nav command already targeted this route id; it only ever
// worked in shells whose union contained it.
assert.ok(
    /id: 'nav-connected-sites'[\s\S]{0,240}?run: go\('connected-sites'\)/.test(registry),
    "the static 'Connected sites' palette command still targets the 'connected-sites' route id",
);

console.log(
    'OK: popup connected-sites route smoke (shared ConnectedSites route over the shared'
    + 'section, mounted standalone in the MV3 popup, section deep-link redirected to it, '
    + 'palette site commands and nav command no longer dead-ended)',
);
