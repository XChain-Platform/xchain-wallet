// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch Step 6 of 7: Reproducible-build
// scaffolding gate. The actual run-twice-and-compare verification
// has to happen on a fresh dev machine; this smoke catches drift
// in the scaffolding (digest pinning lost, frozen-lockfile flag
// dropped, etc.) before it reaches CI.

import { strict as assert } from 'node:assert';
import { runReproBuildAudit } from '../../../packages/core/scripts/repro-build-audit.js';

const results = runReproBuildAudit();
const failed = results.filter((r) => !r.ok);
assert.equal(failed.length, 0,
    `repro-build audit: ${failed.length} rule(s) failed:\n${
        failed.map((r) => `  ✗ ${r.rule}: ${r.detail}`).join('\n')
    }`);

console.log(
    `OK: repro-build audit smoke (${results.length} rules pass: digest-pinned base + Node pin + locale pins + SOURCE_DATE_EPOCH wiring + frozen-lockfile + sha256 manifest + worktree isolation + asar + xz compression + Level-2 docs)`,
);
