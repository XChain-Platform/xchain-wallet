// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-03 (token callback config + execution): the ISSUE v4
// callback-settings editor mode in TokenAdminForm (gated to
// pre-distribution + LOCK_CALLBACK aware), the danger-styled CallbackForm
// executing CALLBACK v0 with a holder-count / payout preview and
// dust-split caveat, plus the holder-distribution flow, host routes,
// 3-shell messaging, and ManageToken + App wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- ISSUE v4 config editor (TokenAdminForm callback-settings mode) ----
const admin = read('packages', 'core', 'src', 'shared', 'routes', 'TokenAdminForm.jsx');
assert.match(admin, /'callback-settings'/, 'callback-settings mode present');
assert.match(admin, /VERSION: '4', TICK/, 'callback-settings composes ISSUE v4');
assert.match(admin, /CALLBACK_BLOCK = String\(form\.callbackBlock\)/, 'CALLBACK_BLOCK emitted');
assert.match(admin, /CALLBACK_TICK = String\(form\.callbackTick\)/, 'CALLBACK_TICK emitted');
assert.match(admin, /CALLBACK_AMOUNT = String\(form\.callbackAmount\)/, 'CALLBACK_AMOUNT emitted');
assert.match(admin, /callbackLocked/, 'LOCK_CALLBACK gate present');
assert.match(admin, /callbackDistributed/, 'pre-distribution gate present');
assert.match(admin, /tokenHolderSummary/, 'distribution read wired for the editability gate');
assert.match(admin, /callbackFieldsDisabled/, 'fields disable when locked or distributed');
assert.match(admin, /callbackBlockEstimate/, 'callback block shows a date estimate');
// blank = leave unchanged: only filled fields are emitted (no empty-string writes).
assert.match(admin, /if \(form\.callbackBlock\) p\.CALLBACK_BLOCK/, 'blank callback fields are omitted');

// ---- CALLBACK execution form ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'CallbackForm.jsx');
assert.match(form, /submitMethods: \{ hw: 'callbackActionHw', software: 'callbackAction' \}/,
    'three-way signer dispatch via useActionForm');
assert.match(form, /toUpperCase\(\) === 'CALLBACK'/, 'typed-CALLBACK confirm gates signing');
assert.match(form, /tokenHolderSummary/, 'holder / payout preview wired');
assert.match(form, /Total payout/, 'total payout shown');
assert.match(form, /Holders to pay/, 'live holder count shown');
assert.match(form, /blockReached/, 'after-CALLBACK_BLOCK gate present');
assert.match(form, /configComplete/, 'blocks when no callback is configured');
assert.match(form, /split their balance across new addresses/,
    'dust-split griefing caveat present');
assert.match(form, /variant=\{isWatcherMode \? 'primary' : 'danger'\}/, 'danger-styled submit');
assert.match(form, /prebuiltPsbt/, ' single-encode confirm path forwards the composed PSBT');
assert.match(form, /WatcherResultPanel/, 'watcher encode-only result surface');

// ---- Flows ----
const flow = read('packages', 'core', 'src', 'flows', 'callbackAction.js');
assert.match(flow, /action: 'CALLBACK'/, 'callbackAction composes CALLBACK');
assert.match(flow, /params\.TICK/, 'TICK guarded');
const holders = read('packages', 'core', 'src', 'flows', 'tokenHolders.js');
assert.match(holders, /isDistributed/, 'distribution mirrors the indexer gate');
assert.match(holders, /mulFloorDecimal/, 'payout uses floor-decimal math (mirrors bcmulfloor)');
const info = read('packages', 'core', 'src', 'flows', 'tokenInfo.js');
assert.match(info, /callbackTick/, 'tokenInfo exposes the callback config');

// ---- Host + messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('action\.callback'/, 'CALLBACK host route registered');
assert.match(host, /registerHwHandler\('action\.callback\.hw', callbackAction\)/, 'HW CALLBACK route');
assert.match(host, /host\.register\('token\.holderSummary'/, 'holder-summary host route');

for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'action.callback'", "'action.callback.hw'", "'token.holderSummary'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

// ---- ManageToken + shell wiring ----
const manage = read('packages', 'core', 'src', 'shared', 'routes', 'ManageToken.jsx');
assert.match(manage, /onCallbackSettings/, 'ManageToken offers Callback settings');
assert.match(manage, /onExecuteCallback/, 'ManageToken offers Execute callback');
assert.match(manage, /!assetInfo\?\.callbackTick/, 'Execute callback only when a callback is configured');
assert.match(manage, /id: 'execute-callback'.*danger: true/s, 'Execute callback is danger-styled');

for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell);
    assert.ok(src.includes('CallbackForm'), `${shell.join('/')} imports CallbackForm`);
    assert.ok(src.includes("unlockedView === 'execute-callback'"), `${shell.join('/')} routes the callback view`);
    assert.ok(src.includes("unlockedView === 'callback-settings'"), `${shell.join('/')} routes callback-settings into TokenAdminForm`);
    assert.ok(src.includes("onCallbackSettings={() => openForm('callback-settings')}"), `${shell.join('/')} wires onCallbackSettings`);
    assert.ok(src.includes("onExecuteCallback={() => openForm('execute-callback')}"), `${shell.join('/')} wires onExecuteCallback`);
}

console.log('callback-config-execute smoke: all assertions passed');
