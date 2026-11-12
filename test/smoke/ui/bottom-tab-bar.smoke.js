// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAB_BAR_DESTINATIONS } from '../../../packages/core/src/shared/routeRegistry.js';
import { WALLET_TAB_BAR_IDS } from '../../../packages/core/src/shared/walletMenu.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const barPath = join(core, 'src', 'shared', 'components', 'BottomTabBar.jsx');
const cssPath = join(core, 'src', 'shared', 'components', 'BottomTabBar.module.css');

assert.ok(existsSync(barPath), 'BottomTabBar.jsx exists');
assert.ok(existsSync(cssPath), 'BottomTabBar.module.css exists');

const barSrc = readFileSync(barPath, 'utf8');
const cssSrc = readFileSync(cssPath, 'utf8');

assert.deepEqual(TAB_BAR_DESTINATIONS, WALLET_TAB_BAR_IDS,
    'routeRegistry uses the catalogue tab ids');
assert.deepEqual(TAB_BAR_DESTINATIONS, ['home', 'send', 'receive', 'history', 'settings'],
    'the compact bar has the approved five destinations');
assert.ok(/TAB_BAR_DESTINATIONS\s*\.map\(tabRow\)/.test(barSrc),
    'tabs resolve through the catalogue row adapter');
assert.ok(/walletMenuRow\(id\)/.test(barSrc)
    && /label:\s*t\(row\.labelKey\)/.test(barSrc)
    && /Icon:\s*Icon\[row\.icon\]/.test(barSrc),
    'tab labels resolve at render and icons come from walletMenuRow');
assert.ok(/walletMenuRowVisible\(tab, \{ isSignerMode \}\)/.test(barSrc),
    'signer mode applies the catalogue spendable gate');
assert.ok(/tab\.id === 'settings'\) onOpenSettings\?\.\(\)/.test(barSrc),
    'Settings calls the dedicated settings callback');
assert.ok(!/sheet|moreTrigger|badges|tabDot/i.test(barSrc),
    'the tab bar has no More sheet or badge state');
assert.ok(!TAB_BAR_DESTINATIONS.includes('more'), 'More is not a tab bar destination');
assert.ok(!TAB_BAR_DESTINATIONS.includes('scan'), 'Scan is not a tab bar destination');

assert.ok(/\.bar\s*\{[\s\S]*?position:\s*absolute/.test(cssSrc),
    'the bar is anchored to the measured shell');
assert.ok(/\.bar\s*\{[\s\S]*?min-height:\s*3\.5rem/.test(cssSrc),
    'the bar reserves a scalable row');
assert.ok(/env\(safe-area-inset-bottom/.test(cssSrc),
    'the bar respects the bottom safe area');
assert.ok(!/sheetItem|sheetList|tabDot/.test(cssSrc),
    'retired sheet and unread styles are absent');

const navSrc = readFileSync(join(core, 'src', 'shared', 'components', 'LeftNav.jsx'), 'utf8');
const navCss = readFileSync(join(core, 'src', 'shared', 'components', 'LeftNav.module.css'), 'utf8');
assert.ok(/const bar = showsBottomBar\(tier\) \? bottomBar : null;/.test(navSrc),
    'the layout mounts the bar only in compact mode');
assert.ok(/\.layoutWithBottomBar > \.main\s*\{[\s\S]*?padding-bottom:\s*calc\(3\.5rem/.test(navCss),
    'compact content clears the bar');

for (const appPath of [
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
]) {
    const source = readFileSync(appPath, 'utf8');
    assert.ok(/BottomTabBar/.test(source), `${appPath} wires BottomTabBar`);
    assert.ok(/currentView=\{unlockedView\}/.test(source), `${appPath} supplies the active view`);
    assert.ok(/onOpenSettings=/.test(source), `${appPath} supplies the Settings callback`);
}

console.log('OK: bottom-tab-bar smoke (five catalogue tabs, signer gating, Settings callback, no More sheet or unread badge)');
