// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const swift = readFileSync(new URL(
    'packages/mobile/ios/App/AppUITests/ScreenshotTests.swift',
    root,
), 'utf8');
const script = readFileSync(new URL('packages/mobile/scripts/screenshots.sh', root), 'utf8');

for (const [display, size] of [['Outer', '1398x2034'], ['Inner', '2007x2853']]) {
    assert.match(swift, new RegExp(`testCaptureDuo${display}Screenshots`));
    assert.match(swift, new RegExp(`duo-${display.toLowerCase()}-${size}`));
}
assert.doesNotMatch(swift, /launchArguments|launchEnvironment/);
assert.match(script, /devices=\([^\n]*"XC iPhone Duo"/);

console.log('Duo screenshots smoke OK (outer and inner sets named)');
