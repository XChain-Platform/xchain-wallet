// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-11: AirdropForm's three source modes (paste / existing /
// holders), layered on top of the pre-existing §40.9 two-tx flow that
// test/smoke/actions/airdrop-form.smoke.js already pins.
//
// Asserts:
//   1. A source-mode <Select> with exactly the three documented values,
//      defaulting to 'paste' (unchanged pre-PC-11 behavior).
//   2. 'existing' mode reuses the PC-10 listsForSource + listByActionIndex
//      messaging wiring already shipped for My Lists, via a local
//      ExistingListPickerScreen, and skips LIST creation (no new-list
//      params ever get built for that mode).
//   3. 'holders' mode reuses ListCreateForm's TYPE=1 tick-parsing shape
//      (memberTicks/invalidTicks) and feeds AMOUNT-per-holder ticks into
//      the same LIST+AIRDROP two-transaction path 'paste' uses.
//   4. Holder-snapshot honesty: a "not final" / "preview" volatility
//      callout naming the AIRDROP-execution binding time is present, and
//      there is no min-balance threshold field anywhere (AIRDROP.md
//      defines none).
//   5. PendingAirdrop schema's listType round-trips so a resumed
//      'holders'-mode airdrop can be told apart from a resumed 'paste'
//      one without re-parsing anything.
//   6. The watcher-mode block stays unconditional (pre-PC-11 invariant):
//      still gates on `isWatcherMode` alone, still never calls
//      buildActionPsbtRequest.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemas } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const formPath = join(wsRoot, 'packages/core/src/shared/routes/AirdropForm.jsx');
assert.ok(existsSync(formPath), 'AirdropForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

// --- 1. Source-mode selector -------------------------------------------

assert.match(src, /const \[sourceMode, setSourceMode\] = useState\(/, 'AirdropForm tracks sourceMode state');
assert.match(src, /\('paste'\)/, "sourceMode defaults to 'paste'");
for (const opt of ['paste', 'existing', 'holders']) {
    assert.match(src, new RegExp(`<option value="${opt}">`), `Select offers the ${opt} option`);
}
assert.match(src, /label="Airdrop to"/, 'source-mode Select is labeled "Airdrop to"');

// --- 2. 'existing' mode: reuses PC-10 list plumbing, no LIST leg -------

assert.match(src, /messaging\.getListsForSource\(/, "'existing' picker calls messaging.getListsForSource");
assert.match(src, /messaging\.getListByActionIndex\(/, "'existing' mode fetches list detail via messaging.getListByActionIndex");
assert.match(src, /function ExistingListPickerScreen\(/, 'ExistingListPickerScreen sub-component declared');
assert.match(src, /<ExistingListPickerScreen/, 'ExistingListPickerScreen mounted from AirdropForm');
assert.match(
    src,
    /if \(sourceMode === 'existing'\) \{[\s\S]*?if \(!listActionIndex\) \{/,
    "compose submit requires a chosen list before proceeding in 'existing' mode",
);
// 'existing' mode must never route through a fresh createList / createListHw
// call using its own picked index as the trigger. Instead, it airdrops
// straight to the ACTION_INDEX the picker returned, skipping LIST authoring.
assert.match(
    src,
    /setListActionIndex\(String\(row\.action_index\)\)/,
    "picking a list sets listActionIndex directly (no LIST broadcast in between)",
);

// --- 3. 'holders' mode: TYPE=1 tick parsing reused from ListCreateForm -

assert.match(src, /const memberTicks = useMemo\(/, "'holders' mode parses memberTicks");
assert.match(src, /const invalidTicks = useMemo\(/, "'holders' mode validates invalidTicks");
assert.match(
    src,
    /const listItems = sourceMode === 'holders' \? memberTicks : recipients\.valid;/,
    "listItems switches between memberTicks (holders) and recipients.valid (paste)",
);
assert.match(
    src,
    /const listType = sourceMode === 'holders' \? '1' : '2';/,
    "listType switches TYPE between '1' (holders) and '2' (paste)",
);
assert.match(src, /recipients: listItems,/, 'createPendingAirdrop persists whichever ITEM array built the LIST');
assert.match(src, /\blistType,/, 'createPendingAirdrop call sites forward listType');

// --- 4. Holder-snapshot honesty + no min-balance field -----------------

assert.match(src, /current, not final/i, 'review stage labels the holder count as current, not final');
assert.match(src, /only (?:fixed|locked in) when the AIRDROP transaction executes/, 'binding time is stated explicitly');
assert.match(src, /preview, not a (?:guarantee|promise)/i, 'holder count is explicitly framed as a preview, not a promise');
assert.doesNotMatch(src, /MIN_BALANCE/i, 'no min-balance threshold param (AIRDROP.md defines none)');
assert.doesNotMatch(src, /minimum balance/i, 'no min-balance threshold copy anywhere in the form');

const airdropDocPath = join(wsRoot, '..', 'xchain-documentation/protocol/actions/AIRDROP.md');
if (existsSync(airdropDocPath)) {
    const doc = readFileSync(airdropDocPath, 'utf8');
    assert.doesNotMatch(doc, /MIN_BALANCE/i, 'AIRDROP.md protocol doc confirms no MIN_BALANCE param exists');
}

// --- 5. PendingAirdrop schema listType round-trip ----------------------

{
    const rec = schemas.createPendingAirdrop({
        walletId: 'w1',
        chainId: 'bitcoin-mainnet',
        fromAddress: 'bc1qa',
        token: 'MYTOKEN',
        amountPer: '10',
        recipients: ['XCP', 'PEPECASH'],
        listTxid: 'abcdef',
        listType: '1',
    });
    assert.equal(rec.listType, '1', "createPendingAirdrop honors listType: '1'");
    assert.equal(schemas.validatePendingAirdrop(rec).ok, true, 'a listType=1 record still validates');

    const legacy = schemas.createPendingAirdrop({
        walletId: 'w1',
        chainId: 'bitcoin-mainnet',
        fromAddress: 'bc1qa',
        token: 'MYTOKEN',
        amountPer: '10',
        recipients: ['bc1q1'],
        listTxid: 'abcdef',
    });
    assert.equal(legacy.listType, '2', 'omitting listType defaults to "2" (paste-mode address list)');
}

// --- 6. Watcher-mode block stays unconditional (pre-PC-11 invariant) --

assert.match(src, /if \(isWatcherMode\) \{[\s\S]+?Not available in watcher mode/,
    'watcher-mode block still fires unconditionally, before any stage-based return');
assert.doesNotMatch(src, /messaging\.buildActionPsbtRequest\(/,
    'AirdropForm still intentionally never routes through buildActionPsbtRequest, for any source mode');

console.log(
    'OK: airdrop source-modes smoke (PC-11: paste/existing/holders Select + '
    + "'existing' reuses PC-10 listsForSource/listByActionIndex without a LIST leg + "
    + "'holders' reuses ListCreateForm's TYPE=1 tick parsing + holder-snapshot "
    + 'honesty copy (current-not-final + binding time + no min-balance field) + '
    + 'pendingAirdrop listType round-trip + watcher-mode block unchanged)',
);
