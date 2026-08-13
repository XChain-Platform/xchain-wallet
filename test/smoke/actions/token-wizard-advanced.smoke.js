// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-06: ISSUE create-time completeness. The Token Creation Wizard's
// Custom template gains an advanced disclosure carrying the ISSUE v0
// fields that previously needed three separate post-create admin edits
// (PC-02 lock matrix, PC-03 callback trio, PC-04 access lists), so a
// fair-mint token is fully configured in one transaction.
//
// Asserts:
//   1. The advanced fields live in one pure, testable module and the
//      seven-flag lock table is shared with the admin matrix.
//   2. The wizard imports that module plus the SAME list picker the
//      admin access-lists mode uses (create and edit bind identically).
//   3. Only the Custom composer folds the advanced fields in; the five
//      opinionated templates are untouched.
//   4. Submit pre-flights the advanced fields BEFORE composing, scoped
//      to Custom, and re-opens the panel on a rejection.
//   5. The panel renders all three groups, driven by LOCK_FLAGS rather
//      than a hardcoded subset.
//   6. The `lockOnCreate` shortcut and the matrix do not offer two
//      controls for the same wire field.
//   7. The two create-time rails have live inputs: the chain tip (for
//      the callback future-block check the indexer skips on a create)
//      and the callback token's divisibility.
//   8. The panel is Custom-only and collapsed by default.
//   9. composeIssueParams stays file-local (the original wizard smoke's
//      invariant survives this change).
//  10. The CSS module ships the new class names.

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
const adminPath = join(sharedRoutes, 'TokenAdminForm.jsx');
const cssPath = join(sharedRoutes, 'TokenWizard.module.css');

assert.ok(existsSync(fieldsPath), 'issueAdvancedFields.js exists');
assert.ok(existsSync(wizardPath), 'TokenWizard.jsx exists');

const fields = readFileSync(fieldsPath, 'utf8');
const src = readFileSync(wizardPath, 'utf8');
const admin = readFileSync(adminPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

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

// --- 2. Wizard wiring ---------------------------------------------------

assert.ok(
    /import \{[\s\S]*?LOCK_FLAGS[\s\S]*?applyAdvancedIssueFields[\s\S]*?validateAdvancedIssueFields[\s\S]*?advancedIssueWarnings[\s\S]*?\} from '\.\.\/utils\/issueAdvancedFields\.js'/.test(src),
    'wizard imports the advanced-field helpers',
);
assert.ok(
    /import \{ ListPickerScreen \} from '\.\.\/components\/ListPickerScreen\.jsx'/.test(src),
    'wizard reuses the shared ListPickerScreen (same picker as the admin access-lists mode)',
);
assert.ok(
    /filterType="2"/.test(src),
    'the picker is restricted to TYPE=2 address lists, as ALLOW_LIST/BLOCK_LIST require',
);
assert.ok(
    /import \{ blockDateEstimateText \} from '\.\.\/utils\/blockDateEstimate\.js'/.test(src),
    'callback block height carries a date estimate',
);

// --- 3. Custom-only composition ----------------------------------------

const composersBlock = src.match(/const TEMPLATE_COMPOSERS = \{[\s\S]*?\n\};/);
assert.ok(composersBlock, 'TEMPLATE_COMPOSERS found');
const composers = composersBlock[0];
const applyCount = (composers.match(/applyAdvancedIssueFields\(/g) || []).length;
assert.equal(
    applyCount, 1,
    'exactly one composer folds the advanced fields in (Custom); the five presets are untouched',
);
const customComposer = composers.match(/custom\(form\) \{[\s\S]*?\n    \},/);
assert.ok(customComposer, 'custom composer found');
assert.ok(
    /applyAdvancedIssueFields\(p, form\.advanced\)/.test(customComposer[0]),
    'the Custom composer is the one that applies them',
);

// --- 4. Pre-flight before compose --------------------------------------

const submitBlock = src.match(/function handleDetailsSubmit\([\s\S]*?\n    \}\n/);
assert.ok(submitBlock, 'handleDetailsSubmit found');
const submit = submitBlock[0];
assert.ok(
    /if \(template === 'custom'\) \{[\s\S]*?validateAdvancedIssueFields\(advanced, \{/.test(submit),
    'advanced pre-flight is scoped to the Custom template',
);
assert.ok(
    /setShowAdvanced\(true\);\s*\n\s*setFormError\(advancedError\)/.test(submit),
    'a rejected advanced field re-opens the panel so the user can see the field',
);
assert.ok(
    submit.indexOf('validateAdvancedIssueFields') < submit.indexOf('openConfirmScreen()'),
    'validation runs BEFORE the confirm screen composes the transaction',
);
for (const key of ['supply', 'currentHeight', 'callbackTickDecimals']) {
    assert.ok(
        new RegExp(`${key},`).test(submit),
        `pre-flight passes ${key} into the validator`,
    );
}

// --- 5. All three groups, LOCK_FLAGS-driven ----------------------------

const panelBlock = src.match(/function AdvancedIssuePanel\(\{[\s\S]*?\n\}\n/);
assert.ok(panelBlock, 'AdvancedIssuePanel found');
const panel = panelBlock[0];
assert.ok(
    /LOCK_FLAGS\.map\(\(f\) => \{/.test(panel),
    'the lock matrix is rendered from LOCK_FLAGS, not a hardcoded subset',
);
for (const [label, needle] of [
    ['callback token', /label="Callback token \(optional\)"/],
    ['callback payout', /label="Payout per unit"/],
    ['callback block', /label="Callback allowed from block"/],
    ['allow-list', /Choose allow-list/],
    ['block-list', /Choose block-list/],
]) {
    assert.ok(needle.test(panel), `advanced panel renders the ${label} control`);
}
assert.ok(
    /advancedIssueWarnings\(advanced\)/.test(src) && /warnings\.map\(\(w\) =>/.test(panel),
    'permanent-choice warnings are surfaced next to the fields',
);

// --- 6. No two controls for one wire field -----------------------------

assert.ok(
    /const forcedByShortcut = \{ max_supply: !!lockOnCreate, mint: !!lockOnCreate \}/.test(panel),
    'the lockOnCreate shortcut claims exactly the two flags it sets',
);
assert.ok(
    /checked=\{forced \|\| !!lockChecks\[f\.key\]\}/.test(panel)
        && /disabled=\{forced\}/.test(panel),
    'flags already committed by the shortcut render checked and disabled',
);

// --- 7. Live inputs for the two create-time rails -----------------------

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

// --- 8. Custom-only, collapsed by default ------------------------------

assert.ok(
    /const \[showAdvanced, setShowAdvanced\] = useState\(false\)/.test(src),
    'the panel is collapsed by default',
);
// `resolved` is `template` after TEMPLATE_ALIASES maps retired ids onto
// the template that absorbed them ( merged Community into
// Utility); either name reads the same gate.
assert.ok(
    /\{(?:template|resolved) === 'custom' && advancedPanel \?/.test(src),
    'the panel only mounts for the Custom template',
);
assert.ok(
    !/advanced/.test(JSON.stringify(src.match(/const TEMPLATE_FIELDS = \{[\s\S]*?\n\};/)?.[0] || '')),
    'TEMPLATE_FIELDS is untouched by the advanced panel (it gates the flat fields only)',
);

// --- 9. Original wizard invariant survives ------------------------------

assert.ok(
    !/export function composeIssueParams/.test(src),
    'composeIssueParams stays file-local',
);

// --- 10. CSS ------------------------------------------------------------

for (const cls of [
    'advanced', 'advancedBody', 'advancedHeading',
    'lockFlagRow', 'lockFlagHint', 'listRow',
]) {
    assert.ok(
        new RegExp(`\\.${cls}[\\s,{:]`).test(css),
        `TokenWizard.module.css ships .${cls}`,
    );
}

console.log('OK: token wizard advanced smoke (PC-06: create-time lock matrix + callback trio + access lists folded into the Custom template; shared LOCK_FLAGS + ListPickerScreen; create-only future-block and divisibility rails)');
