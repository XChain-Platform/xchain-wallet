// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §24 Cluster Y FOLLOWUPs 2+3 smoke: Settings entry-point + wallet-name
// surfacing in LeftNav / BottomTabBar.
//
// Asserts:
//   1. Settings route accepts an `initialSubpageId` prop so deep-links
//      (e.g. 'connected-sites') open straight into the drilldown.
//   2. LeftNav VIEW_GROUPS maps 'settings' → ['settings', 'connected-sites']
//      so the gear row stays highlighted on the deep-link variant.
//   3. LeftNav's Settings footer button gets aria-current="page" when
//      the route is the Settings view (FOLLOWUP 2 wiring).
//   4. Web + desktop App.jsx import Settings, track a `walletList`
//      state, render a 'settings' / 'connected-sites' top-level branch,
//      and pass `walletName` + `onOpenSettings` into LeftNav.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Settings.initialSubpageId prop ----------------------------------

const settingsSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);
assert.ok(/initialSubpageId\s*=\s*null/.test(settingsSrc),
    'Settings accepts an initialSubpageId prop (default null)');
assert.ok(/useState\([^)]*initialSubpageId\s*\|\|\s*null\)/.test(settingsSrc),
    'Settings seeds subpageId state with the initialSubpageId prop');

// --- 2. LeftNav VIEW_GROUPS: settings + connected-sites ----------------

const navSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'LeftNav.jsx'),
    'utf8',
);
assert.ok(/settings:\s*\[\s*'settings',\s*'connected-sites'\s*\]/.test(navSrc),
    'VIEW_GROUPS.settings covers settings + connected-sites');

// --- 3. Settings footer button gets aria-current ------------------------

assert.ok(
    /onOpenSettings\s*\?[\s\S]*?isActive\('settings',\s*currentView\)[\s\S]*?aria-current=\{isActive\('settings',\s*currentView\) \? 'page' : undefined\}/.test(navSrc),
    'LeftNav Settings button receives aria-current="page" when on the settings route',
);

// --- 4. App.jsx wiring (web + desktop) ---------------------------------

const webApp = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
const desktopApp = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
    'utf8',
);

for (const [label, src] of [['web', webApp], ['desktop', desktopApp]]) {
    assert.ok(
        /import\s*\{\s*Settings\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/routes\/Settings\.jsx'/.test(src),
        `${label} App imports Settings`,
    );
    assert.ok(/const \[walletList, setWalletList\] = useState/.test(src),
        `${label} App tracks the wallet list for nav labelling`);
    assert.ok(
        /unlockedView === 'settings' \|\| unlockedView === 'connected-sites'/.test(src),
        `${label} App branches on the new top-level settings route (with connected-sites alias)`,
    );
    assert.ok(/initialSubpageId=\{[\s\S]*?'connected-sites'[\s\S]*?\}/.test(src),
        `${label} App threads initialSubpageId through to Settings on the connected-sites alias`);
    assert.ok(/const handleOpenSettings = \(\)\s*=>\s*setUnlockedView\('settings'\)/.test(src),
        `${label} App declares handleOpenSettings → setUnlockedView('settings')`);
    assert.ok(/onOpenSettings=\{handleOpenSettings\}/.test(src),
        `${label} App passes onOpenSettings into both LeftNav and BottomTabBar`);
    assert.ok(
        /const activeWalletName\s*=\s*\n?\s*walletList\.find\(\(w\)\s*=>\s*w\.id === activeWalletId\)\?\.name \|\| undefined/.test(src),
        `${label} App derives activeWalletName from walletList`,
    );
    assert.ok(/walletName=\{activeWalletName\}/.test(src),
        `${label} App passes walletName into LeftNav`);
}

console.log(
    "OK: left-nav settings-route smoke (§24 Cluster Y FOLLOWUPs 2+3 Settings.initialSubpageId, VIEW_GROUPS.settings includes connected-sites alias, Settings footer aria-current, web + desktop App.jsx track walletList, route 'settings'/'connected-sites' top-level, walletName + onOpenSettings threaded through both navs)",
);
