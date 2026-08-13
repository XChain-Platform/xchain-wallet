// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: forced-colors (Windows high-contrast) audit gate.
//
// Sits beside `a11y-audit.smoke.js` for the same reason that one exists: the
// browser pass that found these defects is a Playwright run against a dev
// server, and a gate that only lives there does not run on most changes. This
// one is a file read, so it runs everywhere the smokes do.

import { strict as assert } from 'node:assert';
import { runForcedColorsAudit } from '../../../packages/core/scripts/forced-colors-audit.js';

const violations = runForcedColorsAudit();
assert.equal(violations.length, 0,
    `forced-colors audit found ${violations.length} violation(s):\n${
        violations.map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.message}`).join('\n')
    }`);

console.log(
    'OK: forced-colors audit smoke (0 violations across every package stylesheet; '
    + 'rules: focus-indicator-erased / mixed-forced-pair / gradient-surface-unpinned)',
);
