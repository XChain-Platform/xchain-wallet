// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 2: AddressText checksum highlighting.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const cmp = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'AddressText.jsx'),
    'utf8',
);
const css = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'ui', 'AddressText.module.css'),
    'utf8',
);

// --- API ----------------------------------------------------------------

assert.match(cmp, /export function AddressText\(/, 'named export preserved');
assert.match(
    cmp,
    /highlight\s*=\s*false/,
    'highlight prop default off (additive change)',
);

// --- highlight render path ----------------------------------------------

assert.match(cmp, /styles\.head/, 'head span class');
assert.match(cmp, /styles\.middle/, 'middle span class');
assert.match(cmp, /styles\.tail/, 'tail span class');

// Truncated mode under highlight uses a literal '…'
const idxHighlight = cmp.indexOf('truncate ? ');
assert.notEqual(idxHighlight, -1, 'truncate branch present in highlight path');

// Untruncated highlighted mode shows the actual middle
assert.match(cmp, /address\.slice\(6, -6\)/, 'middle slice extracted');

// --- non-highlight path preserved --------------------------------------

assert.match(cmp, /first6…last6/i, 'docstring still describes default truncation');
assert.match(cmp, /title=\{address\}/, 'title still carries full address');
assert.match(cmp, /aria-label=\{address\}/, 'aria-label still carries full address');

// --- empty / short addresses --------------------------------------------

assert.match(cmp, /address\.length === 0/, 'empty branch');
assert.match(cmp, /address\.length <= 14/, 'short-address branch');

// --- CSS hooks ----------------------------------------------------------

for (const cls of ['addr', 'sm', 'md', 'head', 'middle', 'tail']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `CSS hook .${cls}`);
}
assert.match(css, /color: var\(--xc-text-muted/, 'middle uses muted token');

console.log('address-text-highlight smoke OK');
