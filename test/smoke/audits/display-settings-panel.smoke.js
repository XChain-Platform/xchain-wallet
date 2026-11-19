// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §27.3 / §27.4 smoke: Settings, Appearance, Tokens (watched, pinned and
// hidden token lists), reshaped 2026-11-14.
//
// Asserts:
//   1. DisplaySection.jsx keeps the balance, row, filter and reset parts and
//      no longer holds the token lists or the in-page watch form.
//   2. TokenListsSection.jsx is the list page: Watched, Pinned and Hidden
//      tabs with no counts, token rows that open the token page, an Unhide
//      All button on Hidden, and a plus that opens Add Watched Token.
//   3. AddWatchedTokenSection.jsx searches every network and writes
//      watchedTokens through useSettings.update.
//   4. TokenDetail.jsx carries Stop watching, Pin and Hide actions.
//   5. Settings.jsx mounts the pages as row and child pages.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core', 'src');
const read = (...parts) => {
    const path = join(core, ...parts);
    assert.ok(existsSync(path), `${parts.join('/')} exists`);
    return readFileSync(path, 'utf8');
};

// --- 1. DisplaySection ------------------------------------------------

const displaySrc = read('shared', 'components', 'settings', 'DisplaySection.jsx');
assert.ok(/export function DisplaySection\(/.test(displaySrc), 'DisplaySection is a named export');
assert.ok(/import \{ useSettings \} from '\.\.\/\.\.\/hooks\/useSettings\.js'/.test(displaySrc),
    'DisplaySection reads + writes via the shared useSettings hook');
assert.ok(!/addWatchedToken|watchedTokens: \[\.\.\.watched/.test(displaySrc),
    'the old in-page add form is gone from DisplaySection');
assert.ok(!/movePin|writePinned/.test(displaySrc), 'the token lists moved out of DisplaySection');

// --- 2. TokenListsSection ---------------------------------------------

const listsSrc = read('shared', 'components', 'settings', 'TokenListsSection.jsx');
assert.ok(/export function TokenListsSection\(/.test(listsSrc), 'TokenListsSection is a named export');
assert.ok(/const TABS = \['watched', 'pinned', 'hidden'\]/.test(listsSrc), 'three tabs in order');
assert.ok(!/\{lists\[id\]\.length\}|length: /.test(listsSrc), 'tabs carry no counts');
assert.ok(/onOpenToken\(\{ chainId: info\.chainId/.test(listsSrc), 'a row opens the token page');
assert.ok(/update\(\{ hiddenTokens: \[\] \}\)/.test(listsSrc), 'Unhide All writes the empty hidden list');
assert.ok(/onOpenPage\(ADD_WATCHED_TOKEN_PAGE_ID\)/.test(listsSrc), 'the plus opens Add Watched Token');

// --- 3. AddWatchedTokenSection ----------------------------------------

const addSrc = read('shared', 'components', 'settings', 'AddWatchedTokenSection.jsx');
assert.ok(/messaging\.searchTokens\(\{ chainId: chain\.id/.test(addSrc), 'searches each network');
assert.ok(/watchedTokens: \[\.\.\.watched, key\]/.test(addSrc), 'watching appends to watchedTokens');

// --- 4. TokenDetail actions -------------------------------------------

const detailSrc = read('shared', 'routes', 'TokenDetail.jsx');
for (const id of ["'stop-watching'", "'pin'", "'hide'"]) {
    assert.ok(detailSrc.includes(`id: ${id}`), `TokenDetail has the ${id} action`);
}

// --- 5. Settings.jsx --------------------------------------------------

const settingsSrc = read('shared', 'routes', 'Settings.jsx');
assert.ok(/id: 'display',[\s\S]{0,600}?Component: DisplaySection/.test(settingsSrc),
    'Settings.jsx registers a display section bound to DisplaySection');
assert.ok(/id: 'display-tokens',[\s\S]{0,300}?Component: TokenListsSection/.test(settingsSrc),
    'the Tokens row opens TokenListsSection');
assert.ok(/id: ADD_WATCHED_TOKEN_PAGE_ID/.test(settingsSrc), 'Add Watched Token is a registered Settings page');
assert.ok(/summary: displaySummary\(settings\)/.test(settingsSrc), 'display section renders the displaySummary');
// The smoke loader reads source with English copy in place of t() keys.
assert.ok(/'No customization'/.test(settingsSrc), 'displaySummary reports "No customization" when nothing is changed');

console.log(
    'OK: display-settings-panel smoke (Tokens page: Watched, Pinned and Hidden tabs without counts, rows open the token page, Unhide All, plus opens Add Watched Token; token page Actions edit the lists)',
);
