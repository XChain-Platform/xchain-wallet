// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 + §36 Settings, Step 12: Automatic Donation System.

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
    /\bisDonationAddressConfigured,[\s\S]*?\} from '\.\.\/\.\.\/\.\.\/registry\/validate\.js'/,
    'imports the configured-address check that treats the placeholder sentinel as absent',
);

// Master toggle
assert.match(src, /label=\{t\('settings\.toggle\.turnOn'\)\}\s*accessibleLabel=\{t\('settings\.ads\.switchAccessibleLabel'\)\}/, 'master ON/OFF toggle present');
assert.match(
    src,
    /update\(\{\s*ads:\s*\{\s*enabled:\s*next\s*\}\s*\}\)/,
    'master toggle writes through nested ads.enabled patch',
);

// Per-chain numeric edits
for (const field of ['perTxAmountSats', 'triggerAmountSats']) {
    const re = new RegExp(`onChainPatch\\(chainId,\\s*\\{\\s*${field}:\\s*value\\s*\\}\\)`);
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

// Donation address: a per-chain role picker, then the chosen address or the placeholder
assert.match(src, /onChainPatch\(id,\s*\{\s*donationAddressRole:\s*role\s*\}\)/, 'picker writes donationAddressRole');
assert.match(src, /const configured = isDonationAddressConfigured\(descriptor, role\)/, 'placeholder branch present');
// The smoke runner inlines argument-free t() calls as their English copy; a direct run reads the key.
assert.match(src, /value=(?:"Not available yet\."|\{t\('settings\.ads\.notAvailableYet'\)\})/, 'short placeholder copy present');
assert.match(src, /aria-description=\{t\('settings\.ads\.donationAddressArrivesLater', \{ displayName \}\)\}/, 'full placeholder description remains accessible');

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
