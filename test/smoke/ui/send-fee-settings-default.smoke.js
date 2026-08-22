// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX, Step 5: Send.jsx seeds feePick from
// settings.fees[chainId].

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);

// --- imports -----------------------------------------------------------

assert.match(
    sendSrc,
    /settingsCustomToDisplayRate/,
    'imports settingsCustomToDisplayRate',
);

// --- seed effect -------------------------------------------------------

assert.match(sendSrc, /chainFees\.strategy/, 'reads strategy from settings');
assert.match(
    sendSrc,
    /chainFees\.strategy === 'custom'/,
    'custom branch handled',
);
assert.match(
    sendSrc,
    /Number\.isFinite\(chainFees\.customSatsPerKb\)/,
    'guards on finite customSatsPerKb',
);
assert.match(
    sendSrc,
    /settingsCustomToDisplayRate\(tableUnit, chainFees\.customSatsPerKb\)/,
    'converts settings rate to display unit',
);
assert.match(
    sendSrc,
    /\['low', 'normal', 'fast'\]\.includes\(chainFees\.strategy\)/,
    'tier branch only fires for known modes',
);

// --- chain-aware unit lookup ------------------------------------------

// The unit derives from the descriptor's declared feeStrategy.unit through
// flows/feeEstimate.resolveFeeUnit, the one home of that fact; a coin-name
// check here (`desc?.coin === 'dogecoin' ? 'DOGE/kB' : 'sat/vB'`) left the
// registry's validated unit dead and misconverted custom rates on any
// descriptor that declared sats-per-kbyte under a non-dogecoin coin.
assert.match(
    sendSrc,
    /const tableUnit = resolveFeeUnit\(desc\)/,
    'unit derived from descriptor.feeStrategy.unit via resolveFeeUnit',
);
assert.doesNotMatch(
    sendSrc,
    /=== 'dogecoin' \? 'DOGE\/kB'/,
    'Send.jsx keeps no coin-name fee-unit check',
);

// --- effect deps -------------------------------------------------------

assert.match(
    sendSrc,
    /\[chainId, settings\]/,
    'effect re-runs when chain or settings change',
);

console.log('send-fee-settings-default smoke OK');
