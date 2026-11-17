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
const confirm = read('packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.jsx');
assert.match(form, /submitMethods: \{ hw: 'sleepActionHw', software: 'sleepAction' \}/, 'signer dispatch via useActionForm');
assert.match(form, /VERSION: '1', RESUME_BLOCK: resumeBlockValue, TICK: ticker/, 'tick mode composes SLEEP v1');
assert.match(form, /VERSION: '0', RESUME_BLOCK: resumeBlockValue \}/, 'address mode composes SLEEP v0');
assert.match(form, /effectiveResumeMode === 'indefinite' \? '-1'/, 'indefinite maps to -1');
assert.match(form, /effectiveResumeMode === 'resume' \? '0'/, 'resume-now maps to 0');
assert.match(form, /sleepLocked/, 'LOCK_SLEEP gate present (tick mode)');
// The pause and address-lock warnings feed the Confirm Standard's short
// warning through the composed action: a title plus one line each (G127
// revised 2026-11-16).
const warningsCopy = read('packages', 'core', 'src', 'i18n', 'locales', 'en', 'actionWarnings.js');
assert.match(form, /actionWarnings: reviewWarningIds/, 'SLEEP passes its safety warning ids into confirmation');
assert.match(form, /actionWarningIds\(\{ action: 'SLEEP'/, 'SLEEP classifies the action it confirms');
assert.match(form, /<ConfirmActionModal[\s\S]*?composed=\{legacyComposed\}/, 'SLEEP uses the shared confirm page');
assert.match(confirm, /actionWarningIds: cardIds[\s\S]*?<ConfirmStandard\b[\s\S]*?warning=\{warning\}/,
    'ConfirmActionModal puts action warnings in the G127 short warning');
assert.match(warningsCopy, /New XChain actions with this token are rejected until the resume block\./, 'pause warning present');
assert.match(warningsCopy, /Nothing can lift the lock before its resume block\./, 'address irreversibility warning');
assert.match(form, /<DurationSlider/, 'finite pause and lock duration use the shared slider');
// A token's chain state picks pause or resume (a paused token offers only
// Resume); an address lock is always a finite duration.
assert.match(form, /const effectiveResumeMode = !isTick \? 'until'\s*\n\s*: currentState\.paused \? 'resume'/,
    'address locks always use a finite duration; a paused token resumes');
// The address lock warning is a title plus one line (G127 revised
// 2026-11-16); the native-coin caveat lives in the form's help, not here.
assert.match(warningsCopy, /'actionWarnings\.addressLock\.title': 'This address will be locked'/, 'address lock warning title present');
assert.doesNotMatch(warningsCopy, /Its native coins aren't locked/, 'address lock warning keeps one line');
assert.match(form, /facts: \[[\s\S]*?\{ label: 'Wake condition', value: wakeCondition \}/,
    'Confirm Standard facts repeat the exact wake rule');
assert.match(
    form,
    /const typedConfirmOk = isTick \|\| isExactTypedConfirmation\(typedConfirm, 'LOCK'\)/,
    'address mode requires the shared exact-match typed confirm',
);
assert.match(form, /label="Type LOCK to confirm"/, 'typed confirm uses the screen\'s own verb');
assert.ok(!/humanizeError\(err, 'sleep'\)|'Sleep failed\.'|Type SLEEP to confirm/.test(form), 'no raw SLEEP wording in user-facing copy');
assert.match(form, /interpretSleep/, 'current pause state shown');
assert.match(form, /Resume token/, 'tick mode offers resume for a paused token');
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
// The issuer's actions are groups on the one asset page (TokenOwnerActions.jsx).
const manage = read('packages', 'core', 'src', 'shared', 'components', 'TokenOwnerActions.jsx');
assert.match(manage, /onPauseToken/, 'ManageToken pause entry');
// The smoke runner reads source with t('key') swapped for its English text; a direct run reads the keys.
assert.match(manage, /label: sleepState\.paused \? (?:'Resume token'|t\('routes\.manageToken\.resumeToken'\)) : (?:'Pause token'|t\('routes\.manageToken\.pauseToken'\))/, 'pause label follows state');
assert.match(manage, /Icon: sleepState\.paused \? Icon\.UnlockIcon : Icon\.PauseIcon/, 'pause icon follows state');
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
    assert.ok(src.includes("onPauseToken: (ctx) => openOwnerForm('pause-token', ctx)"), `${shell.join('/')} wires onPauseToken`);
    assert.ok(src.includes('onLockAddress'), `${shell.join('/')} ActionsMenu offers address lock`);
}

console.log('sleep-form smoke: all assertions passed');
