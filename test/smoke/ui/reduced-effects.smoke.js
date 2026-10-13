// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';

import { runReducedEffectsAudit } from '../../../packages/core/scripts/reduced-effects-audit.js';

const audit = runReducedEffectsAudit();
const listed = audit.ungatedBackdropFilters.map(
    ({ file, line, value }) => `${file}:${line}: ${value}`,
);

console.log(`Ungated backdrop-filter uses:\n${listed.join('\n') || '(none)'}`);
assert.ok(audit.hasGuard, 'tokens.css defines reduced-effects guards');
assert.deepEqual(listed, [], 'all backdrop-filter uses reference the reduced-effects token');
