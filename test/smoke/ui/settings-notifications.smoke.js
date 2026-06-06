// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §35 Settings — Step 8 — Notifications panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'NotificationsSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const schemaPath = join(wsRoot, 'packages', 'core', 'src', 'schemas', 'settings.js');

const src = readFileSync(sectionPath, 'utf8');
const schemaSrc = readFileSync(schemaPath, 'utf8');

assert.match(src, /import \{ useSettings \}/, 'imports useSettings');
assert.match(
    src,
    /update\(\{\s*notifications:\s*\{\s*\[key\]:\s*next\s*\}\s*\}\)/,
    'writes through nested notifications patch',
);

// Every notification flag the schema defines is wired in the section.
const schemaFlagsBlock = schemaSrc.match(/notifications:\s*\{[\s\S]*?\}\s*,/);
assert.ok(schemaFlagsBlock, 'extract notifications object from schema source');
const flagKeys = [...schemaFlagsBlock[0].matchAll(/(\w+):\s*(?:true|false)/g)].map((m) => m[1]);
assert.equal(flagKeys.length, 5, `schema defines exactly 5 notification flags (got ${flagKeys.length})`);
for (const key of flagKeys) {
    assert.ok(
        src.includes(`key: '${key}'`),
        `NOTIFICATION_FLAGS has entry for schema key '${key}'`,
    );
}

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ NotificationsSection \}/, 'Settings.jsx imports NotificationsSection');
const idx = settingsSrc.indexOf("id: 'notifications'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*NotificationsSection/);

console.log('settings-notifications smoke OK');
