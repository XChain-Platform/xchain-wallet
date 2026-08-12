#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-android-manifest.mjs - assert the manifest facts of a
// BUILT Android bundle (§5, §7).
//
// Usage:
//     bundletool dump manifest --bundle=app-release.aab > merged.xml
//     node tools/release/verify-android-manifest.mjs merged.xml [--version-code N]
//
// WHY THIS EXISTS AS A SHARED SCRIPT AND NOT AS CI STEPS.
//
// Every one of these assertions used to live inline in mobile.yml, and
// mobile.yml builds a bundle that is thrown away. The comment at the top of
// tools/release/android-ceremony.sh says so in its own words: "CI builds the
// same two artifacts unsigned as a health check; nothing it produces is ever
// published." The bundle that Google receives and that users install is built
// by the ceremony, on the maintainer's machine, and the ceremony verified only
// that its SIGNATURES were valid - jarsigner -verify, apksigner verify - and
// nothing whatever about what the manifest inside actually said.
//
// So the whole artifact-gate suite was pointed at the one bundle nobody ships.
// Six gates, each of them correct, none of them ever applied to a released
// artifact. The v0.335.0 upload was checked by hand in the session that made
// it, which is not a mechanism: an operator following the runbook does none of
// it, and the runbook never asked them to.
//
// The manifest is the right thing to assert here even though the two builds
// are not byte-identical (D5, reproducible builds, is post-launch). These
// facts are deterministic from source, so a divergence between the CI bundle
// and the ceremony bundle is itself a finding.
//
// The caller dumps the manifest and this script reads it, which keeps
// bundletool a concern of the two callers that already hold it - CI fetches it
// hash-pinned, the ceremony takes it by path - and keeps this script free of a
// toolchain preflight it would then owe an operator page.

import { readFileSync } from 'node:fs';

const FAILURES = [];
const args = process.argv.slice(2);

// --help answers before anything is read, so it has no side effects and cannot
// fail for a reason the reader did not ask about. A release tool is typed by an
// operator mid-ceremony, and answering the question with the tool's own failure
// vocabulary turns a question into an emergency; the gate in
// test/smoke/audits/extension-ceremony-collateral.smoke.js holds every tool in
// tools/release/ to that, and it caught this script within the hour of it
// being written.
const USAGE = `usage: verify-android-manifest.mjs <merged-manifest.xml> [--version-code N]

Asserts the manifest facts of a BUILT Android bundle (section 5, section 7):
exactly one exported component and that it is MainActivity, allowBackup and
usesCleartextTraffic both false, the exact permission set, and the App Link path
claim, which is derived from WEB_LINK_PREFIX in the SPA's parser rather than
held as a copy here. With --version-code, also that the bundle carries the
versionCode the tag derives.

The caller dumps the manifest, so bundletool stays a concern of the two callers
that already hold it:

  bundletool dump manifest --bundle=app-release.aab > merged.xml
  node tools/release/verify-android-manifest.mjs merged.xml --version-code 3360050

Run by tools/release/android-ceremony.sh before any key touches the bundle, and
by .github/workflows/mobile.yml on its unsigned build. Exit 0 if every check
passes, 1 naming each failure, 2 on a usage error.`;

if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
}

const manifestPath = args.find((a) => !a.startsWith('--'));

if (!manifestPath) {
    console.error(USAGE);
    process.exit(2);
}

const versionCodeIndex = args.indexOf('--version-code');
const expectedVersionCode = versionCodeIndex === -1 ? undefined : args[versionCodeIndex + 1];

const manifest = readFileSync(manifestPath, 'utf8');

// GitHub renders `::error::` as an annotation on the failing step; anywhere
// else it is noise, so it is added only where it means something.
const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
const fail = (what, why) => { FAILURES.push(`${annotate}${what}\n    ${why}`); };
const pass = (what) => { console.log(`  ok  ${what}`); };

// --- 1. Exactly one exported component ---------------------------------
//
// §1 allows exactly one, and the SOURCE manifest is the wrong place to prove
// it: androidx.profileinstaller merged in a second exported receiver
// transitively, which the source-level smoke could not see.
const exported = [...manifest.matchAll(/<(\w+)([^>]*android:exported="true"[^>]*)>/g)];
if (exported.length !== 1) {
    fail(`the bundle exports ${exported.length} components, not 1`,
        'Every exported component is attack surface a caller can reach without a permission, and '
        + '§1 allows exactly one. A merged-in library is the usual cause and is invisible in the source manifest.');
} else if (!/io\.xchain\.wallet\.android\.MainActivity/.test(exported[0][0])) {
    fail('the one exported component is not MainActivity',
        `it is \`${/android:name="([^"]*)"/.exec(exported[0][0])?.[1]}\`. The count being right while the `
        + 'identity is wrong is the case a count alone cannot express.');
} else {
    pass('exactly one exported component, and it is MainActivity');
}

// --- 2. Hardening that only counts if it survived the merge -------------
for (const [attr, why] of [
    ['allowBackup="false"', 'a wallet whose data is in the Android backup stream has its vault leaving the device'],
    ['usesCleartextTraffic="false"', 'cleartext permits a downgrade on any network the device joins'],
]) {
    if (manifest.includes(attr)) pass(attr);
    else fail(`the merged manifest does not carry ${attr}`, why);
}

// --- 3. The permission SET, not a count ---------------------------------
//
// §5 states the rule as a set - "camera (QR) and biometrics only; no location,
// no contacts, no background anything" - and every added permission is Play
// review surface. A count passed a swapped permission, a dropped one, and an
// added vendor permission, which is how FCM and Play Services announce
// themselves. The non-android entry is AndroidX's own signature-level
// permission for RECEIVER_NOT_EXPORTED registration, listed because it is REAL
// and merged in, not because it is wanted.
const EXPECTED_PERMISSIONS = [
    'android.permission.CAMERA',
    'android.permission.INTERNET',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'io.xchain.wallet.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];
const actualPermissions = [...new Set(
    [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]*)"/g)].map((m) => m[1]),
)].sort();
const expectedSorted = [...EXPECTED_PERMISSIONS].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedSorted)) {
    const added = actualPermissions.filter((p) => !expectedSorted.includes(p));
    const removed = expectedSorted.filter((p) => !actualPermissions.includes(p));
    fail('the merged manifest\'s permission set changed',
        `added: [${added.join(', ') || 'none'}]; removed: [${removed.join(', ') || 'none'}]. `
        + 'A permission is Play review surface and §5 pins the set, not the count.');
} else {
    pass(`permission set matches exactly (${actualPermissions.length} permissions)`);
}

// --- 4. The App Link claim ----------------------------------------------
//
// assetlinks.json carries no paths, so this one attribute is the ENTIRE
// Android-side scope of the claim. A drift smoke pins the source
// across both repos and is the right gate for the rule; it cannot see a
// library merging in a claim of its own, and it never ran against an artifact.
//
// A claim WIDER than the parser means the OS takes the URL away from the
// browser and hands it to an app that discards it: the wallet surfaces on its
// default view, the page never loads, and nothing reports an error. That
// happened exactly this way: the claim read `/wallet` and swallowed
// `https://xchain.io/wallet/privacy/` and `/wallet/support/`, the privacy and
// support URLs the Play and App Store listings publish themselves, so anyone
// with the wallet installed who tapped Privacy Policy from the store listing
// got the app instead of the policy. That bundle passed every other gate here.
//
// Derived, never retyped: the expected range is read out of the parser, which
// is the range the SPA will actually act on, so this cannot drift away from
// the rule it enforces the way a pasted literal would.
//
// Stated limit: this checks WHICH PATHS the bundle claims, not that the claim
// verifies against the live assetlinks.json. Only a signed build on a device
// settles that, and §6 Phase 6 is where it is settled.
const parserSource = readFileSync(
    new URL('../../packages/core/src/uri/xchainUri.js', import.meta.url), 'utf8',
);
const parserPrefix = /const WEB_LINK_PREFIX = '([^']+)'/.exec(parserSource)?.[1];
if (!parserPrefix) {
    fail('WEB_LINK_PREFIX was not found in packages/core/src/uri/xchainUri.js',
        'This script derives the expected claim from the parser rather than holding a copy of it. '
        + 'If the constant moved or was renamed, point this at the new one - do not paste a literal back in.');
} else {
    const dataElements = [...manifest.matchAll(/<data\b[^>]*\/>/g)].map((m) => m[0])
        .filter((el) => el.includes('android:scheme="https"') && el.includes('android:host="xchain.io"'));

    if (dataElements.length === 0) {
        fail('the bundle claims no https App Link on xchain.io at all',
            'Every printed https://xchain.io' + parserPrefix + ' URL stays in the browser and the app '
            + 'is never offered, so §6 Phase 6 has nothing to verify.');
    } else if (dataElements.some((el) => !el.includes('android:pathPrefix="'))) {
        fail('an https App Link data element on xchain.io declares NO pathPrefix',
            'That claims every URL on the domain - the marketing site, the docs, and both store '
            + 'listings\' own privacy and support URLs. A diff of prefixes would never see it.');
    } else {
        const claimed = [...new Set(
            dataElements.map((el) => /android:pathPrefix="([^"]*)"/.exec(el)[1]),
        )].sort();
        if (claimed.length !== 1 || claimed[0] !== parserPrefix) {
            fail(`the bundle claims [${claimed.join(', ')}] and the parser acts on ${parserPrefix}`,
                'Wider means the OS hands the app URLs it drops and the page never loads; narrower '
                + 'means the SPA waits for links the OS never delivers. Both read as "deep links are '
                + 'broken" with every source file correct.');
        } else if (!manifest.includes('android:autoVerify="true"')) {
            // Guards the check above: a claim outside an autoVerify filter is
            // never verified, so it carries the right paths and does nothing.
            fail('the bundle claims the right paths and no filter sets autoVerify',
                'Android never checks assetlinks.json and never grants the link, so every path '
                + 'assertion above passes and the app is offered in a chooser at best.');
        } else {
            pass(`App Link claim is exactly the parser's range (${parserPrefix}), and it autoVerifies`);
        }
    }
}

// --- 5. The versionCode, when the caller knows which one to expect ------
//
// Play accepts a versionCode exactly once, so a bundle carrying the wrong one
// burns an integer that cannot be reused and costs a whole new tag.
if (expectedVersionCode !== undefined) {
    const actual = /android:versionCode="([^"]*)"/.exec(manifest)?.[1];
    if (actual !== expectedVersionCode) {
        fail(`the bundle's versionCode is ${actual}, not the ${expectedVersionCode} the tag derives`,
            'Play accepts a versionCode exactly once. Uploading the wrong one spends an integer '
            + 'permanently and the correction costs a new tag.');
    } else {
        pass(`versionCode is ${actual}, which is what the tag derives`);
    }
}

if (FAILURES.length > 0) {
    console.error(`\n${FAILURES.length} manifest check(s) failed on ${manifestPath}:\n`);
    for (const f of FAILURES) console.error(`  ${f}\n`);
    process.exit(1);
}

console.log(`\nall manifest checks passed on ${manifestPath}`);
