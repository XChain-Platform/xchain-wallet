// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-02: Granular lock-matrix smoke (ISSUE v3). Replaces the coarse
// single "Lock" action (VERSION=3, hardcoded LOCK_MAX_SUPPLY +
// LOCK_MINT) with a matrix over all seven independent, one-way ISSUE
// v3 flags. Mirrors token-mint-settings-form.smoke.js's structure for
// the same 'lock' mode this smoke targets.
//
// Asserts:
//   1. LOCK_FLAGS lists all seven flags (key/field/label/hint), each
//      keyed to the getToken `locks` field name and its ISSUE wire param.
//   2. `composeAdminParams('lock', ...)` builds ISSUE VERSION=3 with
//      one LOCK_* field per newly-checked flag, never re-sending a flag
//      already locked on the token.
//   3. Current lock state is read via useTokenInfo (getToken), scoped to
//      'lock' as well as 'mint-settings'.
//   4. Already-locked flags render checked and disabled (cannot be
//      re-locked or unlocked); still-open flags are check-to-lock.
//   5. `hasAnyNewLock` / `allLocksSet` gate both the review-step
//      validation and the submit button, and the "everything already
//      locked" empty state renders when all seven are set.
//   6. Typed "LOCK" confirmation gate is reused unchanged (same
//      mechanism as the former coarse lock).
//   7. Reuses messaging.issueToken / issueTokenHw / buildActionPsbtRequest
//      (no new handler) through the shared HW / watcher / actionConfirm
//      signing path, same as every other TokenAdminForm mode.
//   8. ManageToken.jsx hides the Lock action only once ALL seven flags
//      are set (not the coarse four-flag `locked`), so it stays reachable
//      while any flag remains open.
//   9. All three shells' free Actions-menu entry describes the matrix
//      (no longer "Lock supply").

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'TokenAdminForm.jsx');
assert.ok(existsSync(formPath), 'TokenAdminForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

// --- 1. LOCK_FLAGS: all seven flags -------------------------------------

// PC-06 moved the table into shared/utils/issueAdvancedFields.js so the
// admin lock matrix and the create wizard's advanced lock panel drive
// the same seven flags and cannot drift.
const lockFlagsPath = join(core, 'src', 'shared', 'utils', 'issueAdvancedFields.js');
assert.ok(existsSync(lockFlagsPath), 'issueAdvancedFields.js exists');
const lockFlagsSrc = readFileSync(lockFlagsPath, 'utf8');
assert.ok(
    /import \{ LOCK_FLAGS \} from '\.\.\/utils\/issueAdvancedFields\.js'/.test(src),
    'TokenAdminForm imports the shared LOCK_FLAGS rather than redeclaring it',
);
assert.ok(
    !/const LOCK_FLAGS = \[/.test(src),
    'TokenAdminForm no longer carries its own copy of the table',
);
const lockFlagsBlock = lockFlagsSrc.match(/export const LOCK_FLAGS = \[[\s\S]*?\n\];/);
assert.ok(lockFlagsBlock, 'LOCK_FLAGS constant found');
const lockFlags = lockFlagsBlock[0];
const EXPECTED_FLAGS = [
    ['max_supply', 'LOCK_MAX_SUPPLY'],
    ['max_mint', 'LOCK_MAX_MINT'],
    ['mint', 'LOCK_MINT'],
    ['mint_supply', 'LOCK_MINT_SUPPLY'],
    ['description', 'LOCK_DESCRIPTION'],
    ['sleep', 'LOCK_SLEEP'],
    ['callback', 'LOCK_CALLBACK'],
];
for (const [key, field] of EXPECTED_FLAGS) {
    assert.ok(
        new RegExp(`key:\\s*'${key}'[\\s\\S]{0,40}field:\\s*'${field}'`).test(lockFlags),
        `LOCK_FLAGS entry for ${key} maps to ${field}`,
    );
    assert.ok(
        new RegExp(`key:\\s*'${key}'[\\s\\S]{0,200}hint:\\s*'[^']+'`).test(lockFlags),
        `LOCK_FLAGS entry for ${key} carries a permanence hint`,
    );
}
assert.equal(EXPECTED_FLAGS.length, 7, 'all seven protocol lock flags are covered');

// --- 2. composeAdminParams: only newly-checked flags, never a full vector --

const composerBlock = src.match(/function composeAdminParams\([\s\S]*?\n\}\n/);
assert.ok(composerBlock, 'composeAdminParams function found');
const lockComposerBlock = composerBlock[0].match(/mode === 'lock'[\s\S]*?\n\s*\}\n/);
assert.ok(lockComposerBlock, "composeAdminParams branches on mode === 'lock'");
const lockComposer = lockComposerBlock[0];
assert.ok(/VERSION:\s*'3',\s*TICK\s*\}/.test(lockComposer), 'lock composer sets ISSUE VERSION=3');
assert.ok(/form\.lockChecks\s*\|\|\s*\{\}/.test(lockComposer), 'lock composer reads form.lockChecks');
assert.ok(
    /for\s*\(const f of LOCK_FLAGS\)/.test(lockComposer) && /if\s*\(checks\[f\.key\]\)\s*p\[f\.field\]\s*=\s*'1'/.test(lockComposer),
    'lock composer sets one LOCK_* field per checked flag, driven by LOCK_FLAGS (not a hardcoded pair)',
);

// --- 3. Current lock state via useTokenInfo, scoped to lock + mint-settings

assert.ok(
    /useTokenInfo\(\s*\{[^}]*skip:\s*mode !== 'mint-settings' && mode !== 'lock'/s.test(src),
    "useTokenInfo call is scoped to 'mint-settings' and 'lock' modes",
);
assert.ok(/const tokenLocks = assetInfo\?\.locks \|\| \{\}/.test(src), 'reads the shared tokenLocks object off assetInfo.locks');

// --- 4. Already-locked disabling + check-to-lock ------------------------

assert.ok(/const hasAnyNewLock = LOCK_FLAGS\.some/.test(src), 'hasAnyNewLock derived from LOCK_FLAGS');
assert.ok(/const allLocksSet = LOCK_FLAGS\.every/.test(src), 'allLocksSet derived from LOCK_FLAGS');
assert.ok(/const isLocked = !!tokenLocks\[f\.key\]/.test(src), 'per-row isLocked reads the current on-chain flag');
assert.ok(
    /checked=\{isLocked \|\| !!lockChecks\[f\.key\]\}/.test(src),
    'checkbox is checked when already locked OR newly checked this session',
);
assert.ok(/disabled=\{isLocked\}/.test(src), 'checkbox is disabled once the flag is already locked (cannot re-lock or unlock)');

// --- 5. Gating: review validation + submit button + empty state --------

assert.ok(
    /mode === 'lock' && !hasAnyNewLock/.test(src),
    'handleReview rejects submitting the lock form with nothing newly checked',
);
assert.ok(
    /mode === 'lock' && \(allLocksSet \|\| !hasAnyNewLock\)/.test(src),
    'submit button disables when everything is already locked or nothing new is checked',
);
assert.ok(
    /allLocksSet \?[\s\S]{0,200}nothing left to lock/.test(src),
    'renders an all-locked empty state once every flag is set',
);

// --- 6. Typed LOCK confirmation reused unchanged ------------------------

assert.ok(/mode === 'lock' \? \(\s*<Input\s*\n\s*label="Type LOCK to confirm"/.test(src), 'reuses the typed "Type LOCK to confirm" gate');
assert.ok(/typedConfirmOk = typedConfirm\.trim\(\)\.toUpperCase\(\) === 'LOCK'/.test(src), 'typed confirm still checks for the literal word LOCK');
assert.ok(/\(mode === 'lock' && !typedConfirmOk\)/.test(src), 'submit stays disabled until the typed LOCK confirm matches');

// --- 7. Reuses the shared signing path (no new handler) -----------------

assert.ok(/messaging\.issueToken\s*\(/.test(src), 'TokenAdminForm reuses messaging.issueToken');
assert.ok(/messaging\.issueTokenHw\s*\(/.test(src), 'reuses the HW signing path (messaging.issueTokenHw)');
assert.ok(/buildActionPsbtRequest/.test(src), 'reuses the watcher-mode encode-only path');
assert.ok(
    /variant=\{isWatcherMode \? 'primary' : \(mode === 'lock' \? 'danger' : 'primary'\)\}/.test(src),
    'lock mode still signs with the danger button variant (non-watcher)',
);

// --- 8. ManageToken: hidden only once ALL seven flags are set -----------

const manageSrc = readFileSync(join(sharedRoutes, 'ManageToken.jsx'), 'utf8');
assert.ok(
    /const LOCK_FLAG_KEYS = \[[^\]]*'max_supply'[^\]]*'callback'[^\]]*\]/.test(manageSrc),
    'ManageToken.jsx mirrors the seven lock-flag keys',
);
assert.ok(/const allLocksSet = LOCK_FLAG_KEYS\.every/.test(manageSrc), 'ManageToken derives allLocksSet from every flag');
assert.ok(
    /id:\s*'lock'[\s\S]{0,80}onSelect:\s*\(allLocksSet \|\| blockIssuerActions\)\s*\?\s*undefined\s*:\s*onLock/.test(manageSrc),
    'ManageToken gates the Lock action on allLocksSet (not the coarse four-flag `locked`), same owner gate as before',
);

// --- 9. Actions-menu copy updated across all three shells ---------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        /id:\s*'lock',\s*\n\s*label:\s*'Lock',/.test(app),
        `${shell} App.jsx Actions-menu 'lock' entry label reflects the matrix (no longer "Lock supply")`,
    );
}

console.log(
    'OK: token lock-matrix form smoke (PC-02: ISSUE v3 granular lock matrix over all 7 flags; already-locked disabling + check-to-lock; typed LOCK confirm reused; messaging.issueToken/-Hw + watcher path reused; ManageToken all-locked gating; 3-shell Actions-menu copy)',
);
