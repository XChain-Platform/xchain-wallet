// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const verifier = join(root, 'tools/release/verify-wear-manifest.mjs');
const directory = mkdtempSync(join(tmpdir(), 'wear-manifest-'));
const EXPECTED_COMPONENTS = [
    { type: 'activity', name: 'com.google.android.gms.common.api.GoogleApiActivity', exported: false },
    { type: 'activity', name: 'io.xchain.wallet.android.wear.MainActivity', exported: true },
    { type: 'provider', name: 'androidx.startup.InitializationProvider', exported: false },
    { type: 'receiver', name: 'androidx.profileinstaller.ProfileInstallReceiver', exported: true },
    {
        type: 'service',
        name: 'io.xchain.wallet.android.wear.complication.WalletComplicationService',
        exported: true,
    },
    { type: 'service', name: 'io.xchain.wallet.android.wear.sync.WatchListenerService', exported: true },
    { type: 'service', name: 'io.xchain.wallet.android.wear.tile.BalanceTileService', exported: true },
];
const EXPECTED_PERMISSIONS = [
    'io.xchain.wallet.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];

const manifest = ({
    feature = '<uses-feature android:name="android.hardware.type.watch" android:required="true" />',
    standalone = 'false',
    components = EXPECTED_COMPONENTS,
    permissions = EXPECTED_PERMISSIONS,
    versionCode = '1003330150',
} = {}) => [
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android"${
        versionCode === null ? '' : ` android:versionCode="${versionCode}"`
    }>`,
    ...permissions.map((name) => `  <uses-permission android:name="${name}" />`),
    `  ${feature}`,
    '  <application>',
    `    <meta-data android:name="com.google.android.wearable.standalone" android:value="${standalone}" />`,
    ...components.map(({ type, name, exported }) => (
        `    <${type} android:name="${name}" android:exported="${exported}" />`
    )),
    '  </application>',
    '</manifest>',
].join('\n');

const run = (xml, args = []) => {
    const path = join(directory, 'AndroidManifest.xml');
    writeFileSync(path, xml);
    try {
        return { ok: true, status: 0, output: execFileSync('node', [verifier, path, ...args],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
        return {
            ok: false,
            status: error.status,
            output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        };
    }
};

const mustFail = (label, xml, pattern) => {
    const result = run(xml);
    assert.equal(result.ok, false, `${label}: verifier accepted the mutation`);
    assert.match(result.output, pattern, `${label}: verifier failed for the wrong reason`);
};

try {
    const clean = run(manifest());
    assert.equal(clean.ok, true, clean.output);
    assert.match(clean.output, /PASS feature android\.hardware\.type\.watch is required/);
    assert.match(clean.output, /PASS metadata com\.google\.android\.wearable\.standalone is "false"/);

    const matchingVersion = run(manifest(), ['--version-code', '1003330150']);
    assert.equal(matchingVersion.ok, true, matchingVersion.output);
    assert.match(matchingVersion.output, /PASS versionCode is 1003330150, which is what the tag derives/);

    const mismatchedVersion = run(manifest(), ['--version-code', '1003330151']);
    assert.equal(mismatchedVersion.ok, false, 'verifier accepted the wrong Wear versionCode');
    assert.match(mismatchedVersion.output, /versionCode is 1003330150, not the 1003330151/);

    const absentVersion = run(manifest({ versionCode: null }), ['--version-code', '1003330150']);
    assert.equal(absentVersion.ok, false, 'verifier accepted an absent Wear versionCode');
    assert.match(absentVersion.output, /versionCode is undefined, not the 1003330150/);

    const extraArgument = run(manifest(), ['--version-code', '1003330150', 'unexpected']);
    assert.equal(extraArgument.status, 2, 'a third argument must be a usage error');
    assert.match(extraArgument.output, /Usage: .*\[--version-code N\]/);

    mustFail('missing watch feature', manifest({ feature: '' }), /watch is missing/);
    mustFail('optional watch feature', manifest({
        feature: '<uses-feature android:name="android.hardware.type.watch" android:required="false" />',
    }), /required="false"/);
    mustFail('standalone watch', manifest({ standalone: 'true' }), /standalone is "true"/);

    const [first, ...remaining] = EXPECTED_COMPONENTS;
    mustFail('missing component', manifest({ components: remaining }), /expected component .* is missing/);
    mustFail('wrong export', manifest({
        components: [{ ...first, exported: !first.exported }, ...remaining],
    }), /android:exported=.*expected/);
    mustFail('implicit export', manifest().replace(' android:exported="true"', ''), /has no android:exported/);
    mustFail('extra component', manifest({
        components: [...EXPECTED_COMPONENTS, { type: 'service', name: 'example.Extra', exported: false }],
    }), /example\.Extra.*not expected/);

    mustFail('missing permission', manifest({ permissions: [] }), /expected permission .* is missing/);
    mustFail('extra permission', manifest({
        permissions: [...EXPECTED_PERMISSIONS, 'android.permission.CAMERA'],
    }), /android\.permission\.CAMERA is not expected/);

    console.log('wear-manifest-verify: 14 checks passed');
} finally {
    rmSync(directory, { recursive: true, force: true });
}
