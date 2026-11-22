// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    EXPECTED_COMPONENTS,
    EXPECTED_PERMISSIONS,
} from '../../../tools/release/verify-wear-manifest.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const verifier = join(root, 'tools/release/verify-wear-manifest.mjs');
const directory = mkdtempSync(join(tmpdir(), 'wear-manifest-'));

const manifest = ({
    feature = '<uses-feature android:name="android.hardware.type.watch" android:required="true" />',
    standalone = 'false',
    components = EXPECTED_COMPONENTS,
    permissions = EXPECTED_PERMISSIONS,
} = {}) => [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
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

const run = (xml) => {
    const path = join(directory, 'AndroidManifest.xml');
    writeFileSync(path, xml);
    try {
        return { ok: true, output: execFileSync('node', [verifier, path], { encoding: 'utf8' }) };
    } catch (error) {
        return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
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

    console.log('wear-manifest-verify: 10 checks passed');
} finally {
    rmSync(directory, { recursive: true, force: true });
}
