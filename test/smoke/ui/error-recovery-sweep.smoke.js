// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster P FOLLOWUP 4: error-recovery sweep. v0.211.0 wired Send +
// PsbtSignForm + ImportWallet (backup lane) + PairSignerForm. This
// sweep extends auditable coverage to IssueTokenForm + DispenserForm +
// AddAccountForm. The goal is per-form coverage, not 100% recovery
// support: each form either ships an inline `recovery: { label,
// onAction }` or carries a header note explaining why the error class
// is genuinely "user-iterates over an input": terminal-as-rendered.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEnglishCopy } from '../_localized-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function sourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(?:js|jsx)$/.test(entry.name) ? [full] : [];
    });
}

// Caught-message shapes that reach the screen without the user-facing filter:
// an error setter handed `<caught>?.message || ...` under any variable name,
// and an `error:` field of a load-state object built the same way.
const RAW_SETTER = /set[A-Za-z]*(?:Error|Err|Status)\(\s*\(?\s*[A-Za-z_$][\w$]*\??\.message\s*(?:\|\||\?\?)/g;
const RAW_STATE_FIELD = /\berror:\s*(?:[^,\n;]*\?\s*null\s*:\s*)?\(?\s*[A-Za-z_$][\w$]*\??\.message\s*(?:\|\||\?\?)/g;
// The approval screen keeps the caught message in its decode state on purpose:
// its panels filter it at render time and offer the original as a disclosure.
const STATE_FIELD_ROOTS = [
    'packages/core/src/shared/routes',
    'packages/core/src/shared/components',
];

function rawErrorShapes(source, patterns) {
    return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match.index));
}

function rawErrorSetters() {
    const sourceRoots = [
        'packages/core/src',
        'packages/extension/src',
        'packages/web/src',
        'packages/desktop/renderer',
    ];
    return sourceRoots.flatMap((sourceRoot) => sourceFiles(join(root, sourceRoot)))
        .flatMap((file) => {
            const rel = file.slice(root.length + 1).split('\\').join('/');
            const patterns = STATE_FIELD_ROOTS.some((prefix) => rel.startsWith(`${prefix}/`))
                ? [RAW_SETTER, RAW_STATE_FIELD]
                : [RAW_SETTER];
            return rawErrorShapes(readFileSync(file, 'utf8'), patterns).map((index) => `${rel}:${index}`);
        });
}

// Negative controls: the guard must flag each raw shape and pass each filtered one.
for (const raw of [
    "setLoadError(err?.message || 'Failed to load addresses.')",
    "setLoadError(caught?.message || 'Failed to load.')",
    "setError(ex.message ?? 'x')",
    "setStatus({ error: err?.message || 'x' })",
    "{ loading: false, error: missing ? null : (err?.message || String(err)) }",
]) {
    assert.ok(rawErrorShapes(raw, [RAW_SETTER, RAW_STATE_FIELD]).length > 0, `guard flags: ${raw}`);
}
for (const filtered of [
    "setLoadError(userFacingMessage(err, 'Failed to load addresses.'))",
    "setStatus({ error: userFacingMessage(err, 'x') })",
]) {
    assert.equal(rawErrorShapes(filtered, [RAW_SETTER, RAW_STATE_FIELD]).length, 0, `guard passes: ${filtered}`);
}

const issueSrc = withEnglishCopy(read('packages/core/src/shared/routes/IssueTokenForm.jsx'));
const dispSrc = read('packages/core/src/shared/routes/DispenserForm.jsx');
const acctSrc = read('packages/core/src/shared/routes/AddAccountForm.jsx');

// 1. IssueTokenForm: post-submit errors enter Confirm Standard's warning slot,
//    and Reject clears the error and returns to the populated form.
assert.ok(/<ConfirmActionModal[\s\S]{0,900}error=\{submitError\}/.test(issueSrc),
    'IssueTokenForm hands post-submit errors to Confirm Standard');
assert.ok(/onReject=\{\(\) => \{ setSubmitError\(null\); setStage\('form'\); \}\}/.test(issueSrc),
    'IssueTokenForm Reject clears the error and returns to the form');
// Field validation uses the focusable summary and its direct field links.
assert.ok(/errors=\{formErrors\}\s+lead=\{draftBanner\}\s+status=\{offlineNotice\}/.test(issueSrc),
    'IssueTokenForm renders field errors at the top and keeps draft and offline notices in their fixed slots');
// Inline div role="alert" for those two error sites is gone (modulo
// the warnings + chain-empty fallback row, which are not recovery
// candidates).
assert.equal(
    (issueSrc.match(/<div role="alert" className=\{styles\.error\}>\{(submitError|formError)\}<\/div>/g) || []).length,
    0,
    'IssueTokenForm replaces the inline submit/form error divs with StatusMessage');

// 2. DispenserForm keeps an explicit Edit recovery on its watcher and hardware
//    error path until that remaining review adapter moves to Confirm Standard.
assert.ok(/\(isWatcherMode \|\| hw\) && submitError \?[\s\S]{0,500}<StatusMessage[\s\S]{0,800}\{ label: 'Edit', onAction: \(\) => \{ setSubmitError\(null\); setStage\('form'\); \} \}/.test(dispSrc),
    'DispenserForm wraps post-submit error in StatusMessage with an Edit recovery');
assert.ok(/errors=\{formErrors\}\s+lead=\{draftBanner\}\s+status=\{closedTermsNotes\}/.test(dispSrc),
    'DispenserForm renders field errors at the top and keeps draft and terms notices in their fixed slots');
assert.equal(
    (dispSrc.match(/<div role="alert" className=\{styles\.error\}>\{(submitError|formError)\}<\/div>/g) || []).length,
    0,
    'DispenserForm replaces the inline submit/form error divs with StatusMessage');

assert.deepEqual(
    rawErrorSetters(),
    [],
    'UI error state must filter caught messages through userFacingMessage',
);

// 3. AddAccountForm carries the audit header noting recovery is
//    user-iteration via the Input (no fitting one-click affordance).
assert.ok(/Cluster P FOLLOWUP 4: error-recovery audit/.test(acctSrc),
    'AddAccountForm header documents the error-recovery audit decision');
assert.ok(/terminal-as-rendered with user-iteration as the recovery path/.test(acctSrc),
    'AddAccountForm header explains the auditable terminal-as-rendered classification');

console.log('OK: error-recovery sweep (IssueTokenForm + DispenserForm + AddAccountForm)');
