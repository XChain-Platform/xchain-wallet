// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ISSUE create-time completeness. The one Issue form carries the ISSUE v0
// fields that otherwise need separate post-create admin edits (the lock
// switches, the callback trio, the access lists), so a fair-mint token is
// fully configured in one transaction.
//
// Asserts:
//   1. The advanced fields live in one pure, testable module and the
//      seven-flag lock table is shared with the admin matrix.
//   2. The Issue a Token route renders IssueTokenForm, which imports that
//      module plus the SAME list picker the admin access-lists mode uses
//      (create and edit bind identically).
//   3. The callback trio, the lock switches and the lists each write their
//      own ISSUE fields during composition.
//   4. The input check pre-flights the callback BEFORE the review step.
//   5. The form renders all three groups, driven by the shared lock table
//      rather than a hardcoded subset.
//   6. The two create-time rails have live inputs: the chain tip (for
//      the callback future-block check the indexer skips on a create)
//      and the callback token's divisibility.
//   7. The three groups start collapsed.
//   8. The route holds no composer of its own and the old stylesheet is gone.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const fieldsPath = join(core, 'src', 'shared', 'utils', 'issueAdvancedFields.js');
const wizardPath = join(sharedRoutes, 'TokenWizard.jsx');
const formPath = join(sharedRoutes, 'IssueTokenForm.jsx');
const locksPath = join(sharedRoutes, 'issueLocks.js');
const adminPath = join(sharedRoutes, 'TokenAdminForm.jsx');

assert.ok(existsSync(fieldsPath), 'issueAdvancedFields.js exists');
assert.ok(existsSync(wizardPath), 'TokenWizard.jsx exists');
assert.ok(existsSync(formPath), 'IssueTokenForm.jsx exists');

const fields = readFileSync(fieldsPath, 'utf8');
const src = readFileSync(formPath, 'utf8');
const locks = readFileSync(locksPath, 'utf8');
const admin = readFileSync(adminPath, 'utf8');

// --- 1. One pure module, one lock table --------------------------------

for (const name of [
    'LOCK_FLAGS',
    'applyAdvancedIssueFields',
    'validateAdvancedIssueFields',
    'advancedIssueWarnings',
    'fractionalDigits',
]) {
    assert.ok(
        new RegExp(`export (const|function) ${name}\\b`).test(fields),
        `issueAdvancedFields exports ${name}`,
    );
}
assert.ok(
    /import \{ LOCK_FLAGS \} from '\.\.\/utils\/issueAdvancedFields\.js'/.test(admin),
    'the admin lock matrix consumes the shared LOCK_FLAGS',
);

// --- 2. Issue form wiring -----------------------------------------------

assert.ok(
    /return <IssueTokenForm\b/.test(readFileSync(wizardPath, 'utf8')),
    'the Issue a Token route renders IssueTokenForm',
);
assert.ok(
    /import \{[\s\S]*?applyAdvancedIssueFields[\s\S]*?validateAdvancedIssueFields[\s\S]*?\} from '\.\.\/utils\/issueAdvancedFields\.js'/.test(src),
    'the form imports the advanced-field helpers',
);
assert.ok(
    /import \{ ISSUE_LOCKS \} from '\.\/issueLocks\.js'/.test(src),
    'the form draws its lock switches from the shared lock table',
);
assert.ok(
    /import \{ ListPickerScreen \} from '\.\.\/components\/ListPickerScreen\.jsx'/.test(src),
    'the form reuses the shared ListPickerScreen (same picker as the admin access-lists mode)',
);
assert.ok(
    /filterType="2"/.test(src),
    'the picker is restricted to TYPE=2 address lists, as ALLOW_LIST/BLOCK_LIST require',
);
assert.ok(
    /import \{ blockDateEstimateText \} from '\.\.\/utils\/blockDateEstimate\.js'/.test(src),
    'callback block height carries a date estimate',
);
assert.ok(
    /LOCK_FLAGS/.test(locks) && /LOCK_COPY_BY_FIELD\.get\(field\)\.label/.test(locks),
    'issueLocks.js builds ISSUE_LOCKS from the shared LOCK_FLAGS copy',
);

// --- 3. The callback rides the ISSUE; locks and lists have their own fields

const composeBlock = src.match(/p\.DECIMALS = divisible[\s\S]*?return p;/);
assert.ok(composeBlock, 'ISSUE composition found');
const compose = composeBlock[0];
assert.equal(
    (compose.match(/applyAdvancedIssueFields\(/g) || []).length, 1,
    'the callback trio is folded in by exactly one call',
);
assert.ok(
    /applyAdvancedIssueFields\(p, callbackFields\)/.test(compose),
    'the callback fields are the only ones handed to the advanced-field helper',
);
assert.ok(
    /for \(const lock of ISSUE_LOCKS\) \{\s*\n\s*if \(locks\[lock\.key\]\) p\[lock\.field\] = '1';/.test(compose),
    'every checked lock switch writes its own LOCK_* field',
);
assert.ok(
    /if \(allowList\.trim\(\)\) p\.ALLOW_LIST = allowList\.trim\(\);/.test(compose)
        && /if \(blockList\.trim\(\)\) p\.BLOCK_LIST = blockList\.trim\(\);/.test(compose),
    'a chosen allow-list and block-list write ALLOW_LIST and BLOCK_LIST',
);

// --- 4. Pre-flight before compose --------------------------------------

const checkBlock = src.match(/function issueInputsCheck\(\) \{[\s\S]*?\n    \}\n/);
assert.ok(checkBlock, 'issueInputsCheck found');
const check = checkBlock[0];
assert.ok(
    /validateAdvancedIssueFields\(callbackFields, \{/.test(check),
    'the callback is pre-flighted with the shared validator',
);
for (const key of ['supply', 'currentHeight', 'callbackTickDecimals']) {
    assert.ok(
        new RegExp(`${key},`).test(check),
        `pre-flight passes ${key} into the validator`,
    );
}
const reviewBlock = src.match(/const inputsCheck = issueInputsCheck\(\);[\s\S]{0,1200}?setStage\('review'\)/);
assert.ok(reviewBlock, 'review step is gated by the input check');
assert.ok(
    /setStage\('review'\)/.test(reviewBlock[0]),
    'validation runs before the form opens its review step',
);

// --- 5. All three groups, shared-lock driven ----------------------------

assert.ok(
    /\{ISSUE_LOCKS\.map\(\(lock\) => \{/.test(src),
    'the lock switches are rendered from ISSUE_LOCKS, not a hardcoded subset',
);
for (const [label, needle] of [
    ['callback token', /id="issue-callback-tick"/],
    ['callback payout', /id="issue-callback-amount"/],
    ['callback block', /id="issue-callback-block"/],
    ['allow-list', /id="issue-allow-list"/],
    ['block-list', /id="issue-block-list"/],
]) {
    assert.ok(needle.test(src), `the form renders the ${label} control`);
}
for (const id of ['locks', 'lists', 'callback']) {
    assert.ok(
        new RegExp(`<FormSection\\s+id="${id}"`).test(src),
        `the ${id} group is its own FormSection`,
    );
}
assert.ok(
    /ISSUE_LOCKS[\s\S]{0,200}key: 'mintSupply'|\['mintSupply', 'LOCK_MINT_SUPPLY'\]/.test(src + locks),
    'the mint-supply lock is one of the lock switches',
);

// --- 6. Live inputs for the two create-time rails -----------------------

assert.ok(
    /messaging\.getIndexerWatermark\(\{ chainId \}\)[\s\S]{0,200}r\.watermark/.test(src),
    'chain tip is read from the indexer watermark (r.watermark), for the future-block rail',
);
assert.ok(
    /setCallbackTickDecimals\(Number\.isInteger\(d\) \? d : null\)/.test(src),
    'callback divisibility is only accepted when it is an actual integer',
);
assert.ok(
    /\.catch\(\(\) => \{ if \(!cancelled\) setCallbackTickDecimals\(null\); \}\)/.test(src),
    'an unreachable explorer leaves divisibility unproven (whole numbers only), never assumed divisible',
);

// --- 7. Collapsed by default -------------------------------------------

const openBlock = src.match(/const INITIAL_OPEN_SECTIONS = \{[\s\S]*?\n\};/);
assert.ok(openBlock, 'INITIAL_OPEN_SECTIONS found');
for (const id of ['locks', 'lists', 'callback']) {
    assert.ok(
        new RegExp(`\\b${id}: false`).test(openBlock[0]),
        `the ${id} group starts collapsed`,
    );
}

// --- 8. The route keeps no compose logic of its own ---------------------

assert.ok(
    !/composeIssueParams|TEMPLATE_COMPOSERS/.test(readFileSync(wizardPath, 'utf8')),
    'the Issue a Token route holds no template composer',
);
assert.ok(
    !existsSync(join(sharedRoutes, 'TokenWizard.module.css')),
    'the retired wizard stylesheet is gone',
);

console.log('OK: issue form advanced smoke (create-time lock switches + callback trio + access lists on the one Issue form; shared lock table + ListPickerScreen; create-only future-block and divisibility rails)');
