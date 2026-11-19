// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings, Step 11, Developer Mode panel + regtest reveal.

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
assert.match(src, /label=\{t\('settings\.toggle\.turnOn'\)\}\s*accessibleLabel=\{t\('settings\.developerMode\.switchAccessibleLabel'\)\}/, 'Developer Mode toggle present');
assert.match(src, /label=(?:\{t\('settings\.developer\.learnMode'\)\}|"Learn Mode")/, 'Learn Mode toggle present');
assert.match(src, /onToggle\('developerMode'/, 'developerMode field wired');
assert.match(src, /onToggle\('learnMode'/, 'learnMode field wired');
// Each tool opens its own page, so it is a drill-in ListRow (G97) titled by
// the tool name, not a labelled button.
assert.match(src, /title=(?:\{t\('settings\.developer\.advancedAction'\)\}|\{?["'`]Advanced action["'`]\}?)/, 'Advanced action row present');
assert.match(src, /onClick=\{onNavigateToAdvanced\}/, 'Advanced action row opens its route');
assert.match(src, /title=(?:\{t\('settings\.developer\.actionQueue'\)\}|\{?["'`]Action queue["'`]\}?)/, 'Action queue row present');
assert.match(src, /onClick=\{onNavigateToActionQueue\}/, 'Action queue row opens its route');

// No placeholder ToggleRow remains. The Raw PSBT inspector row was a permanently
// disabled "Coming soon" promise; spec §48.4 describes a "View raw PSBT" button on
// the sign screens, not a Settings toggle, so Settings no longer lists it.
//  - Custom chain registry row → replaced by RegtestNetworksRow (G149, v0.214.0)
//  - Auto-approve localhost → wired ToggleRow (G151, v0.213.0)
//  - Logs and diagnostics console → replaced by LogConsoleRow (G150, v0.215.0)
assert.ok(!src.includes('Raw PSBT inspector') && !/Coming soon/.test(src),
    'no Raw PSBT inspector placeholder row (no code delivers it)');
assert.ok(src.includes("label={t('settings.developer.autoApproveLocalhostDapps')}") || src.includes('label="Auto-approve localhost dApps"'),
    'Auto-approve localhost dApps row present (active, gated on Developer Mode)');
// Regtest and custom networks moved to the Test Networks page that
// Developer options opens (operator picks 2026-11-14).
assert.ok(!/RegtestNetworksRow/.test(src),
    'the old Regtest networks subsection is gone from the Developer section');
assert.ok(/row\(TEST_NETWORKS_PAGE_ID, 'Test networks', Icon\.BroadcastIcon, TestNetworksPage/.test(settingsSrc),
    'Developer options lists the Test networks row');
assert.ok(/LogConsoleRow/.test(src),
    'Logs and diagnostics console row mounted (replaces the deferred toggle)');
assert.ok(/(?:t\('settings\.developer\.logsAndDiagnosticsConsole'\)|Logs and diagnostics console)/.test(src),
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

assert.match(settingsSrc, /import \{[^}]*\bDeveloperModeSection\b[^}]*\}/, 'Settings.jsx imports section');
// The log console is a page of its own, opened from the Logs row, and it
// mounts the console only while Developer Mode is on.
assert.match(src, /export function DeveloperLogsPage\(/, 'DeveloperLogsPage is a named export');
assert.match(src, /if \(!settings\?\.developerMode\) \{[\s\S]+?\}\s*return <LiveLogsScreen \{\.\.\.chrome\} \/>;/,
    'log console mounts only with Developer Mode on');
assert.match(settingsSrc, /Component:\s*DeveloperLogsPage/, 'Settings.jsx wires the logs page');
assert.match(settingsSrc, /onOpenLogs:\s*openLogsPage/, 'the Logs row opens the logs page');
const idx = settingsSrc.indexOf("id: 'developer'");
const block = settingsSrc.slice(idx, idx + 900);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*DeveloperModeSection/);
assert.match(block, /onNavigateToAdvanced/);
assert.match(block, /onNavigateToActionQueue/);

console.log('settings-developer-mode smoke OK');
