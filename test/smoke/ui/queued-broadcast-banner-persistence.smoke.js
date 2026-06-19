// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §49 / Cluster G FOLLOWUP 4 smoke: QueuedBroadcastBanner mounted in
// the FullLayoutWithNav header slot so the banner persists across
// every unlocked view (Send, History, Markets, …) instead of only
// rendering above Home.
//
// Asserts:
//   1. FullLayoutWithNav grew a `header` slot rendered above the
//      route content.
//   2. CSS module declares `.header` (flex 0 0 auto) and `.mainBody`
//      (flex 1 1 auto with --xc-screen-h reset) so the banner sits
//      above a Screen child that still fills the remaining space.
//   3. Web App.jsx no longer mounts QueuedBroadcastBanner above the
//      Home fallback; it's now in the FullLayoutWithNav.header slot.
//   4. Desktop App.jsx imports QueuedBroadcastBanner and threads it
//      through the same header slot (it never had the Home-only
//      mount before this change).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. FullLayoutWithNav header slot -----------------------------------

const navJsx = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'LeftNav.jsx'),
    'utf8',
);
assert.ok(/FullLayoutWithNav\(\{ nav, bottomBar, header, children \}\)/.test(navJsx),
    'FullLayoutWithNav exposes a header slot');
assert.ok(
    /\{header \? <div className=\{styles\.header\}>\{header\}<\/div> : null\}/.test(navJsx),
    'FullLayoutWithNav renders the header above the route body when supplied',
);
assert.ok(/<div className=\{styles\.mainBody\}>\{children\}<\/div>/.test(navJsx),
    'route body wrapped in .mainBody so the header + body share the main flex column');

// --- 2. CSS supports the new flex column --------------------------------

const navCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'LeftNav.module.css'),
    'utf8',
);
assert.ok(/\.main\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column/.test(navCss),
    '.main becomes a flex column so header + body stack');
assert.ok(/\.header\s*\{[\s\S]*?flex:\s*0 0 auto/.test(navCss),
    '.header takes natural height (flex: 0 0 auto)');
assert.ok(/\.mainBody\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?--xc-screen-h:\s*100%/.test(navCss),
    '.mainBody fills remaining space + resets --xc-screen-h for the Screen child');

// --- 3. Web App.jsx no longer Home-mounts the banner --------------------

const webApp = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
assert.ok(
    !/<>\s*\n?\s*\{activeWalletId \? <QueuedBroadcastBanner walletId=\{activeWalletId\}/.test(webApp),
    'web App no longer mounts QueuedBroadcastBanner above the Home fallback',
);
// The header slot now holds a fragment with multiple children (AppHeader,
// DemoBanner, QueuedBroadcastBanner, ReachabilityBanner); assert the banner
// appears inside the activeWalletId-guarded header= prop.
assert.ok(
    /header=\{[\s\S]{0,2000}activeWalletId[\s\S]{0,3000}<QueuedBroadcastBanner walletId=\{activeWalletId\}/.test(webApp),
    'web App routes the banner through FullLayoutWithNav.header',
);

// --- 4. Desktop App.jsx wires the banner through the header slot --------

const desktopApp = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
    'utf8',
);
assert.ok(
    /import\s*\{\s*QueuedBroadcastBanner\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/components\/QueuedBroadcastBanner\.jsx'/.test(desktopApp),
    'desktop App imports QueuedBroadcastBanner',
);
assert.ok(
    /header=\{[\s\S]{0,2000}activeWalletId[\s\S]{0,3000}<QueuedBroadcastBanner walletId=\{activeWalletId\}/.test(desktopApp),
    'desktop App routes the banner through FullLayoutWithNav.header',
);

console.log(
    'OK: queued-broadcast-banner-persistence smoke (§49 / Cluster G FOLLOWUP 4: FullLayoutWithNav.header slot mounts QueuedBroadcastBanner above every unlocked view; .mainBody flex column resets --xc-screen-h; web App drops the Home-only mount; desktop App gains the banner for the first time)',
);
