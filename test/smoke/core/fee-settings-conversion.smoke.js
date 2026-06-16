// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX — Step 5 — settings ↔ display rate
// conversion helpers.

import { strict as assert } from 'node:assert';
import {
    settingsCustomToDisplayRate,
    displayRateToSettingsCustom,
} from '../../../packages/core/src/flows/feeEstimate.js';

// --- settingsCustomToDisplayRate ----------------------------------------

// BTC/LTC: settings.customSatsPerKb stores sats/KB; display is sat/vB.
// 1000 sats/KB = 1 sat/vB
assert.equal(settingsCustomToDisplayRate('sat/vB', 1000), 1);
assert.equal(settingsCustomToDisplayRate('sat/vB', 6000), 6);
assert.equal(settingsCustomToDisplayRate('sat/vB', 12500), 12.5);
assert.equal(settingsCustomToDisplayRate('sat/vB', 0), 0);

// DOGE: customSatsPerKb stores koinu/KB; display is DOGE/kB.
// 100_000_000 koinu/KB = 1 DOGE/kB
assert.equal(settingsCustomToDisplayRate('DOGE/kB', 100_000_000), 1);
assert.equal(settingsCustomToDisplayRate('DOGE/kB', 50_000_000), 0.5);
assert.equal(settingsCustomToDisplayRate('DOGE/kB', 0), 0);

// Invalid input → 0
assert.equal(settingsCustomToDisplayRate('sat/vB', NaN), 0);
assert.equal(settingsCustomToDisplayRate('sat/vB', -100), 0);
assert.equal(settingsCustomToDisplayRate('sat/vB', null), 0);

// --- displayRateToSettingsCustom (inverse) -----------------------------

assert.equal(displayRateToSettingsCustom('sat/vB', 6), 6000);
assert.equal(displayRateToSettingsCustom('sat/vB', 1), 1000);
assert.equal(displayRateToSettingsCustom('DOGE/kB', 1), 100_000_000);
assert.equal(displayRateToSettingsCustom('DOGE/kB', 0.5), 50_000_000);
assert.equal(displayRateToSettingsCustom('sat/vB', 0), 0);
assert.equal(displayRateToSettingsCustom('sat/vB', NaN), 0);
assert.equal(displayRateToSettingsCustom('sat/vB', -1), 0);

// --- round-trip identity -----------------------------------------------

for (const v of [1, 6, 12.5, 100, 0.001]) {
    const rt = settingsCustomToDisplayRate('sat/vB', displayRateToSettingsCustom('sat/vB', v));
    assert.ok(Math.abs(rt - v) < 1e-3, `BTC/LTC round-trip ${v} → ${rt}`);
}
for (const v of [0.5, 1, 2, 100]) {
    const rt = settingsCustomToDisplayRate('DOGE/kB', displayRateToSettingsCustom('DOGE/kB', v));
    assert.ok(Math.abs(rt - v) < 1e-7, `DOGE round-trip ${v} → ${rt}`);
}

console.log('fee-settings-conversion smoke OK');
