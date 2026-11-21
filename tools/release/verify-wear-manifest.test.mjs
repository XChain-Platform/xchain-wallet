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

import {
    listComponents,
    listPermissions,
    metaData,
    usesFeatures,
} from './verify-wear-manifest.mjs';

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-permission
      android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-feature android:name="android.hardware.type.watch" />
  <uses-feature
      android:name="android.hardware.camera"
      android:required="false" />
  <application>
    <activity android:name=".MainActivity" android:exported="true" />
    <activity-alias
        android:name=".LauncherAlias"
        android:exported="false">
    </activity-alias>
    <service android:name=".SyncService"></service>
    <receiver
        android:name=".BootReceiver"
        android:exported="false" />
    <provider android:name=".DataProvider" android:exported="true" />
    <meta-data android:name="standalone" android:value="false" />
    <meta-data
        android:name="com.example.mode"
        android:value="wear" />
  </application>
</manifest>`;

test('reads every component and preserves exported state', () => {
    assert.deepEqual(listComponents(manifest), [
        { type: 'activity', name: '.MainActivity', exported: true },
        { type: 'activity-alias', name: '.LauncherAlias', exported: false },
        { type: 'service', name: '.SyncService', exported: 'absent' },
        { type: 'receiver', name: '.BootReceiver', exported: false },
        { type: 'provider', name: '.DataProvider', exported: true },
    ]);
});

test('reads sorted unique permissions', () => {
    assert.deepEqual(listPermissions(manifest), [
        'android.permission.INTERNET',
        'android.permission.VIBRATE',
    ]);
});

test('reads features with required defaulting to true', () => {
    assert.deepEqual(usesFeatures(manifest), [
        { name: 'android.hardware.type.watch', required: true },
        { name: 'android.hardware.camera', required: false },
    ]);
});

test('reads metadata as name to value entries', () => {
    assert.deepEqual(metaData(manifest), {
        standalone: 'false',
        'com.example.mode': 'wear',
    });
});
