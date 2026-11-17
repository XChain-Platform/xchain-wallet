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
assert.match(src, /(?:t\('settings\.notifications\.requestPermission'\)|Request Permission)/, 'renders a Request Permission control');
assert.match(
    src,
    /useNotificationPermissionAccess\(permission, setPermission\)[\s\S]*<PermissionRow access=\{access\} \/>/,
    'mounts the permission row above the toggles with shared live state',
);
assert.match(
    src,
    /permissionBlocksDelivery \|\| pendingKey !== null/,
    'disables category toggles when notification permission blocks delivery',
);
assert.match(
    src,
    /checked=\{!permissionBlocksDelivery/,
    'renders category toggles off when notification permission blocks delivery',
);

// Every notification flag the schema defines is wired in the section.
const schemaFlagsBlock = schemaSrc.match(/notifications:\s*\{[\s\S]*?\}\s*,/);
assert.ok(schemaFlagsBlock, 'extract notifications object from schema source');
const flagKeys = [...schemaFlagsBlock[0].matchAll(/(\w+):\s*(?:true|false)/g)].map((m) => m[1]);
// Ten since incomingPending (a payment seen in the mempool, before it confirms)
// joined the nine originals; the count pins that a new flag arrives WITH its
// toggle, which the loop below then checks by name.
assert.equal(flagKeys.length, 10, `schema defines exactly 10 notification flags (got ${flagKeys.length})`);
for (const key of flagKeys) {
    assert.ok(
        src.includes(`key: '${key}'`),
        `NOTIFICATION_FLAGS has entry for schema key '${key}'`,
    );
}

// Settings.jsx wiring
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ NotificationsSection[,\s}]/, 'Settings.jsx imports NotificationsSection');
const idx = settingsSrc.indexOf("id: 'notifications'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'panel'/);
assert.match(block, /Component:\s*NotificationsSection/);
assert.match(block, /props:\s*\{\s*walletId:\s*activeWallet\?\.id\s*,?/, 'threads the active walletId into the section');
// The price-alert token picker opens as the Settings screen itself (U17), so Settings hands the section its screen setter.
assert.match(block, /onTokenPickerScreenChange:\s*setTokenPickerScreen/, 'lets the price-alert picker take over the Settings screen');

// §46 price alerts (2026-11-14): the Notifications panel keeps only the
// Price alerts master switch; the alert list, the Price Alert page and the
// Add and Edit pages are PriceAlertsSection, opened from its own row.
assert.doesNotMatch(src, /PriceAlertsManager/, 'the notifications panel carries no alert manager');
const alertsSrc = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PriceAlertsSection.jsx'), 'utf8');
assert.match(alertsSrc, /import \{ usePriceAlerts \}/, 'the Price Alerts section imports the usePriceAlerts hook');
assert.match(alertsSrc, /PriceAlertForm/, 'the section renders the shared PriceAlertForm on the Add and Edit pages');
assert.match(alertsSrc, /ActionsDetailsToggle/, 'the Price Alert page uses the Actions | Details toggle');
assert.match(alertsSrc, /(?:t\('settings\.priceAlerts\.rearmAlert'\)|Re-arm alert)/, 'offers re-arm on a fired alert');
assert.match(settingsSrc, /Component:\s*PriceAlertsSection/, 'Settings registers the Price Alerts page');
assert.match(settingsSrc, /\['priceAlerts', Icon\.BellIcon/, 'the Price alerts master stays a switch on the Notifications page');

// Quiet-hours (DND) scheduling block.
assert.match(src, /import \{ QUIET_HOURS_DEFAULT \}/, 'imports the schema quiet-hours default');
assert.match(src, /function QuietHoursRow/, 'defines a QuietHoursRow component');
assert.match(src, /<QuietHoursRow settings=\{settings\} update=\{update\} \/>/, 'mounts QuietHoursRow under the flag list');
assert.match(src, /(?:t\('settings\.notifications\.pauseNotifications'\)|Pause notifications)/, 'labels the quiet-hours toggle');
assert.match(src, /quietHours:\s*\{\s*\.\.\.qh,\s*enabled\s*\}/, 'writes the enabled flag through a nested quietHours patch');
assert.match(src, /role="slider"/, 'renders keyboard-adjustable start/end time sliders');
const schemaHasQuietHours = /quietHours\??:/.test(schemaSrc) || readFileSync(schemaPath, 'utf8').includes('quietHours');
assert.ok(schemaHasQuietHours, 'schema documents/defines quietHours');

// Sounds block (§6 M4.2, row 38). The gate runs this smoke but not the unit
// suite, so these pins are the only thing standing between an edit that
// quietly moves `sounds` under `notifications` (breaking the sparse merge,
// which is only one level deep) or drops a control, and a green build.
const soundsDefault = schemaSrc.match(/sounds:\s*\{\s*enabled:\s*false,\s*perKind:\s*\{\}\s*\}/);
assert.ok(soundsDefault, 'createDefaultSettings defines sounds: { enabled: false, perKind: {} }');
assert.ok(
    !schemaFlagsBlock[0].includes('sounds'),
    'sounds default stays top-level, not nested under notifications (the sparse merge is one level deep)',
);

assert.match(
    src,
    /from '\.\.\/\.\.\/\.\.\/notifications\/notificationSounds\.js'/,
    'imports the sound palette/families from notificationSounds.js',
);
assert.match(src, /\bSOUND_FAMILIES\b/, 'uses SOUND_FAMILIES to render one row per notification family');
assert.match(src, /\bSOUND_PALETTE\b/, 'uses SOUND_PALETTE to populate each family select');
assert.match(src, /\bSOUND_NONE\b/, 'uses the SOUND_NONE sentinel for the muted pick');
assert.match(src, /\bpickedSoundForFamily\b/, 'reads the resolved pick via pickedSoundForFamily');

assert.match(src, /label=(?:\{t\('settings\.notifications\.playNotificationSounds'\)\}|"Play notification sounds")/, 'renders the master "Play notification sounds" toggle');
assert.match(
    src,
    /\{\s*value:\s*SOUND_NONE,\s*title:\s*t\('settings\.notifications\.noSound'\),\s*glyph:\s*soundIconFor\(SOUND_NONE_OPTION\),\s*leading:/,
    'each family\'s Choose Sound page offers No sound with its muted icon',
);
assert.match(src, /export function SoundPickerPage\b/, 'the Choose Sound page is the shared sound picker page');
assert.match(settingsSrc, /\|\|\s*soundPickerSectionFor\(id,\s*\{/, 'Settings resolves the Choose Sound page ids with navigation context');

assert.match(src, /import \{ useMessaging \}/, 'imports useMessaging to read platform capabilities');
assert.match(
    src,
    /\{ supportsNotificationSoundPlayback = false \} = messaging \|\| \{\}/,
    'gates sound preview on the delivered-notification playback capability',
);
assert.doesNotMatch(src, /shell === ['"]web['"]/, 'does not infer sound playback from the layout shell');
assert.match(src, /\bSOUND_PREVIEW_EVENT\b/, 'imports the SOUND_PREVIEW_EVENT contract');
assert.match(
    src,
    /new CustomEvent\(SOUND_PREVIEW_EVENT,\s*\{\s*detail:\s*\{\s*soundId\s*\}\s*\}\)/,
    'Preview dispatches SOUND_PREVIEW_EVENT with the picked soundId',
);
assert.match(
    src,
    /<ListField[^>]*?label=\{t\('settings\.notifications\.sound', \{ label: family\.label \}\)\}/,
    'renders a per-family sound picker field',
);

console.log('settings-notifications smoke OK');
