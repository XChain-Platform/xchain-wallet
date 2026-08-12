// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §24.2 / G053 smoke: full-layout left navigation.
//
// Asserts:
//   1. LeftNav.jsx + LeftNav.module.css exist; LeftNav and
//      FullLayoutWithNav are named exports.
//   2. Primary nav items match the §24.2 list (Home, History, Send,
//      Receive, DEX, Dispensers, Contracts, Messaging, Contacts).
//   3. Contracts row is gated on hasBtcAddress (BTC-only per
//      BITCOIN_ACTIONS); active row gets aria-current="page".
//   4. CSS module declares a 220px sidebar, collapses it on the compact
//      layout tier and narrows it to a 64px rail on the rail tier
//, and overrides --xc-screen-h on the main pane.
//   5. web + desktop App.jsx import LeftNav + FullLayoutWithNav and
//      wrap the unlocked-route render tree in <FullLayoutWithNav>.
//      Extension popup is intentionally untouched (always compact).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. LeftNav component + CSS -----------------------------------------

const navPath = join(core, 'src', 'shared', 'components', 'LeftNav.jsx');
const cssPath = join(core, 'src', 'shared', 'components', 'LeftNav.module.css');
assert.ok(existsSync(navPath), 'LeftNav.jsx exists');
assert.ok(existsSync(cssPath), 'LeftNav.module.css exists');

const navSrc = readFileSync(navPath, 'utf8');
assert.ok(/export function LeftNav\b/.test(navSrc), 'LeftNav is a named export');
assert.ok(/export function FullLayoutWithNav\b/.test(navSrc),
    'FullLayoutWithNav is a named export');

// --- 2. Primary nav items -----------------------------------------------

const expectedPrimaryLabels = [
    'Home', 'History', 'Send', 'Receive', 'Scan', 'DEX',
    'Dispensers', 'Contracts', 'Messaging',
];
for (const label of expectedPrimaryLabels) {
    assert.ok(
        new RegExp(`label:\\s*'${label}'`).test(navSrc),
        `LeftNav primary list includes ${label} item`,
    );
}
assert.ok(/label:\s*'Contacts'/.test(navSrc),
    'LeftNav secondary list includes Contacts row');

// View → nav-item mappings keep the active highlight on drilldown views.
assert.ok(/'token-detail'/.test(navSrc) && /'addresses'/.test(navSrc),
    'LeftNav home group covers token-detail + addresses drilldowns');
assert.ok(/'compose-message'/.test(navSrc),
    'LeftNav messaging group covers compose-message drilldown');
assert.ok(/'dispenser-detail'/.test(navSrc) && /'dispenser-explorer'/.test(navSrc),
    'LeftNav dispensers group covers dispenser-detail + dispenser-explorer');
assert.ok(/'staking-dashboard'/.test(navSrc) && /'contract-deploy'/.test(navSrc),
    'LeftNav contracts group covers staking + contract drilldowns');

// --- 3. hasBtcAddress gate + aria-current --------------------------------

assert.ok(/hasBtcAddress\s*\?[\s\S]*?'contracts-list'/.test(navSrc),
    'Contracts row only appears when hasBtcAddress is true');
assert.ok(/aria-current=\{active \? 'page' : undefined\}/.test(navSrc),
    'Active row receives aria-current="page"');

// Footer rows.
assert.ok(/onLock\s*\?[\s\S]*?Lock/.test(navSrc),
    'LeftNav footer renders Lock when onLock is provided');
assert.ok(/onOpenWalletPicker[\s\S]*?walletSwitcher/.test(navSrc),
    'LeftNav footer renders the wallet switcher when onOpenWalletPicker is provided');

// --- 4. CSS module: sidebar width + breakpoint ---------------------------

const cssSrc = readFileSync(cssPath, 'utf8');
assert.ok(/\.sidebar\s*\{[\s\S]*?flex:\s*0 0 220px/.test(cssSrc),
    '.sidebar reserves a 220px column');
// The collapse is keyed on the layout tier that FullLayoutWithNav
// measures, not on a viewport media query, so a 360px popup or preview frame
// inside a wide window collapses too.
assert.ok(/\.layout\[data-xc-tier='compact'\]\s+\.sidebar\s*\{[\s\S]*?display:\s*none/.test(cssSrc),
    '.sidebar collapses on the compact tier');
assert.ok(/\.layout\[data-xc-tier='rail'\]\s+\.sidebar\s*\{[\s\S]*?flex:\s*0 0 64px/.test(cssSrc),
    '.sidebar narrows to a 64px icon rail on the rail tier');
assert.ok(/--xc-screen-h:\s*100%/.test(cssSrc),
    '.main overrides --xc-screen-h so the route Screen fills the flex pane');

// --- 5. App.jsx wiring (web + desktop only) -----------------------------

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
        /import\s*\{\s*LeftNav,\s*FullLayoutWithNav\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/components\/LeftNav\.jsx'/.test(src),
        `${label} App imports LeftNav + FullLayoutWithNav`,
    );
    assert.ok(/<FullLayoutWithNav\b/.test(src),
        `${label} App wraps the unlocked-route tree in <FullLayoutWithNav>`);
    assert.ok(/<LeftNav\b[\s\S]*?currentView=\{unlockedView\}/.test(src),
        `${label} App passes the active unlockedView into LeftNav`);
    // onLock is wired through a small handler that calls lockWallet();
    // accept either the inline arrow form (Step 1 ship) or the named
    // handler form (Step 2 ship; both LeftNav and BottomTabBar share
    // the lock callback).
    assert.ok(
        /onLock=\{\(\)\s*=>\s*\{[\s\S]*?lockWallet\(\)/.test(src)
            || (/const handleNavLock = \(\)\s*=>\s*\{[\s\S]*?lockWallet\(\)/.test(src)
                && /onLock=\{handleNavLock\}/.test(src)),
        `${label} App wires LeftNav.onLock through lockWallet()`,
    );
}

assert.ok(!/LeftNav/.test(popupApp),
    'Extension popup intentionally does NOT mount LeftNav (always compact per §24.1)');

console.log(
    'OK: left-nav smoke (§24.2 / G053 LeftNav + FullLayoutWithNav exports; primary list Home/History/Send/Receive/Scan/DEX/Dispensers/Contracts/Messaging + Contacts secondary; Contracts gated on hasBtcAddress; active row aria-current="page"; 220px sidebar, 64px rail tier, collapsed on compact; web + desktop App.jsx wrap unlocked tree, popup left compact)',
);
