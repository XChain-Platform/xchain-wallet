// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ROUTE_NAV_GROUPS,
    SIDEBAR_PRIMARY_DESTINATIONS,
    SIDEBAR_SECONDARY_DESTINATIONS,
} from '../../../packages/core/src/shared/routeRegistry.js';
import { walletMenuRow } from '../../../packages/core/src/shared/walletMenu.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const navPath = join(core, 'src', 'shared', 'components', 'LeftNav.jsx');
const cssPath = join(core, 'src', 'shared', 'components', 'LeftNav.module.css');

assert.ok(existsSync(navPath), 'LeftNav.jsx exists');
assert.ok(existsSync(cssPath), 'LeftNav.module.css exists');

const navSrc = readFileSync(navPath, 'utf8');
const cssSrc = readFileSync(cssPath, 'utf8');

assert.ok(/export function LeftNav\b/.test(navSrc), 'LeftNav is exported');
assert.ok(/export function FullLayoutWithNav\b/.test(navSrc), 'FullLayoutWithNav is exported');

for (const id of [...SIDEBAR_PRIMARY_DESTINATIONS, ...SIDEBAR_SECONDARY_DESTINATIONS]) {
    assert.ok(walletMenuRow(id), `LeftNav destination ${id} exists in the catalogue`);
}
assert.ok(/walletMenuRow\(id\)/.test(navSrc) && /Icon\[row\.icon\]/.test(navSrc),
    'LeftNav resolves labels and icons from walletMenuRow');
assert.ok(/walletMenuRowVisible\(item, gates\)/.test(navSrc),
    'LeftNav applies catalogue visibility gates');
assert.ok(!/LEFT_NAV_ITEMS|formatBadgeCount|styles\.badge|badges\s*=/.test(navSrc),
    'LeftNav has no duplicate catalogue or unread badge state');
assert.ok(/navItem\('settings'\)/.test(navSrc) && /navItem\('lock'\)/.test(navSrc),
    'Settings and Lock use catalogue rows');
assert.ok(/aria-current=\{active \? 'page' : undefined\}/.test(navSrc),
    'active destination rows expose aria-current');

assert.ok(['token-detail', 'addresses'].every((route) => ROUTE_NAV_GROUPS.home.includes(route)),
    'Home drilldowns retain their section');
assert.ok(ROUTE_NAV_GROUPS.messaging.includes('compose-message'),
    'Messaging drilldowns retain their section');
assert.ok(ROUTE_NAV_GROUPS['contracts-list'].includes('staking-dashboard'),
    'staking remains under the Contracts section');

assert.ok(/\.sidebar\s*\{[\s\S]*?flex:\s*0 0 220px/.test(cssSrc),
    'the full sidebar reserves 220px');
assert.ok(/\.layout\[data-xc-tier='compact'\]\s+\.sidebar\s*\{[\s\S]*?display:\s*none/.test(cssSrc),
    'the sidebar hides in compact mode');
assert.ok(/\.layout\[data-xc-tier='rail'\]\s+\.sidebar\s*\{[\s\S]*?flex:\s*0 0 64px/.test(cssSrc),
    'the rail reserves 64px');
assert.ok(!/\.badge\s*\{/.test(cssSrc), 'unread badge styles are absent');

for (const appPath of [
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
]) {
    const source = readFileSync(appPath, 'utf8');
    assert.ok(/FullLayoutWithNav/.test(source), `${appPath} uses FullLayoutWithNav`);
    assert.ok(/LeftNav/.test(source), `${appPath} wires LeftNav`);
    assert.ok(/currentView=\{unlockedView\}/.test(source), `${appPath} supplies the active view`);
}

const popupApp = readFileSync(join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'), 'utf8');
assert.ok(!/<LeftNav[\s>/]/.test(popupApp), 'the compact extension does not mount LeftNav');
assert.ok(/BottomTabBar/.test(popupApp), 'the compact extension mounts BottomTabBar');

console.log('OK: left-nav smoke (catalogue rows, no unread badges, active route state, responsive rail and sidebar)');
