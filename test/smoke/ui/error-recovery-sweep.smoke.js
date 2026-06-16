// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster P FOLLOWUP 4 — error-recovery sweep. v0.211.0 wired Send +
// PsbtSignForm + ImportWallet (backup lane) + PairSignerForm. This
// sweep extends auditable coverage to IssueTokenForm + DispenserForm +
// AddAccountForm. The goal is per-form coverage, not 100% recovery
// support: each form either ships an inline `recovery: { label,
// onAction }` or carries a header note explaining why the error class
// is genuinely "user-iterates over an input" — terminal-as-rendered.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const issueSrc = read('packages/core/src/shared/routes/IssueTokenForm.jsx');
const dispSrc = read('packages/core/src/shared/routes/DispenserForm.jsx');
const acctSrc = read('packages/core/src/shared/routes/AddAccountForm.jsx');

// 1. IssueTokenForm: post-submit error wraps in StatusMessage with an
//    "Edit" recovery action that returns to the form stage.
assert.ok(/Cluster P FOLLOWUP 4/.test(issueSrc),
    'IssueTokenForm tags FOLLOWUP 4');
assert.ok(/\(isWatcherMode \|\| isHwSource\) && submitError \?[\s\S]{0,500}<StatusMessage[\s\S]{0,800}\{ label: 'Edit', onAction: \(\) => \{ setSubmitError\(null\); setStage\('form'\); \} \}/.test(issueSrc),
    'IssueTokenForm wraps post-submit error in StatusMessage with an Edit recovery');
// formError is wrapped in StatusMessage (consistency upgrade); no recovery affordance.
assert.ok(/formError \?[\s\S]{0,500}<StatusMessage variant="error">\{formError\}<\/StatusMessage>/.test(issueSrc),
    'IssueTokenForm wraps formError in StatusMessage');
// Inline div role="alert" for those two error sites is gone (modulo
// the warnings + chain-empty fallback row, which are not recovery
// candidates).
assert.equal(
    (issueSrc.match(/<div role="alert" className=\{styles\.error\}>\{(submitError|formError)\}<\/div>/g) || []).length,
    0,
    'IssueTokenForm replaces the inline submit/form error divs with StatusMessage');

// 2. DispenserForm mirrors the same pattern.
assert.ok(/Cluster P FOLLOWUP 4/.test(dispSrc),
    'DispenserForm tags FOLLOWUP 4');
assert.ok(/\(isWatcherMode \|\| hw\) && submitError \?[\s\S]{0,500}<StatusMessage[\s\S]{0,800}\{ label: 'Edit', onAction: \(\) => \{ setSubmitError\(null\); setStage\('form'\); \} \}/.test(dispSrc),
    'DispenserForm wraps post-submit error in StatusMessage with an Edit recovery');
assert.ok(/formError \?[\s\S]{0,500}<StatusMessage variant="error">\{formError\}<\/StatusMessage>/.test(dispSrc),
    'DispenserForm wraps formError in StatusMessage');
assert.equal(
    (dispSrc.match(/<div role="alert" className=\{styles\.error\}>\{(submitError|formError)\}<\/div>/g) || []).length,
    0,
    'DispenserForm replaces the inline submit/form error divs with StatusMessage');

// 3. AddAccountForm carries the audit header noting recovery is
//    user-iteration via the Input (no fitting one-click affordance).
assert.ok(/Cluster P FOLLOWUP 4 — error-recovery audit/.test(acctSrc),
    'AddAccountForm header documents the error-recovery audit decision');
assert.ok(/terminal-as-rendered with user-iteration as the recovery path/.test(acctSrc),
    'AddAccountForm header explains the auditable terminal-as-rendered classification');

console.log('OK — error-recovery sweep (IssueTokenForm + DispenserForm + AddAccountForm)');
