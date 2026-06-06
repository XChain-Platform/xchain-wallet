// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch Step 5 of 7 — Static a11y audit gate.
// Asserts the audit script returns zero violations across every
// shared route + UI primitive.

import { strict as assert } from 'node:assert';
import { runA11yAudit } from '../../../packages/core/scripts/a11y-audit.js';

const violations = runA11yAudit();
assert.equal(violations.length, 0,
    `a11y audit found ${violations.length} violation(s):\n${
        violations.map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.message}`).join('\n')
    }`);

console.log(
    `OK — a11y audit smoke (0 violations across shared/ + ui/ JSX surfaces; ${
        violations.length === 0 ? 'rules: button label / img alt / input label / textarea label / div onClick role+tabIndex' : ''
    })`,
);
