// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The MV3 extension must have a Settings surface.
//
// It had none: no `options_page`, no `settings` view in the popup's route
// union, and `sidepanel.html` mounts the same App - so an extension user could
// not switch networks, enable Developer Mode, manage connected sites, or reach
// the pre-flight privacy control that the confirm spec (§4.8) REQUIRES. The
// host had registered every route Settings calls the whole time; only the
// mount was missing.
//
// What this pins:
//   1. the route exists and mounts the SHARED core screen, not a popup fork;
//   2. a VISIBLE entry point (the hero gear), not just the command palette;
//   3. the gear is prop-gated, so web/desktop - which reach Settings from the
//      nav rail - do not grow duplicate chrome;
//   4. every messaging helper Settings and its sections call is exported by
//      the popup. This is the one that will actually catch a future
//      regression: a new Settings section that calls a route the popup lacks
//      would throw at runtime, in a shell nobody remembers to open.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const popupApp = read('packages', 'extension', 'src', 'popup', 'App.jsx');
const hero = read('packages', 'core', 'src', 'shared', 'components', 'TotalBalanceHero.jsx');
const homeTabs = read('packages', 'core', 'src', 'shared', 'components', 'HomeTabs.jsx');
const home = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
const popupMessaging = read('packages', 'extension', 'src', 'popup', 'messaging.js');
const settings = read('packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

// --- 1. The route, mounting the shared screen -------------------------

assert.ok(
    /import \{ Settings \} from '@xchain-wallet\/core\/shared\/routes\/Settings\.jsx'/.test(popupApp),
    'popup imports the SHARED core Settings route (not a popup-local fork)',
);
assert.ok(
    /unlockedView === 'settings'/.test(popupApp),
    'popup renders a settings view',
);
// appended 'connected-sites' after 'settings', so match the member
// rather than the end of the union.
assert.ok(
    /\| 'settings'(?: \||\})/.test(popupApp),
    "popup's route union includes 'settings'",
);
assert.ok(
    /initialSubpageId=\{settingsInitialSection\}/.test(popupApp),
    'popup deep-links a Settings section, so palette/help commands can target one',
);

// --- 2/3. A visible entry, prop-gated ---------------------------------

assert.ok(
    /aria-label="Open settings"/.test(hero),
    'the balance hero renders a Settings control',
);
assert.ok(
    /typeof onOpenSettings === 'function' \? \(/.test(hero),
    'the hero gear is gated on the prop, so shells with a nav rail do not show it',
);
for (const [name, src] of [['HomeTabs', homeTabs], ['Home', home]]) {
    assert.ok(
        /onOpenSettings/.test(src),
        `${name} threads onOpenSettings through to the hero`,
    );
}
assert.ok(
    /onOpenSettings=\{\(\) => openSettingsSection\(null\)\}/.test(popupApp),
    'the popup supplies the gear handler',
);
// Web and desktop DO pass onOpenSettings - to `<LeftNav>` and
// `<BottomTabBar>`, which is where their entry point belongs. What they must
// not do is pass it to `<Home>`, which would put a second entry for the same
// screen in the hero of a shell that already has one in its nav.
for (const shell of ['web', 'desktop']) {
    const file = shell === 'web'
        ? read('packages', 'web', 'src', 'App.jsx')
        : read('packages', 'desktop', 'renderer', 'App.jsx');
    const lines = file.split('\n');
    let inHome = false;
    for (const line of lines) {
        if (/<Home\b/.test(line)) inHome = true;
        else if (inHome && /^\s*\/>\s*$/.test(line)) inHome = false;
        if (inHome) {
            assert.ok(
                !/onOpenSettings=/.test(line),
                `${shell} must not pass onOpenSettings to <Home>; it reaches Settings from its nav`,
            );
        }
    }
}

// The palette commands were dropped BECAUSE there was no route. Now there is.
assert.ok(
    /settingsSectionsToCommands\(\{ openSettings: openSettingsSection \}\)/.test(popupApp),
    'popup palette offers the Settings sections',
);
assert.ok(
    /helpToCommands\(\{\s*openSettings: openSettingsSection,/.test(popupApp),
    'popup palette offers the settings-backed help topics',
);

// --- 4. Every route Settings needs is reachable from the popup --------

const settingsSections = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);
const sectionFiles = [settingsSections];
// The section components live alongside; scan them all rather than guessing
// which ones the index renders inline.
const sectionDir = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings');
const { readdirSync } = await import('node:fs');
for (const f of readdirSync(sectionDir)) {
    if (f.endsWith('.jsx')) sectionFiles.push(readFileSync(join(sectionDir, f), 'utf8'));
}

const needed = new Set();
for (const src of sectionFiles) {
    for (const m of src.matchAll(/messaging\.([a-zA-Z0-9_]+)/g)) needed.add(m[1]);
}
assert.ok(needed.size > 5, `expected Settings to call several messaging routes, saw ${needed.size}`);

const missing = [...needed].filter(
    (fn) => !new RegExp(`export (async )?function ${fn}\\b|export const ${fn}\\b`).test(popupMessaging),
);
assert.deepEqual(
    missing,
    [],
    `popup messaging is missing routes Settings calls: ${missing.join(', ')}`,
);

assert.ok(settings.length > 0, 'Settings route is readable');

console.log(
    `OK: popup settings entry smoke (shared Settings route mounted in the MV3 popup,`
    + `prop-gated hero gear as the visible entry, palette section + help commands restored, `
    + `all ${needed.size} messaging routes Settings calls exported by the popup)`,
);
