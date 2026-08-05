// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-android-manifest.mjs, shown broken bundles.
//
// The script this file exercises is the only thing that ever looks inside the
// Android bundle that actually ships. Until the artifact gates lived
// inline in mobile.yml, which builds a bundle that is thrown away, while the
// ceremony that builds the released one checked its SIGNATURES and nothing
// about its contents. A guard that has never been shown a broken artifact is
// not known to work, and this one guards the last look at the bytes before
// they reach Google.
//
// THE FIXTURE IS DERIVED FROM THE CONTRACT, NOT TYPED BESIDE IT. The permission
// set is read out of the verifier and the claimed path out of the parser, so a
// change to either moves the fixture with it. A hand-written fixture is how a
// guard ends up proving that last year's rules still hold.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const VERIFIER = join(root, 'tools/release/verify-android-manifest.mjs');

const verifierSource = readFileSync(VERIFIER, 'utf8');
const parserSource = readFileSync(join(root, 'packages/core/src/uri/xchainUri.js'), 'utf8');

// --- the contract, read rather than restated ---------------------------
const PERMISSIONS = [...verifierSource.matchAll(/^ {4}'([\w.]+)',$/gm)].map((m) => m[1]);
assert.ok(
    PERMISSIONS.length >= 5 && PERMISSIONS.includes('android.permission.CAMERA'),
    `read ${PERMISSIONS.length} permissions out of the verifier, which is not the declared set. `
    + 'The extraction broke, so every mutation below would "fail" for the wrong reason.',
);

const PREFIX = /const WEB_LINK_PREFIX = '([^']+)'/.exec(parserSource)?.[1];
assert.ok(PREFIX, 'WEB_LINK_PREFIX not found in the parser, so the claim fixture cannot be derived');

const VERSION_CODE = '3350050';

// A minimal merged manifest in bundletool's own shape: attributes alphabetised,
// which is NOT the order the source manifest writes them in - a regex copied
// from the source-level smoke would not match this at all.
const buildManifest = (over = {}) => {
    const {
        permissions = PERMISSIONS,
        prefix = PREFIX,
        autoVerify = true,
        exportedExtra = false,
        activityName = 'io.xchain.wallet.android.MainActivity',
        appAttrs = 'android:allowBackup="false" android:usesCleartextTraffic="false"',
        dataElements = null,
        versionCode = VERSION_CODE,
    } = over;
    const data = dataElements ?? [
        `<data android:host="xchain.io" android:pathPrefix="${prefix}" android:scheme="https"/>`,
    ];
    return [
        `<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionCode="${versionCode}"`
        + ' android:versionName="0.335.0" package="io.xchain.wallet.android">',
        ...permissions.map((p) => `  <uses-permission android:name="${p}"/>`),
        `  <application ${appAttrs}>`,
        `    <activity android:exported="true" android:name="${activityName}">`,
        `      <intent-filter${autoVerify ? ' android:autoVerify="true"' : ''}>`,
        '        <action android:name="android.intent.action.VIEW"/>',
        '        <category android:name="android.intent.category.BROWSABLE"/>',
        ...data.map((d) => `        ${d}`),
        '      </intent-filter>',
        '    </activity>',
        exportedExtra
            ? '    <receiver android:exported="true" android:name="androidx.profileinstaller.ProfileInstallReceiver"/>'
            : '',
        '  </application>',
        '</manifest>',
    ].filter(Boolean).join('\n');
};

const dir = mkdtempSync(join(tmpdir(), 'xc-manifest-'));
let failures = 0;

const run = (xml, extraArgs = []) => {
    const path = join(dir, 'merged.xml');
    writeFileSync(path, xml);
    try {
        execFileSync('node', [VERIFIER, path, ...extraArgs], { encoding: 'utf8', stdio: 'pipe' });
        return { ok: true, out: '' };
    } catch (e) {
        return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
};

const mustPass = (what, xml, extraArgs = []) => {
    const r = run(xml, extraArgs);
    if (r.ok) { console.log(`  ok   ${what}`); return; }
    failures += 1;
    console.error(`  FAIL ${what} - the verifier refused a bundle that is correct:\n${r.out}`);
};

const mustFail = (what, xml, expect, extraArgs = []) => {
    const r = run(xml, extraArgs);
    if (!r.ok && expect.test(r.out)) { console.log(`  ok   ${what}`); return; }
    failures += 1;
    console.error(r.ok
        ? `  FAIL ${what} - the verifier ACCEPTED it`
        : `  FAIL ${what} - refused, but not for the stated reason:\n${r.out}`);
};

// The load-bearing case. Every mutation below is only evidence if the
// unmutated fixture is accepted; otherwise they all "fail" for free.
mustPass('a correct bundle is accepted', buildManifest());
mustPass('a correct bundle with its versionCode is accepted',
    buildManifest(), ['--version-code', VERSION_CODE]);

// --- the App Link claim, which is why this script exists ---------------
mustFail('the claim, exactly as it shipped: /wallet swallows the listing URLs',
    buildManifest({ prefix: '/wallet' }), /claims \[\/wallet\].*parser acts on/s);
mustFail('a claim NARROWER than the parser',
    buildManifest({ prefix: '/wallet/link/v1/' }), /parser acts on/);
mustFail('no https App Link claim at all',
    buildManifest({ dataElements: ['<data android:scheme="xchain"/>'] }), /claims no https App Link/);
mustFail('a host claimed with no pathPrefix, which takes the whole domain',
    buildManifest({ dataElements: ['<data android:host="xchain.io" android:scheme="https"/>'] }),
    /declares NO pathPrefix/);
mustFail('a second claim merged in beside the correct one',
    buildManifest({ dataElements: [
        `<data android:host="xchain.io" android:pathPrefix="${PREFIX}" android:scheme="https"/>`,
        '<data android:host="xchain.io" android:pathPrefix="/pay/" android:scheme="https"/>',
    ] }), /claims \[.*\/pay\/.*\]/);
mustFail('the right paths with autoVerify dropped, so nothing is ever verified',
    buildManifest({ autoVerify: false }), /no filter sets autoVerify/);

// Derivation, not a literal: move the parser and the claim together and the
// verifier must follow. This is what stops the script becoming a second copy
// of the rule that drifts from the first.
mustPass('a claim that moved WITH the parser is accepted',
    buildManifest({ prefix: PREFIX }));

// --- the gates that were already in CI, now that they run on the ship --
mustFail('a second exported component merged in transitively',
    buildManifest({ exportedExtra: true }), /exports 2 components/);
mustFail('the one exported component is not MainActivity',
    buildManifest({ activityName: 'io.xchain.wallet.android.SomeOtherActivity' }),
    /not MainActivity/);
mustFail('allowBackup flipped, putting the vault in the backup stream',
    buildManifest({ appAttrs: 'android:allowBackup="true" android:usesCleartextTraffic="false"' }),
    /allowBackup="false"/);
mustFail('cleartext traffic permitted',
    buildManifest({ appAttrs: 'android:allowBackup="false" android:usesCleartextTraffic="true"' }),
    /usesCleartextTraffic="false"/);
mustFail('a permission SWAPPED, which a count cannot see',
    buildManifest({ permissions: PERMISSIONS.map(
        (p) => (p === 'android.permission.CAMERA' ? 'android.permission.ACCESS_FINE_LOCATION' : p),
    ) }), /added: \[android\.permission\.ACCESS_FINE_LOCATION\]/);
mustFail('a vendor permission added, which is how FCM announces itself',
    buildManifest({ permissions: [...PERMISSIONS, 'com.google.android.c2dm.permission.RECEIVE'] }),
    /added: \[com\.google\.android\.c2dm\.permission\.RECEIVE\]/);
mustFail('a permission dropped, which only moves a count DOWN',
    buildManifest({ permissions: PERMISSIONS.filter((p) => p !== 'android.permission.USE_FINGERPRINT') }),
    /removed: \[android\.permission\.USE_FINGERPRINT\]/);
mustFail('a versionCode that is not the one the tag derives',
    buildManifest({ versionCode: '3340050' }), /versionCode is 3340050/,
    ['--version-code', VERSION_CODE]);

rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nandroid-manifest-verify: all checks passed');
