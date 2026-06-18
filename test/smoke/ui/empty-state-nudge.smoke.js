// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §27.7 / §28 / G077: EmptyStateNudge component + integration
// into BalanceList, History, and AddressList.
//
// (Cluster I FOLLOWUP 7 closed at v0.287.0 retired UnifiedBalanceList;
//  it had been an orphaned variant since the BalanceList consolidation;
//  the previous "UnifiedBalanceList parity" assertions are gone.)
//
// Verifies:
//   1. EmptyStateNudge.jsx + module.css exist; component is named export
//      with title / body / actionLabel / onAction / icon props.
//   2. BalanceList renders <EmptyStateNudge> instead of bare <p>; old
//      `emptyMessage` prop is renamed to `emptyTitle` + `emptyBody`.
//   3. HomeTabs accepts + forwards `onReceive` so the empty-state
//      nudges show the Receive CTA.
//   4. Home.jsx threads `onReceive` into HomeTabs.
//   5. History + AddressList accept an `onReceive` prop and render
//      <EmptyStateNudge> with a Receive CTA in their empty states.
//   6. Web + extension App.jsx wire `onReceive` into both routes.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const components = join(core, 'src', 'shared', 'components');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. EmptyStateNudge itself --------------------------------------------

const nudgePath = join(components, 'EmptyStateNudge.jsx');
const nudgeCss = join(components, 'EmptyStateNudge.module.css');
assert.ok(existsSync(nudgePath), 'EmptyStateNudge.jsx exists');
assert.ok(existsSync(nudgeCss), 'EmptyStateNudge.module.css exists');

const nudgeSrc = readFileSync(nudgePath, 'utf8');
assert.ok(/export function EmptyStateNudge\b/.test(nudgeSrc), 'EmptyStateNudge is a named export');
for (const prop of ['title', 'body', 'actionLabel', 'onAction', 'icon']) {
    assert.ok(
        new RegExp(`\\b${prop}\\b`).test(nudgeSrc),
        `EmptyStateNudge accepts ${prop} prop`,
    );
}
assert.ok(
    /actionLabel\s*&&\s*onAction/.test(nudgeSrc),
    'EmptyStateNudge only renders the button when both actionLabel + onAction are supplied',
);

// --- 2. BalanceList swaps the bare <p> for <EmptyStateNudge> --------------

const balanceListSrc = readFileSync(join(components, 'BalanceList.jsx'), 'utf8');
assert.ok(
    /from\s*['"]\.\/EmptyStateNudge\.jsx['"]/.test(balanceListSrc),
    'BalanceList imports EmptyStateNudge',
);
assert.ok(
    /<EmptyStateNudge\b/.test(balanceListSrc),
    'BalanceList renders <EmptyStateNudge> in its empty branch',
);
assert.ok(
    /emptyTitle/.test(balanceListSrc) && /emptyBody/.test(balanceListSrc),
    'BalanceList exposes emptyTitle + emptyBody props (replaces the old emptyMessage)',
);
assert.ok(
    /\bonReceive\b/.test(balanceListSrc),
    'BalanceList accepts onReceive prop forwarded to the nudge',
);
assert.ok(
    !/<p\s+className=\{styles\.empty\}/.test(balanceListSrc),
    'BalanceList no longer renders the bare <p className=empty> placeholder',
);

// --- 3. HomeTabs forwards onReceive --------------------------------------

const homeTabsSrc = readFileSync(join(components, 'HomeTabs.jsx'), 'utf8');
assert.ok(
    /\bonReceive\b/.test(homeTabsSrc),
    'HomeTabs accepts the onReceive prop',
);
assert.ok(
    /onReceive=\{networkFilter === 'all' \? onReceive : undefined\}/.test(homeTabsSrc),
    'HomeTabs only forwards onReceive when the filter is "all"; network-filtered empty states avoid the misleading CTA',
);

// --- 4. Home.jsx threads onReceive into HomeTabs --------------------------

const homeSrc = readFileSync(join(routes, 'Home.jsx'), 'utf8');
assert.ok(
    /<HomeTabs[\s\S]+?onReceive=\{onReceive\}/.test(homeSrc),
    'Home.jsx threads onReceive into HomeTabs',
);

// --- 5. History + AddressList ---------------------------------------------

const historySrc = readFileSync(join(routes, 'History.jsx'), 'utf8');
assert.ok(
    /from\s*['"]\.\.\/components\/EmptyStateNudge\.jsx['"]/.test(historySrc),
    'History imports EmptyStateNudge',
);
assert.ok(
    /onReceive/.test(historySrc),
    'History accepts onReceive prop',
);
assert.ok(
    (historySrc.match(/<EmptyStateNudge\b/g) || []).length >= 2,
    'History renders <EmptyStateNudge> in both empty branches (no addresses + no entries)',
);

const addrSrc = readFileSync(join(routes, 'AddressList.jsx'), 'utf8');
assert.ok(
    /from\s*['"]\.\.\/components\/EmptyStateNudge\.jsx['"]/.test(addrSrc),
    'AddressList imports EmptyStateNudge',
);
assert.ok(
    /onReceive/.test(addrSrc),
    'AddressList accepts onReceive prop',
);
assert.ok(
    /<EmptyStateNudge\b/.test(addrSrc),
    'AddressList renders <EmptyStateNudge> in its empty branch',
);

// --- 6. App.jsx wires onReceive into both routes -------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    // History
    const histIdx = app.indexOf("unlockedView === 'history'");
    assert.ok(histIdx >= 0, `${shell} App.jsx tracks the history sub-route`);
    const histBlock = app.slice(histIdx, histIdx + 400);
    assert.ok(
        /onReceive=\{\(\)\s*=>\s*setUnlockedView\('receive'\)\}/.test(histBlock),
        `${shell} App.jsx wires onReceive into <History>`,
    );
    // AddressList
    const addrIdx = app.indexOf("unlockedView === 'addresses'");
    assert.ok(addrIdx >= 0, `${shell} App.jsx tracks the addresses sub-route`);
    const addrBlock = app.slice(addrIdx, addrIdx + 400);
    assert.ok(
        /onReceive=\{\(\)\s*=>\s*setUnlockedView\('receive'\)\}/.test(addrBlock),
        `${shell} App.jsx wires onReceive into <AddressList>`,
    );
}
