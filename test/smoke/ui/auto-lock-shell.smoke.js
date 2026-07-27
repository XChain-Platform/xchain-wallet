// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  smoke: idle auto-lock is mounted at the SHELL level, not in a route.
//
// History. v0.204.0 wired `useAutoLock` for popup + web; v0.205.0 made it
// settings-driven; Cluster O FOLLOWUP 1 added desktop. All three lived in
// Home.jsx, which is only one of ~113 views the shells can render, so
// navigating to Send / Receive / History / Settings unmounted Home and the
// hook's effect cleanup cancelled the pending timer. A wallet left on those
// screens never locked.  hoists the whole decision into
// `useAutoLockPolicy`, called from each shell's AppInner above the view
// switch, where nothing but a shell teardown can unmount it.
//
// Asserts:
//   1. `useAutoLock` has exactly ONE call site in the whole source tree, and
//      it is inside useAutoLockPolicy. This is the regression that matters:
//      the moment someone re-adds a route-level call, the timer starts dying
//      on navigation again.
//   2. All three shells (web, desktop, extension popup) import the policy
//      hook and call it ABOVE their `switch (status.state)`, so it survives
//      every route change.
//   3. No route under core/src/shared/routes/ calls either hook.
//   4. The shared useAutoLock hook still wires the window-level activity
//      listeners, and the policy hook still feeds the extension's
//      service-worker backstop via reportAutoLock.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const POLICY_REL = join('packages', 'core', 'src', 'shared', 'hooks', 'useAutoLockPolicy.js');
const HOOK_REL = join('packages', 'core', 'src', 'shared', 'hooks', 'useAutoLock.js');

function* walkSources(dir) {
    for (const name of readdirSync(dir).sort()) {
        if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            yield* walkSources(full);
        } else if (/\.(js|jsx)$/.test(name)) {
            yield full;
        }
    }
}

// --- 1. useAutoLock has exactly one call site, inside the policy hook ----

const callSites = [];
for (const file of walkSources(join(wsRoot, 'packages'))) {
    // Strip the declaration so `export function useAutoLock(` isn't a hit.
    const src = readFileSync(file, 'utf8').replace(/export function useAutoLock\b/g, '');
    if (/\buseAutoLock\s*\(/.test(src)) callSites.push(file.slice(wsRoot.length + 1));
}
assert.deepEqual(
    callSites,
    [POLICY_REL],
    `useAutoLock must be called only from useAutoLockPolicy; found: ${callSites.join(', ')}`,
);

// --- 2. Every shell calls the policy hook above its view switch ---------

const SHELLS = [
    join('packages', 'web', 'src', 'App.jsx'),
    join('packages', 'desktop', 'renderer', 'App.jsx'),
    join('packages', 'extension', 'src', 'popup', 'App.jsx'),
];
for (const rel of SHELLS) {
    const src = readFileSync(join(wsRoot, rel), 'utf8');
    assert.ok(
        src.includes("from '@xchain-wallet/core/shared/hooks/useAutoLockPolicy.js'"),
        `${rel} imports useAutoLockPolicy from core`,
    );
    const callAt = src.indexOf('useAutoLockPolicy({');
    assert.ok(callAt > 0, `${rel} calls useAutoLockPolicy`);
    const switchAt = src.indexOf('switch (status.state) {');
    assert.ok(switchAt > 0, `${rel} routes off status.state`);
    assert.ok(
        callAt < switchAt,
        `${rel} must call useAutoLockPolicy ABOVE the status switch so it outlives navigation`,
    );
    // The shell has to hand over its own session state and refresh, or the
    // hook can neither arm correctly nor flip the view to Locked.
    const callBlock = src.slice(callAt, callAt + 300);
    for (const prop of ['sessionState: status.state', 'activeWalletId', 'onLocked: refresh']) {
        assert.ok(
            callBlock.includes(prop),
            `${rel} passes ${prop} into useAutoLockPolicy`,
        );
    }
}

// --- 3. No shared route touches either hook -----------------------------

for (const file of walkSources(join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes'))) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(wsRoot.length + 1);
    assert.ok(
        !/\buseAutoLock(Policy)?\s*\(/.test(src),
        `${rel} must not call auto-lock hooks; routes unmount on navigation `,
    );
}

// --- 4. Activity listeners + extension backstop still wired -------------

const hookSrc = readFileSync(join(wsRoot, HOOK_REL), 'utf8');
for (const ev of ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']) {
    assert.ok(hookSrc.includes(`'${ev}'`), `shared useAutoLock still listens for ${ev}`);
}

const policySrc = readFileSync(join(wsRoot, POLICY_REL), 'utf8');
assert.ok(
    /messaging\.reportAutoLock\(\{\s*armed,\s*idleMs\s*\}\)/.test(policySrc),
    'policy hook still reports { armed, idleMs } to the extension service-worker backstop',
);
assert.ok(
    /AUTO_LOCK_SHELLS\s*=\s*[\s\S]{0,80}'popup'[\s\S]{0,40}'web'[\s\S]{0,40}'desktop'/.test(policySrc),
    'policy hook arms for popup + web + desktop',
);
assert.ok(
    /settings\?\.autolockMinutes/.test(policySrc),
    'policy hook reads autolockMinutes off the settings RECORD, not the useSettings wrapper',
);

console.log(
    'OK: auto-lock shell smoke (; useAutoLock has one call site inside '
    + 'useAutoLockPolicy, all three shells call it above their view switch, no '
    + 'route touches it, activity listeners + SW backstop intact)',
);
