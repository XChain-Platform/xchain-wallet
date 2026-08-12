// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings, Step 6: Privacy panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PrivacySection.jsx');
const primitivesPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', '_settingsPrimitives.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

const src = readFileSync(sectionPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /update\(\{\s*privacy:\s*\{\s*\[field\]:\s*next\s*\}\s*\}\)/,
    'privacy writes go through update({ privacy: { [field]: next } }), nested merge',
);

// All five live toggles (v2 added blurOnBlur + labelsSurviveRestore)
for (const field of ['torRouting', 'changeAddressRotation', 'hideSmallBalances', 'blurOnBlur', 'labelsSurviveRestore']) {
    assert.ok(
        src.includes(`onToggle('${field}'`),
        `toggle for privacy.${field} present`,
    );
}
assert.match(src, /Blur sensitive data on blur/, 'blur-on-blur row present');
assert.match(src, /Labels survive restore/, 'labels-survive-restore row present');

// The Tor row is the one toggle that is NOT unconditional. It
// was offered in all three shells and implemented in none, which made it
// a privacy claim the code did not keep. It now renders only where the
// host can actually route: desktop, whose SDK runs in the Electron main
// process. A browser page cannot speak SOCKS at all, and an MV3
// extension could only proxy the user's entire browser.
assert.match(src, /import \{ shellCapabilities \}/,
    'PrivacySection imports the shell-capability check');
assert.match(src, /\{shellCapabilities\(\)\.socksProxy && \(/,
    'the Tor toggle is gated on the shell actually supporting SOCKS');
// The gate must WRAP the Tor row specifically, not sit somewhere else
// in the file while the row stays unconditional.
const torGate = src.indexOf('shellCapabilities().socksProxy && (');
const torRow = src.indexOf("onToggle('torRouting'");
assert.ok(torGate > 0 && torRow > torGate && torRow - torGate < 600,
    'the capability gate encloses the Tor toggle row');
assert.ok(!/Route SDK requests through a local Tor SOCKS5 proxy when available/.test(src),
    'the old hint is gone: it promised routing that did not exist');

// (operator ruling a): the shells that cannot route do not simply
// lose the row, they carry an explicit not-available state. Both halves
// are asserted here because dropping either one is a regression in a
// different direction: without the negative branch the feature reads as
// absent, and without `disabled`/`checked={false}` the row would be an
// operable switch again on a shell that proxies nothing.
assert.match(src, /\{!shellCapabilities\(\)\.socksProxy && \(/,
    'the non-proxying shells render an explicit unavailable row');
const unavailGate = src.indexOf('!shellCapabilities().socksProxy && (');
const unavailBlock = src.slice(unavailGate, unavailGate + 700);
assert.match(unavailBlock, /Not available on this platform/,
    'the unavailable row names the platform limit in the hint');
assert.match(unavailBlock, /checked=\{false\}/,
    'the unavailable row never draws a switch in the on position');
assert.match(unavailBlock, /\bdisabled\b/,
    'the unavailable row cannot be toggled');

// Primitives module exports what the section consumes.
const primSrc = readFileSync(primitivesPath, 'utf8');
for (const name of ['ROW', 'STACK', 'ROW_HINT', 'ToggleRow', 'Status']) {
    assert.match(
        primSrc,
        new RegExp(`export (const|function) ${name}\\b`),
        `_settingsPrimitives exports ${name}`,
    );
}
assert.match(primSrc, /role="switch"/, 'ToggleRow renders an aria switch');

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ PrivacySection \}/, 'Settings.jsx imports PrivacySection');
const idx = settingsSrc.indexOf("id: 'privacy'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/, 'flipped to panel');
assert.match(block, /Component:\s*PrivacySection/, 'wires PrivacySection');

console.log('settings-privacy smoke OK');
