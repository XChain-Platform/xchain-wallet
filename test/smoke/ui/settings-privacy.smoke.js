// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings — Step 6 — Privacy panel.

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
    'privacy writes go through update({ privacy: { [field]: next } }) — nested merge',
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
