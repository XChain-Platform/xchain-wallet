// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the §35 Settings drilldown refactor.
//
// Top-level §35 page collapses from 16 inline panels to a scannable
// list: 4 panel rows kept inline, 1 external-drill (Accounts &
// Addresses → AccountPicker), and 10 internal-drills that drill into
// a Settings sub-page rendering the section's existing Component.
// Each drill row carries a `summary` string so the user can see
// current state without entering the panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const src = readFileSync(settingsPath, 'utf8');

// ─── 1. Top-level layout split ───────────────────────────────────

const expectedDrills = [
    'this-wallet',
    'privacy',
    'safety',
    'backup',
    'fees',
    'network-endpoints',
    'connected-sites',
    'ads',
    'developer',
    'about',
];
for (const id of expectedDrills) {
    const idx = src.indexOf(`id: '${id}'`);
    assert.ok(idx >= 0, `section id:${id} present`);
    const block = src.slice(idx, idx + 800);
    assert.match(block, /kind:\s*'internal-drill'/, `${id} is internal-drill`);
    assert.match(block, /summary:/, `${id} carries a summary string`);
}

// Accounts & Addresses stays as external-drill since it routes to the
// existing AccountPicker route, not into the Settings sub-page tree.
const accIdx = src.indexOf("id: 'accounts-addresses'");
const accBlock = src.slice(accIdx, accIdx + 600);
assert.match(accBlock, /kind:\s*'external-drill'/, 'accounts-addresses uses external-drill');

const expectedPanels = ['appearance', 'language-region', 'notifications', 'contacts'];
for (const id of expectedPanels) {
    const idx = src.indexOf(`id: '${id}'`);
    const block = src.slice(idx, idx + 600);
    assert.match(block, /kind:\s*'panel'/, `${id} stays inline (panel)`);
}

// ─── 2. Subpage routing primitives ───────────────────────────────

assert.match(src, /\[subpageId, setSubpageId\]\s*=\s*useState/, 'subpageId state added');
assert.match(src, /if \(subpageId\)\s*\{/, 'subpage branch in render');
assert.match(src, /aria-label="Back to settings"/, 'subpage header has back-to-settings affordance');
assert.match(src, /<SectionComponent \{\.\.\.\(section\.props \|\| \{\}\)\} \/>/, 'subpage renders the section component with its props');

// ─── 3. DrillRow primitive renders summary + chevron ─────────────

assert.match(src, /function DrillRow\(/, 'DrillRow primitive defined');
assert.match(src, /<Icon\.ForwardIcon \/>/, 'chevron rendered');
assert.match(src, /textOverflow:\s*'ellipsis'/, 'long summary truncates with ellipsis');

// ─── 4. Settings calls useSettings to compute summaries ──────────

assert.match(src, /const \{ settings \} = useSettings\(\)/, 'useSettings invoked');
assert.match(src, /messaging\.listConnectedSites\(\)/, 'site count fetched for the connected-sites summary');

// ─── 5. Summary helper functions cover each computed summary ─────

for (const fn of ['privacySummary', 'safetySummary', 'feesSummary', 'endpointsSummary', 'adsSummary', 'developerSummary', 'connectedSitesSummary']) {
    assert.match(src, new RegExp(`function ${fn}\\(`), `${fn} helper defined`);
}

// ─── 6. Summary semantics: sample assertions ─────────────────────

// privacy: counts the on flags
assert.match(src, /flags\.filter\(\(k\) => Boolean\(p\[k\]\)\)\.length/, 'privacy summary counts on flags');
// fees: counts strategy === 'custom'
assert.match(src, /strategy === 'custom'/, 'fees summary detects custom strategy');
// endpoints: counts custom flag
assert.match(src, /Object\.values\(eps\)\.filter\(\(e\) => e\?\.custom\)\.length/, 'endpoints summary counts custom overrides');
// ads: sums lifetimeDonatedSats across chains
assert.match(src, /lifetimeDonatedSats/, 'ads summary aggregates lifetimeDonatedSats');

console.log('settings-drilldown-refactor smoke OK');
