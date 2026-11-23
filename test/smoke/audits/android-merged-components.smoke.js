// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.XCHAIN_NATIVE_SMOKES) {
    console.log('android merged components: skipped (set XCHAIN_NATIVE_SMOKES=1)');
    process.exit(0);
}

if (process.platform !== 'darwin') {
    console.error('android merged components: XCHAIN_NATIVE_SMOKES requires darwin');
    process.exit(1);
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const android = join(root, 'packages/mobile/android');
const verifierPermissions = [...readFileSync(
    join(root, 'tools/release/verify-android-manifest.mjs'), 'utf8',
).matchAll(/^ {4}'([\w.]+)',$/gm)].map((match) => match[1]).sort();
const expected = {
    app: {
        components: [
            'activity:com.google.android.gms.common.api.GoogleApiActivity:exported=false',
            'activity:io.xchain.wallet.android.MainActivity:exported=true',
            'provider:androidx.core.content.FileProvider:exported=false',
            'provider:androidx.startup.InitializationProvider:exported=false',
            'receiver:androidx.work.impl.background.systemalarm.RescheduleReceiver:exported=false',
            'receiver:androidx.work.impl.utils.ForceStopRunnable$BroadcastReceiver:exported=false',
            'service:androidx.room.MultiInstanceInvalidationService:exported=false',
            'service:androidx.work.impl.background.systemjob.SystemJobService:exported=false',
            'service:androidx.work.impl.foreground.SystemForegroundService:exported=false',
        ],
        permissions: [
            'android.permission.ACCESS_NETWORK_STATE',
            'android.permission.CAMERA',
            'android.permission.FOREGROUND_SERVICE',
            'android.permission.INTERNET',
            'android.permission.POST_NOTIFICATIONS',
            'android.permission.RECEIVE_BOOT_COMPLETED',
            'android.permission.USE_BIOMETRIC',
            'android.permission.USE_FINGERPRINT',
            'android.permission.VIBRATE',
            'android.permission.WAKE_LOCK',
            'io.xchain.wallet.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
        ],
    },
    wear: {
        components: [
            'activity:com.google.android.gms.common.api.GoogleApiActivity:exported=false',
            'activity:io.xchain.wallet.android.wear.MainActivity:exported=true',
            'provider:androidx.startup.InitializationProvider:exported=false',
            'receiver:androidx.profileinstaller.ProfileInstallReceiver:exported=true',
            'service:io.xchain.wallet.android.wear.complication.WalletComplicationService:exported=true',
            'service:io.xchain.wallet.android.wear.sync.WatchListenerService:exported=true',
            'service:io.xchain.wallet.android.wear.tile.BalanceTileService:exported=true',
        ],
        permissions: [
            'io.xchain.wallet.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
        ],
    },
};
assert.deepEqual(expected.app.permissions, verifierPermissions,
    ':app merged permission pin must equal the release verifier set');

execFileSync('bash', [
    join(root, 'packages/mobile/scripts/watch-test.sh'),
    'gradle',
    ':app:processReleaseMainManifest',
    ':wear:processReleaseMainManifest',
], { cwd: root, stdio: 'inherit', timeout: 20 * 60 * 1000 });

const attribute = (attributes, name) => {
    const value = new RegExp(`\\bandroid:${name}\\s*=\\s*"([^"]*)"`).exec(attributes)?.[1];
    assert.notEqual(value, undefined, `merged manifest entry is missing android:${name}`);
    return value;
};

const inspect = (module) => {
    const manifest = join(android, module, 'build/intermediates/merged_manifest/release',
        'processReleaseMainManifest/AndroidManifest.xml');
    const xml = readFileSync(manifest, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const application = /<application\b[^>]*>([\s\S]*?)<\/application>/.exec(xml)?.[1];
    assert.notEqual(application, undefined, `:${module} merged manifest has no application`);
    const components = [...application.matchAll(/<(activity|activity-alias|service|receiver|provider)\b([^>]*)>/g)]
        .map((match) => `${match[1]}:${attribute(match[2], 'name')}:exported=${attribute(match[2], 'exported')}`)
        .sort();
    const permissions = [...xml.matchAll(/<uses-permission(?:-sdk-\d+)?\b([^>]*)>/g)]
        .map((match) => attribute(match[1], 'name'))
        .sort();

    console.log(`\n:${module} merged components`);
    for (const component of components) console.log(`  ${component}`);
    console.log(`:${module} merged permissions`);
    for (const permission of permissions) console.log(`  ${permission}`);

    assert.deepEqual(components, expected[module].components, `:${module} merged components changed`);
    assert.deepEqual(permissions, expected[module].permissions, `:${module} merged permissions changed`);
};

inspect('app');
inspect('wear');
console.log('\nandroid merged components: all checks passed');
