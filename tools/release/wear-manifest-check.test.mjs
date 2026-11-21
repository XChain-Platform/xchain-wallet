// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkWearManifest } from './verify-wear-manifest.mjs';

const expected = {
    components: [
        { type: 'activity', name: '.MainActivity', exported: false },
        { type: 'service', name: '.SyncService', exported: true },
    ],
    permissions: [
        'android.permission.INTERNET',
        'android.permission.VIBRATE',
    ],
};

const cleanManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-feature android:name="android.hardware.type.watch" android:required="true" />
  <application>
    <activity
        android:name=".MainActivity"
        android:exported="false" />
    <service android:name=".SyncService" android:exported="true" />
    <meta-data android:name="com.google.android.wearable.standalone" android:value="false" />
  </application>
</manifest>`;

function failuresFor(xml, expectations = expected) {
    return checkWearManifest(xml, expectations).failures;
}

test('accepts a clean Wear manifest', () => {
    const result = checkWearManifest(cleanManifest, expected);

    assert.deepEqual(result.failures, []);
    assert.ok(result.passes.length > 0);
    assert.ok(result.passes.every((entry) => typeof entry === 'string'));
});

test('rejects a missing watch feature', () => {
    const xml = cleanManifest.replace(
        '  <uses-feature android:name="android.hardware.type.watch" android:required="true" />\n',
        '',
    );

    assert.deepEqual(failuresFor(xml), [
        'feature android.hardware.type.watch is missing',
    ]);
});

test('rejects a watch feature that is not required', () => {
    const xml = cleanManifest.replace('android:required="true"', 'android:required="false"');

    assert.deepEqual(failuresFor(xml), [
        'feature android.hardware.type.watch has android:required="false"',
    ]);
});

test('rejects standalone metadata whose value is not exactly false', () => {
    const xml = cleanManifest.replace(
        'android:name="com.google.android.wearable.standalone" android:value="false"',
        'android:name="com.google.android.wearable.standalone" android:value="true"',
    );

    assert.deepEqual(failuresFor(xml), [
        'metadata com.google.android.wearable.standalone is "true", not "false"',
    ]);
});

test('rejects a component without an exported value', () => {
    const xml = cleanManifest.replace(' android:exported="true"', '');
    const expectations = {
        ...expected,
        components: [
            expected.components[0],
            { type: 'service', name: '.SyncService', exported: 'absent' },
        ],
    };

    assert.deepEqual(failuresFor(xml, expectations), [
        'component service ".SyncService" has no android:exported value',
    ]);
});

test('rejects a missing expected component', () => {
    const xml = cleanManifest.replace(
        '    <service android:name=".SyncService" android:exported="true" />\n',
        '',
    );

    assert.deepEqual(failuresFor(xml), [
        'expected component service ".SyncService" is missing',
    ]);
});

test('rejects an expected component with the wrong exported value', () => {
    const xml = cleanManifest.replace('android:exported="true"', 'android:exported="false"');

    assert.deepEqual(failuresFor(xml), [
        'component service ".SyncService" has android:exported=false, expected true',
    ]);
});

test('rejects a component outside the expected set', () => {
    const xml = cleanManifest.replace(
        '  </application>',
        '    <receiver android:name=".BootReceiver" android:exported="false" />\n  </application>',
    );

    assert.deepEqual(failuresFor(xml), [
        'component receiver ".BootReceiver" is not expected',
    ]);
});

test('rejects a missing expected permission', () => {
    const xml = cleanManifest.replace(
        '  <uses-permission android:name="android.permission.VIBRATE" />\n',
        '',
    );

    assert.deepEqual(failuresFor(xml), [
        'expected permission android.permission.VIBRATE is missing',
    ]);
});

test('rejects a permission outside the expected set', () => {
    const xml = cleanManifest.replace(
        '  <uses-permission android:name="android.permission.INTERNET" />',
        '  <uses-permission android:name="android.permission.INTERNET" />\n'
        + '  <uses-permission android:name="android.permission.CAMERA" />',
    );

    assert.deepEqual(failuresFor(xml), [
        'permission android.permission.CAMERA is not expected',
    ]);
});
