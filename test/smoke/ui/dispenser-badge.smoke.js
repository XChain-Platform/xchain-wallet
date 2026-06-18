// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 11 smoke: Dispenser-available badge on MarketsList (§41.6).
//
// Asserts:
//   1. DispenserBadge.jsx exists with named export + reuses
//      messaging.getDispensersForToken + session cache.
//   2. Renders null when count is 0 or still loading (returns early).
//   3. MarketsList.jsx imports DispenserBadge and renders one badge
//      per ticker in each market row.
//   4. __clearDispenserBadgeCache test helper exported so downstream
//      unit-test runners can reset the module-level cache.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. DispenserBadge component ---------------------------------------

const badgePath = join(core, 'src', 'shared', 'components', 'DispenserBadge.jsx');
assert.ok(existsSync(badgePath), 'DispenserBadge.jsx exists');
const src = readFileSync(badgePath, 'utf8');
assert.ok(/export function DispenserBadge\b/.test(src), 'DispenserBadge is a named export');
assert.ok(/messaging\.getDispensersForToken\s*\(/.test(src),
    'DispenserBadge queries messaging.getDispensersForToken');
assert.ok(/const CACHE = new Map\(\)/.test(src),
    'DispenserBadge declares a module-level CACHE Map');
assert.ok(/isOpen\b/.test(src),
    'DispenserBadge filters to open dispensers (isOpen helper)');

// --- 2. Early-return behaviour -----------------------------------------

assert.ok(/if\s*\(\s*count\s*===\s*null\s*\|\|\s*count\s*===\s*0\s*\)\s*return\s+null/.test(src),
    'DispenserBadge renders nothing when count is null (loading) or 0');

// --- 3. MarketsList wiring ---------------------------------------------

const listPath = join(core, 'src', 'shared', 'routes', 'MarketsList.jsx');
const listSrc = readFileSync(listPath, 'utf8');
assert.ok(/import\s*\{\s*DispenserBadge\s*\}/.test(listSrc),
    'MarketsList imports DispenserBadge');
const badgeMatches = listSrc.match(/<DispenserBadge\b/g) || [];
assert.ok(badgeMatches.length >= 2,
    'MarketsList renders a DispenserBadge for each market ticker (tick1 + tick2)');
assert.ok(/tick={tick1}/.test(listSrc) && /tick={tick2}/.test(listSrc),
    'MarketsList passes both tick1 and tick2 to DispenserBadge');

// --- 4. Test hook ------------------------------------------------------

assert.ok(/export function __clearDispenserBadgeCache\b/.test(src),
    'DispenserBadge exports __clearDispenserBadgeCache for downstream tests');

console.log(
    'OK: dispenser-badge smoke (§41.6 DispenserBadge with session cache + MarketsList row wiring for tick1 + tick2; renders nothing when no open dispensers or still loading; reuses messaging.getDispensersForToken)',
);
