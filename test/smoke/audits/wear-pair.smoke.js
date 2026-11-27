// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(
    new URL('../../../packages/mobile/scripts/wear-pair.sh', import.meta.url),
    'utf8',
);

assert.match(
    script,
    /if ! tap_content_desc 'More options'; then\n\s+adb_for "\$phone_serial" shell input keyevent KEYCODE_MENU\nfi/,
);
assert.match(script, /content-desc=\/ text=\/.*ui-dump\.js tap --text/s);
assert.match(script, /com\.google\.android\.apps\.wear\.companion/);
assert.match(script, /com\.google\.android\.wearable\.app/);
assert.match(
    script,
    /for package in com\.google\.android\.apps\.wear\.companion com\.google\.android\.wearable\.app; do/,
);
assert.match(script, /shell monkey -p "\$companion_package"/);
assert.match(script, /if \[ "\$\{1:-\}" = --stop ]; then stop_started; exit 0; fi/);
assert.match(script, /if \[ "\$\{1:-\}" = --device ]; then/);

console.log('wear-pair: 8 checks passed');
