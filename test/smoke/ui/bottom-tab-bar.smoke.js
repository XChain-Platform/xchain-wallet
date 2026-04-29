// §24.3 / G054 smoke — mobile bottom-tab bar + bottom-sheet drawer.
//
// Asserts:
//   1. BottomTabBar.jsx + BottomTabBar.module.css exist; BottomTabBar
//      is a named export.
//   2. The five primary tabs are Home / History / Send / Receive /
//      More (the daily-use pair on mobile + an overflow drawer); the
//      "More" button toggles a bottom sheet via aria-expanded.
//   3. The sheet lists the rest of the §24.2 nav (DEX, Dispensers,
//      Contracts, Messaging, Contacts) plus the optional footer items
//      (Switch wallet / Settings / Lock); Contracts is gated on
//      hasBtcAddress.
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

const expectedPrimary = ['Home', 'History', 'Send', 'Receive'];
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

const sheetLabels = ['DEX', 'Dispensers', 'Contracts', 'Messaging', 'Contacts'];
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
assert.ok(/FullLayoutWithNav\(\{ nav, bottomBar, children \}\)/.test(navJsxSrc),
    'FullLayoutWithNav exposes a bottomBar slot');
assert.ok(/\{bottomBar \? <div className=\{styles\.bottomBarSlot\}>\{bottomBar\}<\/div>/.test(navJsxSrc),
    'FullLayoutWithNav renders the bottomBar slot when provided');

const navCssPath = join(core, 'src', 'shared', 'components', 'LeftNav.module.css');
const navCssSrc = readFileSync(navCssPath, 'utf8');
assert.ok(/\.bottomBarSlot\b[\s\S]*?display:\s*contents/.test(navCssSrc),
    'bottomBar slot uses display:contents so the fixed bar stays at viewport');
assert.ok(/@media\s*\(\s*min-width:\s*601px\s*\)\s*\{[\s\S]*?\.bottomBarSlot\s*\{[\s\S]*?display:\s*none/.test(navCssSrc),
    'bottomBar slot collapses above 600px');
assert.ok(/@media\s*\(\s*max-width:\s*600px\s*\)\s*\{[\s\S]*?\.layoutWithBottomBar > \.main\s*\{[\s\S]*?padding-bottom:\s*calc\(56px/.test(navCssSrc),
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
    assert.ok(/bottomBar=\{\s*<BottomTabBar/.test(src),
        `${label} App passes <BottomTabBar> into FullLayoutWithNav.bottomBar`);
}

assert.ok(!/BottomTabBar/.test(popupApp),
    'Extension popup intentionally does NOT mount BottomTabBar (always compact per §24.1)');

console.log(
    'OK — bottom-tab-bar smoke (§24.3 / G054 BottomTabBar with Home/History/Send/Receive primary tabs + More-toggled sheet listing DEX/Dispensers/Contracts(BTC-gated)/Messaging/Contacts + Switch wallet/Settings/Lock; 56px fixed bar with iOS safe-area inset; FullLayoutWithNav.bottomBar slot collapses above 600px; web + desktop App.jsx wire it through; popup left compact)',
);
