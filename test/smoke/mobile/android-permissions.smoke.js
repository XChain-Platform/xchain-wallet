// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL(
    '../../../packages/mobile/android/app/src/main/AndroidManifest.xml',
    import.meta.url,
));
const manifest = readFileSync(manifestPath, 'utf8');
const declaredPermissions = [...manifest.matchAll(
    /<uses-permission\b[^>]*\bandroid:name="([^"]+)"[^>]*>/g,
)].map((match) => match[1]).sort();

const permissionSnapshot = [
    'android.permission.CAMERA',
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'android.permission.VIBRATE',
];

assert.deepEqual(
    declaredPermissions,
    permissionSnapshot,
    'Android manifest permissions changed. Review every addition as store and runtime permission surface.',
);

console.log(`android permissions smoke OK (${declaredPermissions.length} permissions)`);
