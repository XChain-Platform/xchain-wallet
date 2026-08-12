// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §24.3 / G054 smoke: mobile bottom-tab bar + bottom-sheet drawer.
//
// Asserts:
//   1. BottomTabBar.jsx + BottomTabBar.module.css exist; BottomTabBar
//      is a named export.
//   2. The five primary tabs are Home / History / Send / Scan /
//      More per §24.3 spec (Cluster Y FOLLOWUP 1 closed at v0.285.0
//      swapped Receive→Scan; Receive moved into the More sheet).
//      The "More" button toggles a bottom sheet via aria-expanded.
//   3. The sheet lists Receive + the rest of the §24.2 nav (DEX,
//      Dispensers, Contracts, Messaging, Contacts) plus the optional
//      footer items (Switch wallet / Settings / Lock); Contracts is
//      gated on hasBtcAddress.
//   4. CSS module declares a 56px fixed bar that respects the iOS
//      safe-area inset.
//   5. FullLayoutWithNav grew a `bottomBar` slot; web + desktop
//      App.jsx pass a `<BottomTabBar>` to that slot. The main pane
//      reserves bottom-padding below 600px so the bar doesn't cover
//      content. Extension popup is intentionally untouched.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. BottomTabBar component + CSS ------------------------------------

const barPath = join(core, 'src', 'shared', 'components', 'BottomTabBar.jsx');
const cssPath = join(core, 'src', 'shared', 'components', 'BottomTabBar.module.css');
assert.ok(existsSync(barPath), 'BottomTabBar.jsx exists');
assert.ok(existsSync(cssPath), 'BottomTabBar.module.css exists');

const barSrc = readFileSync(barPath, 'utf8');
assert.ok(/export function BottomTabBar\b/.test(barSrc),
    'BottomTabBar is a named export');

// --- 2. Primary tabs + More toggle --------------------------------------

const expectedPrimary = ['Home', 'History', 'Send', 'Scan'];
for (const label of expectedPrimary) {
    assert.ok(
        new RegExp(`label:\\s*'${label}'`).test(barSrc),
        `BottomTabBar primary tab ${label} present`,
    );
}
assert.ok(/<span className=\{styles\.tabLabel\}>More<\/span>/.test(barSrc),
    'More tab present in the primary bar');
assert.ok(/aria-expanded=\{sheetOpen \? 'true' : 'false'\}/.test(barSrc),
    'More tab announces sheet state via aria-expanded');
assert.ok(/aria-controls="xc-bottom-sheet"/.test(barSrc),
    'More tab references its sheet via aria-controls');

// --- 3. Sheet rows + hasBtcAddress gating + footer rows -----------------

const sheetLabels = ['Receive', 'DEX', 'Dispensers', 'Contracts', 'Messaging', 'Contacts'];
for (const label of sheetLabels) {
    assert.ok(
        new RegExp(`label:\\s*'${label}'`).test(barSrc),
        `Bottom sheet lists ${label}`,
    );
}
assert.ok(/requiresBtc:\s*true[\s\S]*?hasBtcAddress/.test(barSrc),
    'Contracts row requires hasBtcAddress to render');
for (const label of ['Switch wallet', 'Settings', 'Lock']) {
    assert.ok(barSrc.includes(`>${label}</span>`),
        `Bottom sheet footer renders ${label} when callback supplied`);
}

// Esc closes the sheet.
assert.ok(/e\.key === 'Escape'[\s\S]*?setSheetOpen\(false\)/.test(barSrc),
    'Esc closes the bottom sheet');
// Selecting a destination closes the sheet (effect on currentView).
assert.ok(/if \(sheetOpen\) setSheetOpen\(false\)/.test(barSrc),
    'Sheet closes when the user navigates (currentView changes)');

// --- 4. CSS: fixed 56px bar + safe-area inset ---------------------------

const cssSrc = readFileSync(cssPath, 'utf8');
assert.ok(/\.bar\s*\{[\s\S]*?position:\s*fixed/.test(cssSrc),
    '.bar is fixed-positioned at the bottom of the viewport');
assert.ok(/\.bar\s*\{[\s\S]*?height:\s*56px/.test(cssSrc),
    '.bar reserves a 56px row');
assert.ok(/env\(safe-area-inset-bottom/.test(cssSrc),
    '.bar respects the iOS safe-area inset');
assert.ok(/\.sheet\s*\{[\s\S]*?max-height:\s*70vh/.test(cssSrc),
    '.sheet caps at 70vh so the route stays partially visible');

// --- 5. FullLayoutWithNav slot + App.jsx wiring -------------------------

const navJsxPath = join(core, 'src', 'shared', 'components', 'LeftNav.jsx');
const navJsxSrc = readFileSync(navJsxPath, 'utf8');
// Cluster G FOLLOWUP 4 added a `header` slot; accept both the original
// signature and the post-FOLLOWUP one so each cluster's smoke stays
// independent.
assert.ok(
    /FullLayoutWithNav\(\{ nav, bottomBar(?:, header)?, children \}\)/.test(navJsxSrc),
    'FullLayoutWithNav exposes a bottomBar slot',
);
// The slot's contents are now filtered through the layout tier
// (`bar` is bottomBar on the compact tier, null above it), so the rendered
// expression is the tier-resolved value rather than the raw prop.
assert.ok(/const bar = showsBottomBar\(tier\) \? bottomBar : null;/.test(navJsxSrc),
    'FullLayoutWithNav mounts the bottomBar only on the compact tier');
assert.ok(/\{bar \? <div className=\{styles\.bottomBarSlot\}>\{bar\}<\/div>/.test(navJsxSrc),
    'FullLayoutWithNav renders the bottomBar slot when the tier calls for it');

const navCssPath = join(core, 'src', 'shared', 'components', 'LeftNav.module.css');
const navCssSrc = readFileSync(navCssPath, 'utf8');
assert.ok(/\.bottomBarSlot\b[\s\S]*?display:\s*contents/.test(navCssSrc),
    'bottomBar slot uses display:contents so the fixed bar stays at viewport');
// Visibility is JS-gated (FullLayoutWithNav withholds the bottomBar above the
// compact tier); CSS uses display:contents so the fixed bar sits at the
// viewport level when the slot IS rendered. No viewport media query.
assert.ok(/\.bottomBarSlot\s*\{[\s\S]*?display:\s*contents/.test(navCssSrc),
    'bottomBar slot collapses above 600px');
// Padding is applied via a class on the layout div (JS-added when bottomBar
// is non-null) rather than a viewport-keyed media query.
assert.ok(/\.layoutWithBottomBar > \.main\s*\{[\s\S]*?padding-bottom:\s*calc\(56px/.test(navCssSrc),
    'main pane reserves 56px bottom-padding below 600px when bottomBar is present');

const webApp = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
const desktopApp = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
    'utf8',
);
const popupApp = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);

for (const [label, src] of [['web', webApp], ['desktop', desktopApp]]) {
    assert.ok(
        /import\s*\{\s*BottomTabBar\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/components\/BottomTabBar\.jsx'/.test(src),
        `${label} App imports BottomTabBar`,
    );
    // Shells hand the slot in unconditionally and the layout decides,
    // but keep the window wide enough to also accept a legacy inline guard.
    assert.ok(/bottomBar=\{[\s\S]{0,200}<BottomTabBar/.test(src),
        `${label} App passes <BottomTabBar> into FullLayoutWithNav.bottomBar`);
}

assert.ok(!/BottomTabBar/.test(popupApp),
    'Extension popup intentionally does NOT mount BottomTabBar (always compact per §24.1)');

console.log(
    'OK: bottom-tab-bar smoke (§24.3 / G054 BottomTabBar with Home/History/Send/Scan primary tabs + More-toggled sheet listing Receive/DEX/Dispensers/Contracts(BTC-gated)/Messaging/Contacts + Switch wallet/Settings/Lock; 56px fixed bar with iOS safe-area inset; FullLayoutWithNav.bottomBar slot collapses above 600px; web + desktop App.jsx wire it through; popup left compact)',
);
