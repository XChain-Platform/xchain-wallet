// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster P FOLLOWUP 5: form-draft persistence sweep. v0.212.0 wired
// the hook into Send + SignMessageForm; this sweep extends it to
// IssueTokenForm + DispenserForm. Both new adopters honor the
// privacy.formDraftTtlMs setting, persist the user-visible composition
// fields, exclude password, clear the draft on success, and surface a
// Restore / Discard banner above the form stage.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const issueSrc = read('packages/core/src/shared/routes/IssueTokenForm.jsx');
const dispSrc = read('packages/core/src/shared/routes/DispenserForm.jsx');

for (const [label, src, viewName, restoreFields] of [
    [
        'IssueTokenForm', issueSrc, 'issue-token',
        ['chainId', 'fromAddressId', 'ticker', 'supply', 'divisible',
         'description', 'lockSupply', 'transferTo'],
    ],
    [
        'DispenserForm', dispSrc, 'dispenser',
        ['chainId', 'fromAddressId', 'ticker', 'giveAmount', 'escrow',
         'triggerPrice', 'oracleAddress', 'fiatCode', 'fiatAmount',
         'showAdvanced'],
    ],
]) {
    // 1. The hook + settings provider are imported.
    assert.ok(/from '\.\.\/hooks\/useFormDraft\.js'/.test(src),
        `${label} imports useFormDraft`);
    assert.ok(/from '\.\.\/hooks\/useSettings\.js'/.test(src),
        `${label} imports useSettings`);
    assert.ok(/StatusMessage/.test(src),
        `${label} imports StatusMessage from core/ui`);

    // 2. The TTL is read from settings.privacy.formDraftTtlMs.
    assert.ok(/settings\?\.privacy\?\.formDraftTtlMs/.test(src),
        `${label} reads settings.privacy.formDraftTtlMs`);

    // 3. The hook is mounted with the documented view name.
    assert.ok(new RegExp(`useFormDraft\\(\\{ view: '${viewName}', walletId, ttlMs: formDraftTtlMs \\}\\)`).test(src),
        `${label} mounts useFormDraft with view='${viewName}'`);

    // 4. The save effect persists every documented field but NEVER the
    //    password.
    for (const field of restoreFields) {
        assert.ok(new RegExp(`\\b${field}\\b`).test(src),
            `${label} draft.save() includes "${field}"`);
    }
    // The save call must NOT mention password.
    const saveCallMatch = src.match(/draft\.save\(\{[\s\S]*?\}\);/);
    assert.ok(saveCallMatch, `${label} contains a draft.save({...}) call`);
    assert.ok(!/\bpassword\b/.test(saveCallMatch[0]),
        `${label} draft.save() must NOT include password`);

    // 5. Restore handler covers every persisted field.
    for (const field of restoreFields) {
        assert.ok(new RegExp(`v\\.${field}`).test(src),
            `${label} restoreDraft reads v.${field}`);
    }

    // 6. Banner copy + Restore / Discard wiring.
    assert.ok(/recovery=\{\{ label: 'Restore', onAction: restoreDraft \}\}/.test(src),
        `${label} banner exposes a Restore action`);
    assert.ok(/aria-label="Discard saved draft"/.test(src),
        `${label} banner exposes a Discard button`);
    assert.ok(/draft\.hasDraft\(\) && !draftPending/.test(src),
        `${label} only shows the banner when a draft exists and isn't already pending`);

    // 7. On success the draft is cleared (the behavioral check; the old
    //    FOLLOWUP-tag comment assertion was dropped after a comment cleanup).
    const postDoneClear = src.match(/setStage\('done'\);[\s\S]{0,400}?draft\.clear\(\);[\s\S]{0,80}?setDraftPending\(false\);/);
    assert.ok(postDoneClear,
        `${label} calls draft.clear() + setDraftPending(false) immediately after setStage('done')`);
}

console.log('OK: form-draft persistence sweep (IssueTokenForm + DispenserForm)');
