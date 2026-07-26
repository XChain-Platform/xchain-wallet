// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings: Step 8: Notifications panel.

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

// §46: the permission affordance reads the live browser permission and
// offers a request button (web + desktop renderer; hidden where the
// Notification API is absent).
assert.match(src, /Notification\.permission/, 'reads live Notification.permission');
assert.match(src, /Notification\.requestPermission\(\)/, 'requests notification permission');
assert.match(src, /Request permission/, 'renders a Request permission control');
assert.match(src, /<PermissionRow \/>/, 'mounts the permission row above the toggles');

// Every notification flag the schema defines is wired in the section.
const schemaFlagsBlock = schemaSrc.match(/notifications:\s*\{[\s\S]*?\}\s*,/);
assert.ok(schemaFlagsBlock, 'extract notifications object from schema source');
const flagKeys = [...schemaFlagsBlock[0].matchAll(/(\w+):\s*(?:true|false)/g)].map((m) => m[1]);
assert.equal(flagKeys.length, 8, `schema defines exactly 8 notification flags (got ${flagKeys.length})`);
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
assert.match(block, /props:\s*\{\s*walletId:\s*activeWallet\?\.id\s*\}/, 'threads the active walletId into the section');

// §46 price-alert manager: the toggle now has a real CRUD surface under
// it, hard-gated on the privacy price-data opt-out.
assert.match(src, /import \{ usePriceAlerts \}/, 'imports the usePriceAlerts hook');
assert.match(src, /PriceAlertForm/, 'renders the shared PriceAlertForm');
assert.match(src, /PriceAlertsManager/, 'renders the price-alert manager under the toggle');
assert.match(src, /priceDataEnabled === false/, 'gates on the price-data privacy opt-out');
assert.match(src, /Native coin price data/, 'surfaces the price-data dependency to the user');
assert.match(src, /Re-arm/, 'offers re-arm on a triggered alert');

// : quiet-hours (DND) scheduling block.
assert.match(src, /import \{ QUIET_HOURS_DEFAULT \}/, 'imports the schema quiet-hours default');
assert.match(src, /function QuietHoursRow/, 'defines a QuietHoursRow component');
assert.match(src, /<QuietHoursRow settings=\{settings\} update=\{update\} \/>/, 'mounts QuietHoursRow under the flag list');
assert.match(src, /Quiet hours/, 'labels the quiet-hours toggle');
assert.match(src, /quietHours:\s*\{\s*\.\.\.qh,\s*enabled\s*\}/, 'writes the enabled flag through a nested quietHours patch');
assert.match(src, /type="time"/, 'renders start/end time inputs');
const schemaHasQuietHours = /quietHours\??:/.test(schemaSrc) || readFileSync(schemaPath, 'utf8').includes('quietHours');
assert.ok(schemaHasQuietHours, 'schema documents/defines quietHours');

console.log('settings-notifications smoke OK');
