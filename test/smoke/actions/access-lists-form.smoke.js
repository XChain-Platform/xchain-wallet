// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-04 (token allow/block lists, ISSUE v5): the access-lists
// mode in TokenAdminForm, the shared TYPE=2 address-list picker with
// member counts, the tokenInfo lists passthrough, and ManageToken + App
// wiring across all three shells.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- ISSUE v5 access-lists editor ----
const admin = read('packages', 'core', 'src', 'shared', 'routes', 'TokenAdminForm.jsx');
assert.match(admin, /'access-lists'/, 'access-lists mode present');
assert.match(admin, /VERSION: '5', TICK/, 'access-lists composes ISSUE v5');
assert.match(admin, /form\.allowListIdx && form\.allowListIdx !== form\.currentAllowList/,
    'ALLOW_LIST emitted only when changed (blank = leave-unchanged)');
assert.match(admin, /form\.blockListIdx && form\.blockListIdx !== form\.currentBlockList/,
    'BLOCK_LIST emitted only when changed');
assert.match(admin, /listsChanged/, 'submission gated on an actual change');
assert.match(admin, /A list can be replaced but not removed/,
    'honest no-null-clear copy present');
assert.match(admin, /<ListPickerScreen/, 'uses the shared list picker');
assert.match(admin, /filterType="2"/, 'picker restricted to TYPE=2 address lists');
assert.match(admin, /getListByActionIndex/, 'member counts read for current bindings');

// ---- Shared list picker ----
const picker = read('packages', 'core', 'src', 'shared', 'components', 'ListPickerScreen.jsx');
assert.match(picker, /getListsForSource/, 'picker fans out getListsForSource');
assert.match(picker, /String\(row\.type\) === String\(filterType\)/, 'filters by list type');
assert.match(picker, /member/, 'shows member counts');

// ---- tokenInfo ----
const info = read('packages', 'core', 'src', 'flows', 'tokenInfo.js');
assert.match(info, /allowList/, 'tokenInfo exposes allowList');
assert.match(info, /blockList/, 'tokenInfo exposes blockList');

// ---- ManageToken + shell wiring ----
const manage = read('packages', 'core', 'src', 'shared', 'routes', 'ManageToken.jsx');
assert.match(manage, /onAccessLists/, 'ManageToken offers Access lists');
assert.match(manage, /id: 'access-lists'/, 'access-lists menu entry present');

for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell);
    assert.ok(src.includes("unlockedView === 'access-lists'"), `${shell.join('/')} routes access-lists into TokenAdminForm`);
    assert.ok(src.includes("onAccessLists={() => openForm('access-lists')}"), `${shell.join('/')} wires onAccessLists`);
    assert.ok(/'access-lists'/.test(src), `${shell.join('/')} view union includes access-lists`);
}

console.log('access-lists-form smoke: all assertions passed');
