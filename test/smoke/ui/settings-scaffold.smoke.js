// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §35 Settings page scaffold (Step 2 of the Settings build).
//
// Source-level checks: the Settings route renders all 16 spec §35.1
// sections in spec order, in addition to the existing This-Wallet +
// Accounts-&-Addresses drilldowns it already had. A search input is
// present (non-functional in this scaffold). A `ComingSoon` placeholder
// is rendered for sections that are not yet built.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const src = readFileSync(settingsPath, 'utf8');

// ─── 1. Search input present ─────────────────────────────────────────

assert.match(src, /type="search"/, 'search input present');
assert.match(src, /aria-label="Search settings"/, 'search input is accessibility-labelled');
assert.match(src, /placeholder="Search settings…"/, 'search input has placeholder copy');

// ─── 2. All 16 §35.1 sections referenced by id ───────────────────────

const expectedIds = [
    'this-wallet',
    'accounts-addresses',
    'appearance',
    'language-region',
    'privacy',
    'safety',
    'backup',
    'fees',
    'network-endpoints',
    'notifications',
    'connected-sites',
    'contacts',
    'ads',
    'developer',
    'about',
];
for (const id of expectedIds) {
    assert.match(src, new RegExp(`id:\\s*'${id}'`), `section "${id}" present in Settings.jsx`);
}

// ─── 3. Sections appear in spec order ────────────────────────────────

const idOrder = expectedIds.map((id) => {
    const idx = src.indexOf(`id: '${id}'`);
    assert.ok(idx >= 0, `expected to find id:${id}`);
    return { id, idx };
});
for (let i = 1; i < idOrder.length; i += 1) {
    assert.ok(
        idOrder[i].idx > idOrder[i - 1].idx,
        `section "${idOrder[i].id}" must appear after "${idOrder[i - 1].id}" in source`,
    );
}

// ─── 4. The two existing drilldowns are still wired ──────────────────

assert.match(src, /kind:\s*'external-drill'/, 'external-drill (Wallet/Account picker) kind present');
assert.match(src, /kind:\s*'internal-drill'/, 'internal-drill (settings sub-page) kind present');
assert.match(src, /onOpenWalletPicker/, 'wallet picker drilldown still wired');
assert.match(src, /onOpenAccountPicker/, 'account picker drilldown still wired');

// ─── 5. The 14 unbuilt sections render a "Coming soon" placeholder ───

assert.match(src, /function ComingSoon\(/, 'ComingSoon placeholder defined');
assert.match(src, /<ComingSoon \/>/, 'ComingSoon rendered for stub sections');
assert.match(src, /Coming soon/, 'placeholder copy present');

// ─── 6. Section descriptions exist (so search has content to match) ──

for (const id of expectedIds) {
    // each section literal block has a `description` field
    const idIdx = src.indexOf(`id: '${id}'`);
    const block = src.slice(idIdx, idIdx + 600);
    assert.match(block, /description:\s*'[^']+'/,
        `section "${id}" has a description string`);
    assert.match(block, /keywords:\s*'[^']+'/,
        `section "${id}" has a keywords string for search`);
}

console.log('settings-scaffold smoke OK');
