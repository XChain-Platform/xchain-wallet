// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-05 (pause / SLEEP): the SleepForm's two modes (tick
// pause/resume via SLEEP v1, address self-lock via SLEEP v0), the
// sleep-state flow, host routes, 3-shell messaging, ManageToken pause
// entry + paused badge, and the ActionsMenu address-lock entry.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- The form ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'SleepForm.jsx');
assert.match(form, /submitMethods: \{ hw: 'sleepActionHw', software: 'sleepAction' \}/, 'signer dispatch via useActionForm');
assert.match(form, /VERSION: '1', RESUME_BLOCK: resumeBlockValue, TICK: ticker/, 'tick mode composes SLEEP v1');
assert.match(form, /VERSION: '0', RESUME_BLOCK: resumeBlockValue \}/, 'address mode composes SLEEP v0');
assert.match(form, /resumeMode === 'indefinite' \? '-1'/, 'indefinite maps to -1');
assert.match(form, /resumeMode === 'resume' \? '0'/, 'resume-now maps to 0');
assert.match(form, /sleepLocked/, 'LOCK_SLEEP gate present (tick mode)');
assert.match(form, /does not stop already-open orders, swaps, or dispensers/, 'settle caveat present');
assert.match(form, /one-way freeze|cannot be undone before the resume block/, 'address irreversibility warning');
assert.match(form, /toUpperCase\(\) === 'SLEEP'/, 'address mode requires a typed confirm');
assert.match(form, /interpretSleep/, 'current pause state shown');
assert.match(form, /Resume now \(unpause\)/, 'tick mode offers resume');
// Address mode must NOT offer resume-now (an address sleep can't be lifted early).
assert.ok(!/name="sleep-mode" checked=\{resumeMode === 'resume'\}[^]*?disabled=\{sleepLocked\}[^]*?address/.test(form),
    'resume radio is tick-only');

// ---- Flows ----
const flow = read('packages', 'core', 'src', 'flows', 'sleepAction.js');
assert.match(flow, /action: 'SLEEP'/, 'sleepAction composes SLEEP');
assert.match(flow, /params\.TICK is required for a tick sleep/, 'v1 requires TICK');
const q = read('packages', 'core', 'src', 'flows', 'sleepQueries.js');
assert.match(q, /getSleeps/, 'state read via getSleeps');
assert.match(q, /resumeBlock === -1/, 'interpretSleep handles indefinite');

// ---- Host + messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('action\.sleep'/, 'SLEEP host route');
assert.match(host, /registerHwHandler\('action\.sleep\.hw', sleepAction\)/, 'HW SLEEP route');
assert.match(host, /host\.register\('sleep\.state'/, 'sleep-state host route');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'action.sleep'", "'action.sleep.hw'", "'sleep.state'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

// ---- ManageToken + ActionsMenu + shell wiring ----
const manage = read('packages', 'core', 'src', 'shared', 'routes', 'ManageToken.jsx');
assert.match(manage, /onPauseToken/, 'ManageToken pause entry');
assert.match(manage, /sleepState\.paused \? 'Resume token' : 'Pause token'/, 'pause label follows state');
assert.match(manage, /sleepState\.paused \? \(/, 'paused badge present');
assert.match(manage, /interpretSleep/, 'ManageToken reads pause state');

for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell);
    assert.ok(src.includes('SleepForm'), `${shell.join('/')} imports SleepForm`);
    assert.ok(src.includes("unlockedView === 'pause-token'"), `${shell.join('/')} routes pause-token`);
    assert.ok(src.includes("unlockedView === 'lock-address'"), `${shell.join('/')} routes lock-address`);
    assert.ok(src.includes('mode="tick"'), `${shell.join('/')} passes tick mode`);
    assert.ok(src.includes('mode="address"'), `${shell.join('/')} passes address mode`);
    assert.ok(src.includes("onPauseToken={() => openForm('pause-token')}"), `${shell.join('/')} wires onPauseToken`);
    assert.ok(src.includes('onLockAddress'), `${shell.join('/')} ActionsMenu offers address lock`);
}

console.log('sleep-form smoke: all assertions passed');
