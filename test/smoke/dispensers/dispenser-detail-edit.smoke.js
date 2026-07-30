// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-19 (dispenser edit leg): DispenserDetail exposes a
// DISPENSER v2 Edit action (EXPIRATION / ALLOW_LIST / BLOCK_LIST) with the
// 1-hour list-edit delay note, plus the refill-cap honesty copy and the
// close-window / expiration / list state display. Refill (also DISPENSER
// v2) already shipped in bb89c6c; this asserts the remaining legs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const src = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'DispenserDetail.jsx'),
    'utf8',
);

// Edit stage machine + handler.
assert.match(src, /const \[editStage, setEditStage\] = useState\(/, 'editStage state exists');
assert.match(src, /async function handleEdit\(event\) \{/, 'handleEdit handler exists');

// Edit composes DISPENSER v2 with the edit fields (never GIVE_ESCROW: that
// is the separate refill flow), and only the fields the owner filled in.
assert.match(src, /const params = \{ VERSION: '2', DISPENSER_ACTION_INDEX: String\(actionIndex\) \};/,
    'edit builds a v2 edit keyed on DISPENSER_ACTION_INDEX');
assert.doesNotMatch(src, /handleEdit[\s\S]*?params\.GIVE_ESCROW/,
    'edit flow never sets GIVE_ESCROW (refill is a separate flow)');
assert.match(src, /params\.EXPIRATION = String\(unix\);/, 'edit can set EXPIRATION');
assert.match(src, /params\.ALLOW_LIST = alTrim;/, 'edit can set ALLOW_LIST');
assert.match(src, /params\.BLOCK_LIST = blTrim;/, 'edit can set BLOCK_LIST');

// Future-expiration guard + numeric LIST index validation.
assert.match(src, /Expiration must be a future date and time\./, 'rejects a past expiration');
assert.match(src, /LIST action index \(digits only\)/, 'validates list index is numeric');

// Edit requires at least one changed field (no empty no-op edits).
assert.match(src, /Change at least one field to submit an edit\./, 'blocks a no-op edit');

// 1-hour list-edit delay surfaced in both the confirm form and done screen.
assert.match(src, /take effect about 1 hour after this[\s\S]*?transaction\s+confirms/,
    'confirm form states the 1-hour list-edit delay');

// Signs through the shared dispenserAction / dispenserActionHw path (HW-safe).
assert.match(src, /handleEdit[\s\S]*?messaging\.dispenserActionHw\(/, 'edit supports HW signing');
assert.match(src, /handleEdit[\s\S]*?messaging\.dispenserAction\(/, 'edit supports software signing');

// Edit quick-action, owner + open gated.
assert.match(src, /onClick=\{\(\) => setEditStage\('confirm'\)\}/, 'Edit quick-action wired');
assert.match(src, /Icon\.PencilIcon/, 'Edit uses the pencil icon');

// State display: refill-cap honesty, close-window banner, expiration + lists.
// D-147: this used to pin the POLICY sentence ("up to 5 refills (6,000 lifetime
// dispenses)"), which is true of every dispenser and says nothing about the one
// on screen. The refill lane has no confirm screen and owes no protocol fee, so
// nothing dry-runs it, and an owner on their sixth was shown that sentence, then
// a "Refill submitted" screen for a transaction the chain always rejects. What
// is pinned now is the live count and the block it drives.
assert.match(src, /refillCeilingMessage\(refillCount\)/, 'refill form states THIS dispenser\'s refill count');
assert.match(src, /refillsUsed\(lifecycle\)/, 'the count is derived from the lifecycle events already loaded');
assert.match(
    src,
    /disabled=\{\(refillCount\.remaining <= 0 && refillCount\.exact\)/,
    'a spent refill ceiling disables Sign refill',
);
assert.ok(
    !/up to 5 refills \(6,000 lifetime dispenses\)/.test(src),
    'the refill form no longer quotes the cap as policy with no count beside it (D-147)',
);
assert.match(src, /const isClosing = liveStatus === 'cancelling';/, 'derives the cancelling close-window state');
assert.match(src, /closeWindowNote/, 'renders the close-window banner');
assert.match(src, /of 1,000 this fill/, 'labels dispenses as per-fill against the 1000 cap');
assert.match(src, /formatUnixDate\(currentExpiration\)/, 'shows the expiration date');
assert.match(src, /Allow list<\/dt>/, 'shows the current allow list');
assert.match(src, /Block list<\/dt>/, 'shows the current block list');

console.log('dispenser-detail-edit smoke OK');
