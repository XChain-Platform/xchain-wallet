// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 + §36 Settings — Step 12 — Automatic Donation System.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AdsSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');
const settingsSrc = readFileSync(settingsPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /import \{ ADS_DONATION_ADDRESS_PLACEHOLDER \}/,
    'imports placeholder sentinel',
);

// Master toggle
assert.match(src, /label="Automatic Donation System"/, 'master ON/OFF toggle present');
assert.match(
    src,
    /update\(\{\s*ads:\s*\{\s*enabled:\s*next\s*\}\s*\}\)/,
    'master toggle writes through nested ads.enabled patch',
);

// Per-chain numeric edits
for (const field of ['perTxAmountSats', 'triggerAmountSats']) {
    const re = new RegExp(`onChainPatch\\(chainId,\\s*\\{\\s*${field}:\\s*n\\s*\\}\\)`);
    assert.match(src, re, `chain patch carries ${field}`);
}
assert.match(
    src,
    /update\(\{\s*ads:\s*\{\s*perChain:\s*\{\s*\[chainId\]:\s*patch\s*\}\s*\}\s*\}\)/,
    'chain writes through update({ ads: { perChain: { [chainId]: patch }}})',
);

// Lifetime stats display
for (const field of ['lifetimeDonatedSats', 'lifetimeTxCount', 'accumulatedSats']) {
    assert.ok(
        src.includes(`chainState.${field}`),
        `lifetime stats render ${field}`,
    );
}

// Donation address: placeholder vs real
assert.match(src, /isPlaceholder\b/, 'placeholder branch present');
assert.match(src, /Pending — real /, 'placeholder copy present');

// Inputs disable when ADS is off so the user can't poke them
assert.match(src, /disabled=\{!settings\.ads\.enabled\}/, 'inputs disable when ADS is off');

// Regtest filtering goes through the shared visibility helper.
assert.match(src, /registryLib\.isChainVisibleToUser\(d, settings\)/, 'regtest filter via shared helper');

// Settings.jsx wiring
assert.match(settingsSrc, /import \{ AdsSection \}/, 'Settings.jsx imports AdsSection');
const idx = settingsSrc.indexOf("id: 'ads'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*AdsSection/);

console.log('settings-ads smoke OK');
