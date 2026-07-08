// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster O FOLLOWUP 1 smoke: auto-lock active for the desktop shell.
//
// v0.204.0 wired `useAutoLock` for popup + web only; v0.205.0 made it
// settings-driven; this FOLLOWUP extends the enable gate to include
// 'desktop' so an idle Electron renderer auto-locks on the same
// cadence the other shells use.
//
// Asserts:
//   1. Home.jsx's useAutoLock enable predicate covers all three shells
//      (popup + web + desktop) with the !locking guard preserved.
//   2. The shared useAutoLock hook still wires window-level listeners
//      for the activity events (mousemove / keydown / scroll / click /
//      touchstart). Electron renderer is Chromium so the same hook
//      works unchanged.
//   3. The hook's header comment no longer claims web is the lone opt-out.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Home.jsx enable predicate covers desktop -------------------------

const homeSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
// The enable predicate is computed into `autoLockEnabled` (then passed to
// useAutoLock AND reported to the background backstop via reportAutoLock).
// Allow for additional &&-chained guards after !locking (e.g. !isDemoActive)
// without requiring them to be listed here.
assert.ok(
    /autoLockEnabled\s*=\s*\(shell === 'popup' \|\| shell === 'web' \|\| shell === 'desktop'\)[\s\S]{0,100}&& !locking/.test(homeSrc),
    'Home autoLockEnabled predicate covers popup + web + desktop and preserves !locking',
);
assert.ok(
    /useAutoLock\(handleLock,\s*\{\s*enabled:\s*autoLockEnabled/.test(homeSrc),
    'Home passes autoLockEnabled into useAutoLock',
);

// --- 2. Shared hook still listens for activity events --------------------

const hookSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useAutoLock.js'),
    'utf8',
);
for (const ev of ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']) {
    assert.ok(
        new RegExp(`'${ev}'`).test(hookSrc),
        `shared useAutoLock still listens for ${ev}`,
    );
}

// --- 3. Comment no longer pins web as the sole opt-out -------------------

assert.ok(
    !/today: web/.test(hookSrc),
    'useAutoLock header no longer claims "today: web"; all three shells opt in',
);
assert.ok(
    /All three shells \(popup, web, desktop\) opt in/.test(hookSrc),
    'useAutoLock header documents the new tri-shell behaviour',
);

console.log(
    'OK: auto-lock desktop smoke (Cluster O FOLLOWUP 1; useAutoLock enable predicate covers desktop alongside popup + web; activity listeners unchanged; hook header reflects the new tri-shell behaviour)',
);
