// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §35 Settings — Step 11 — Developer Mode panel + regtest reveal.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'DeveloperModeSection.jsx');
const networkPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'NetworkEndpointsSection.jsx');
const hookPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useDeveloperMode.js');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');
const networkSrc = readFileSync(networkPath, 'utf8');
const hookSrc = readFileSync(hookPath, 'utf8');
const settingsSrc = readFileSync(settingsPath, 'utf8');

// ─── Panel surface ───────────────────────────────────────────────

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /update\(\{\s*\[field\]:\s*next\s*\}\)/,
    'writes through update({ [field]: next })',
);
assert.match(src, /label="Developer Mode"/, 'Developer Mode toggle present');
assert.match(src, /label="Learn Mode"/, 'Learn Mode toggle present');
assert.match(src, /onToggle\('developerMode'/, 'developerMode field wired');
assert.match(src, /onToggle\('learnMode'/, 'learnMode field wired');

// Only Raw PSBT remains as a placeholder ToggleRow at v0.215.0:
//  - Custom chain registry row → replaced by RegtestNetworksRow (G149, v0.214.0)
//  - Auto-approve localhost → wired ToggleRow (G151, v0.213.0)
//  - Logs and diagnostics console → replaced by LogConsoleRow (G150, v0.215.0)
assert.ok(src.includes('label="Raw PSBT inspector"'),
    'Raw PSBT inspector deferred row still present');
assert.ok(src.includes('label="Auto-approve localhost dApps"'),
    'Auto-approve localhost dApps row present (active, gated on Developer Mode)');
assert.ok(/RegtestNetworksRow/.test(src),
    'Regtest networks subsection mounted (replaces the deferred Custom chain registry row)');
assert.ok(/LogConsoleRow/.test(src),
    'Logs and diagnostics console row mounted (replaces the deferred toggle)');
assert.ok(/Logs and diagnostics console/.test(src),
    'Logs and diagnostics console label preserved on the LogConsoleRow');

// ─── Regtest reveal in NetworkEndpointsSection ────────────────────

assert.match(
    networkSrc,
    /registryLib\.filterChainsForUser\(/,
    'NetworkEndpointsSection routes regtest filtering through the shared visibility helper',
);

// ─── useDeveloperMode hook ───────────────────────────────────────

assert.match(hookSrc, /export function useDeveloperMode\(\)/, 'hook is named export');
assert.match(hookSrc, /import \{ useSettings \}/, 'hook builds on useSettings');
assert.match(hookSrc, /developerMode = Boolean\(settings\?\.developerMode\)/, 'returns developerMode boolean');

// ─── Settings.jsx wiring ─────────────────────────────────────────

assert.match(settingsSrc, /import \{ DeveloperModeSection \}/, 'Settings.jsx imports section');
const idx = settingsSrc.indexOf("id: 'developer'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*DeveloperModeSection/);

console.log('settings-developer-mode smoke OK');
