// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/verify-ios-artifact.mjs, shown broken artifacts.
//
// The script this file exercises is the only thing that ever looks inside the
// iOS artifact the ceremony builds. Before it, ios-archive.sh and ios-export.sh
// asserted that a directory of the right name existed and nothing else, and
// release.yml's mobile-ios job has never run once, so no fact about a built iOS
// artifact had ever been asserted anywhere. A guard that has never been shown a
// broken artifact is not known to work.
//
// THE FIXTURE IS DERIVED FROM THE CONTRACT, NOT TYPED BESIDE IT. Every value in
// the baseline artifact comes out of readExpectations, which reads the pbxproj,
// the URI parser and the source plists, so a change to any of them moves the
// fixture with it. A hand-written fixture is how a guard ends up proving that
// last year's rules still hold.
//
// The mutations drive runChecks directly rather than the CLI, because the
// plists of a real artifact are binary and only a Mac can read them, while the
// rules they are read for are not macOS-specific. The CLI's own extraction path
// is covered separately below, on darwin, against a synthesised bundle - and
// against a REAL archive and ipa when `XCHAIN_IOS_ARTIFACT_DIR` names a build
// directory holding them.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const VERIFIER = join(root, 'tools/release/verify-ios-artifact.mjs');

const { readExpectations, runChecks } = await import(VERIFIER);

const repoExpectations = readExpectations(root);

// The one fact readExpectations cannot supply on a checkout where sync:ios has
// not run: Version.xcconfig is generated and git-ignored. Pinned here so the
// suite behaves the same on a fresh clone and on a machine mid-release.
const MARKETING = '0.336.0';
const BUILD = '3360050';
const expected = { ...repoExpectations, marketingVersion: MARKETING, buildNumber: BUILD };

assert.equal(expected.bundleId, 'io.xchain.wallet.ios',
    'the pbxproj bundle id did not come back; every check below would then compare undefined');
assert.deepEqual(expected.associatedDomains, ['applinks:xchain.io'],
    'App.entitlements did not yield the associated-domains claim, so the link fixtures are meaningless');
assert.ok(expected.usageDescriptionKeys.includes('NSCameraUsageDescription'),
    'the source Info.plist did not yield its usage descriptions');

const APPLINK = `applinks:${expected.applinksHost}`;

const buildInfo = (over = {}) => ({
    CFBundleIdentifier: expected.bundleId,
    CFBundleShortVersionString: MARKETING,
    CFBundleVersion: BUILD,
    ITSAppUsesNonExemptEncryption: false,
    CAPACITOR_DEBUG: '',
    CFBundleURLTypes: [{ CFBundleTypeRole: 'Viewer', CFBundleURLSchemes: [...expected.urlSchemes] }],
    ...Object.fromEntries(expected.usageDescriptionKeys.map((k) => [k, 'why the wallet asks'])),
    ...over,
});

const buildEntitlements = (over = {}) => ({
    'application-identifier': `829JG9YLH3.${expected.bundleId}`,
    'com.apple.developer.team-identifier': '829JG9YLH3',
    'com.apple.developer.associated-domains': [APPLINK],
    'get-task-allow': false,
    ...over,
});

const buildProfile = (over = {}) => ({
    Name: 'iOS Team Store Provisioning Profile: io.xchain.wallet.ios',
    Entitlements: { 'get-task-allow': false },
    ...over,
});

let failures = 0;

const run = (over = {}) => runChecks({
    info: buildInfo(),
    entitlements: buildEntitlements(),
    profile: buildProfile(),
    stage: 'export',
    expected,
    taggedVersion: MARKETING,
    taggedBuild: BUILD,
    ...over,
});

const mustPass = (what, over) => {
    const { failures: got } = run(over);
    if (got.length === 0) { console.log(`  ok   ${what}`); return; }
    failures += 1;
    console.error(`  FAIL ${what} - the verifier refused an artifact that is correct:\n    ${got.join('\n    ')}`);
};

const mustFail = (what, over, expectRe) => {
    const { failures: got } = run(over);
    const text = got.join('\n');
    if (got.length > 0 && expectRe.test(text)) { console.log(`  ok   ${what}`); return; }
    failures += 1;
    console.error(got.length === 0
        ? `  FAIL ${what} - the verifier ACCEPTED it`
        : `  FAIL ${what} - refused, but not for the stated reason:\n    ${text}`);
};

// The load-bearing cases. Every mutation below is only evidence if the
// unmutated fixture is accepted at both stages; otherwise they all "fail" free.
mustPass('a correct ipa is accepted at the export stage', {});
mustPass('a correct archive is accepted at the archive stage', { stage: 'archive', profile: undefined });
mustPass('an archive with no profile and no tag is accepted',
    { stage: 'archive', profile: undefined, taggedVersion: undefined, taggedBuild: undefined });

// The Universal Link claim, which is the twin of the failure that
// answered on Android.
mustFail('the claim names a host the parser never unwraps',
    { entitlements: buildEntitlements({ 'com.apple.developer.associated-domains': ['applinks:xchain.example'] }) },
    /App\.entitlements asks for/);
mustFail('a wildcard claim, which takes every subdomain',
    { entitlements: buildEntitlements({ 'com.apple.developer.associated-domains': [`applinks:*.${expected.applinksHost}`] }) },
    /App\.entitlements asks for/);
mustFail('no associated-domains entitlement at all in a signed build',
    { entitlements: buildEntitlements({ 'com.apple.developer.associated-domains': undefined }) },
    /claims no associated domains at all/);
mustFail('an empty associated-domains array',
    { entitlements: buildEntitlements({ 'com.apple.developer.associated-domains': [] }) },
    /claims no associated domains at all/);
mustFail('webcredentials smuggled in beside applinks, which is password autofill',
    { entitlements: buildEntitlements({
        'com.apple.developer.associated-domains': [APPLINK, `webcredentials:${expected.applinksHost}`],
    }) },
    /App\.entitlements asks for/);

// Capability creep: cloud signing grants whatever the App ID record has
// enabled, so this arrives with no commit anywhere in the repo.
mustFail('a capability the portal enabled and App.entitlements never requests',
    { entitlements: buildEntitlements({ 'com.apple.developer.icloud-services': ['CloudKit'] }) },
    /capabilities App\.entitlements never requests/);
assert.ok(
    run({}).passes.some((p) => /no capability beyond what App\.entitlements requests/.test(p)),
    'com.apple.developer.team-identifier is added by every signature and appears in no source file, '
    + 'so it must not read as capability creep or the check fires on every correct build',
);

// Distribution posture, which only the export stage can see.
mustFail('an ipa signed with get-task-allow, so the wallet is debuggable',
    { entitlements: buildEntitlements({ 'get-task-allow': true }) },
    /signed with get-task-allow/);
mustFail('a DEVELOPMENT provisioning profile, which installs on a device list and nowhere else',
    { profile: buildProfile({ ProvisionedDevices: ['00008030-000000000000000E'] }) },
    /DEVELOPMENT profile \(1 provisioned devices\)/);
mustFail('a profile that itself grants get-task-allow',
    { profile: buildProfile({ Entitlements: { 'get-task-allow': true } }) },
    /profile itself grants get-task-allow/);
mustFail('an ipa carrying no provisioning profile',
    { profile: undefined }, /no embedded\.mobileprovision/);
mustFail('an unsigned bundle reaching the export stage',
    { entitlements: undefined }, /carries no entitlements at all/);
mustFail('an unsigned archive that did not declare itself unsigned',
    { stage: 'archive', profile: undefined, entitlements: undefined },
    /carries no entitlements at all/);
mustPass('an unsigned archive the caller declared unsigned',
    { stage: 'archive', profile: undefined, entitlements: undefined, unsigned: true });
mustFail('the unsigned declaration does not excuse an unsigned EXPORT',
    { entitlements: undefined, unsigned: true }, /carries no entitlements at all/);

// Identity and the version pair.
mustFail('a bundle id that is not the one the project builds',
    { info: buildInfo({ CFBundleIdentifier: 'io.xchain.wallet.ios.uitests' }) },
    /bundle id is io\.xchain\.wallet\.ios\.uitests/);
mustFail('a signature issued for a different app id than the bundle carries',
    { entitlements: buildEntitlements({ 'application-identifier': '829JG9YLH3.io.xchain.other' }) },
    /does not end with \.io\.xchain\.wallet\.ios/);
mustFail('a marketing version that is not what Version.xcconfig pins',
    { info: buildInfo({ CFBundleShortVersionString: '0.335.0' }) },
    /CFBundleShortVersionString is 0\.335\.0/);
mustFail('a build number that is not what Version.xcconfig pins',
    { info: buildInfo({ CFBundleVersion: '3350050' }) }, /CFBundleVersion is 3350050/);
// The case the artifact alone cannot show: an internally consistent build
// carrying a previous release's numbers, exported under today's tag.
mustFail('a stale Version.xcconfig that the artifact agrees with',
    { taggedVersion: '0.337.0', taggedBuild: '3370050' },
    /marketing version is 0\.336\.0 and the tag derives 0\.337\.0/);
mustFail('a build with no Version.xcconfig behind it at all',
    { expected: { ...expected, marketingVersion: undefined, buildNumber: undefined } },
    /Version\.xcconfig was missing/);

// Transport security, the twin of usesCleartextTraffic="false".
for (const [key, label] of [
    ['NSAllowsArbitraryLoads', 'a blanket ATS exception'],
    ['NSAllowsArbitraryLoadsInWebContent', 'an ATS exception for web content, which is the whole wallet'],
]) {
    mustFail(label, { info: buildInfo({ NSAppTransportSecurity: { [key]: true } }) },
        new RegExp(`Transport Security is disabled.*${key}`, 's'));
}
mustPass('an ATS dictionary that turns nothing off',
    { info: buildInfo({ NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } }) });

// The permission-prompt SET, not a count.
mustFail('a usage description added, which is how a merged-in plugin announces itself',
    { info: buildInfo({ NSLocationWhenInUseUsageDescription: 'nearby peers' }) },
    /added: \[NSLocationWhenInUseUsageDescription\]/);
mustFail('a usage description SWAPPED, which a count cannot see',
    { info: (() => {
        const i = buildInfo();
        delete i.NSCameraUsageDescription;
        i.NSContactsUsageDescription = 'address book';
        return i;
    })() },
    /added: \[NSContactsUsageDescription\].*removed: \[NSCameraUsageDescription\]/s);
mustFail('a usage description dropped, so iOS refuses to show the prompt',
    { info: (() => { const i = buildInfo(); delete i.NSFaceIDUsageDescription; return i; })() },
    /removed: \[NSFaceIDUsageDescription\]/);
mustFail('a usage description present but blank',
    { info: buildInfo({ NSCameraUsageDescription: '   ' }) }, /has an empty string/);

// URL schemes, each of which is an inbound untrusted channel.
mustFail('a second URL scheme merged in',
    { info: buildInfo({ CFBundleURLTypes: [
        { CFBundleURLSchemes: [...expected.urlSchemes] },
        { CFBundleURLSchemes: ['xchainwallet'] },
    ] }) },
    /claims URL schemes \[.*xchainwallet.*\]/);
mustFail('the scheme dropped, so every printed xchain: URI stops resolving',
    { info: buildInfo({ CFBundleURLTypes: [] }) }, /claims URL schemes \[\]/);

// The web inspector, which no source diff can show reaching a Release build.
mustFail('CAPACITOR_DEBUG leaked into the shipped build',
    { info: buildInfo({ CAPACITOR_DEBUG: 'true' }) }, /carries CAPACITOR_DEBUG/);
mustPass('CAPACITOR_DEBUG absent entirely',
    { info: (() => { const i = buildInfo(); delete i.CAPACITOR_DEBUG; return i; })() });

// Export compliance, which stops an upload dead rather than shipping a defect.
mustFail('ITSAppUsesNonExemptEncryption missing',
    { info: (() => { const i = buildInfo(); delete i.ITSAppUsesNonExemptEncryption; return i; })() },
    /ITSAppUsesNonExemptEncryption is undefined/);
mustFail('ITSAppUsesNonExemptEncryption declared true',
    { info: buildInfo({ ITSAppUsesNonExemptEncryption: true }) },
    /ITSAppUsesNonExemptEncryption is true/);

// A stage the caller never set is a programming error, not a soft pass: a
// verifier that quietly checks nothing is worse than one that is not called.
assert.throws(() => runChecks({ info: buildInfo(), expected, stage: 'both' }), /stage must be/,
    'an unknown stage must throw rather than skip the stage-gated checks');

// The ceremony's own wiring, and the ORDER of it. A gate that runs after the
// step it is meant to prevent is a green tick over nothing, which is the shape
// found on Android: six correct checks pointed at the one bundle
// nobody ships. Position is asserted rather than presence for the same reason.
{
    const archiveSh = readFileSync(join(root, 'tools/release/ios-archive.sh'), 'utf8');
    const exportSh = readFileSync(join(root, 'tools/release/ios-export.sh'), 'utf8');
    const at = (src, needle) => src.indexOf(needle);
    // indexOf returns -1 for absent, and -1 is "before" everything, so an
    // ordering test written as a bare comparison passes loudest when the thing
    // it is ordering has been deleted.
    const before = (src, first, second) => at(src, first) >= 0 && at(src, second) >= 0
        && at(src, first) < at(src, second);

    const structural = [
        ['ios-archive.sh runs the verifier on what it built',
            at(archiveSh, 'verify-ios-artifact.mjs') > at(archiveSh, 'xcodebuild archive')],
        ['ios-archive.sh passes --unsigned only from the unsigned lane',
            /verify_args\+=\(--unsigned\)/.test(archiveSh)],
        ['ios-export.sh checks the archive BEFORE the API key is written to disk',
            before(exportSh, 'verify-ios-artifact.mjs', 'umask 077')],
        ['ios-export.sh checks the archive BEFORE exporting it',
            before(exportSh, 'verify-ios-artifact.mjs', 'xcodebuild -exportArchive')],
        ['ios-export.sh checks the exported ipa too',
            exportSh.split('verify-ios-artifact.mjs').length === 3],
        ['ios-export.sh checks the ipa under its final name',
            at(exportSh, '--stage export') > at(exportSh, 'mv "$exported" "$target"')],
        ['a rejected ipa is moved out of the declared artifact name',
            /mv "\$target" "\$target\.rejected"/.test(exportSh)],
        ['neither script announces success before the verdict',
            before(archiveSh, 'verify-ios-artifact.mjs', 'ios-archive: wrote')
            && before(exportSh, '--stage export', 'ios-export: wrote')],
    ];
    for (const [what, ok] of structural) {
        if (ok) console.log(`  ok   ${what}`);
        else { failures += 1; console.error(`  FAIL ${what}`); }
    }
}

// --- the CLI's own extraction path, which needs a Mac ------------------
//
// Everything above proves the RULES. This proves the script can get an
// Info.plist and an entitlement blob out of a bundle and an ipa at all, which
// is the half that broke first in practice: a provisioning profile carries its
// certificates as <data>, and converting one wholesale to JSON fails on every
// real profile.
if (process.platform === 'darwin') {
    const dir = mkdtempSync(join(tmpdir(), 'xc-ios-cli-'));
    try {
        const app = join(dir, 'App.app');
        mkdirSync(app, { recursive: true });
        const plistEntry = ([k, v]) => {
            if (typeof v === 'boolean') return `<key>${k}</key><${v}/>`;
            if (Array.isArray(v)) return `<key>${k}</key><array>${v.map((s) => `<string>${s}</string>`).join('')}</array>`;
            return `<key>${k}</key><string>${v}</string>`;
        };
        const info = buildInfo();
        writeFileSync(join(app, 'Info.plist'), [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0"><dict>',
            ...Object.entries(info).filter(([k]) => k !== 'CFBundleURLTypes').map(plistEntry),
            '<key>CFBundleURLTypes</key><array><dict>',
            plistEntry(['CFBundleURLSchemes', expected.urlSchemes]),
            '</dict></array>',
            '</dict></plist>',
        ].join('\n'));

        const cli = (args) => {
            try {
                execFileSync('node', [VERIFIER, ...args], { encoding: 'utf8', stdio: 'pipe', cwd: root });
                return { code: 0, out: '' };
            } catch (e) {
                return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
            }
        };

        const unsignedRun = cli([app, '--stage', 'archive', '--unsigned',
            '--marketing-version', MARKETING, '--build-number', BUILD]);
        if (unsignedRun.code === 0) console.log('  ok   the CLI reads an XML Info.plist out of a .app');
        else { failures += 1; console.error(`  FAIL the CLI could not read a synthesised .app:\n${unsignedRun.out}`); }

        const signedRun = cli([app, '--stage', 'archive']);
        if (signedRun.code === 1 && /carries no entitlements at all/.test(signedRun.out)) {
            console.log('  ok   the CLI refuses an unsigned bundle that did not declare itself unsigned');
        } else { failures += 1; console.error(`  FAIL unsigned-without-the-flag was not refused:\n${signedRun.out}`); }

        // Exit 2 rather than 1: "cannot read the artifact" must never be
        // reported in the vocabulary of "the artifact is wrong".
        const missing = cli([join(dir, 'nope.ipa'), '--stage', 'export']);
        if (missing.code === 2) console.log('  ok   an unreadable artifact exits 2, not 1');
        else { failures += 1; console.error(`  FAIL a missing artifact exited ${missing.code}, not 2`); }

        // The property, checked here as well as in the ceremony-wide
        // sweep: asking a release tool how to use it must be answered, not
        // refused, and losing the arguments must NOT read as a clean run.
        const help = cli(['--help']);
        if (help.code === 0) console.log('  ok   --help is answered rather than refused');
        else { failures += 1; console.error(`  FAIL --help exited ${help.code}`); }
        const bare = cli([]);
        if (bare.code === 2) console.log('  ok   no arguments is a refusal, not a silent pass');
        else { failures += 1; console.error(`  FAIL no arguments exited ${bare.code}, not 2`); }

        const packed = join(dir, 'packed.ipa');
        mkdirSync(join(dir, 'Payload'), { recursive: true });
        execFileSync('/bin/cp', ['-R', app, join(dir, 'Payload')]);
        execFileSync('zip', ['-q', '-r', packed, 'Payload'], { cwd: dir });
        // The packed app is unsigned, so reaching the entitlement verdict at
        // all is the proof that the unzip found the one app in the Payload.
        // Exit 2 here would mean it never got that far.
        const ipaRun = cli([packed, '--stage', 'export']);
        if (ipaRun.code === 1 && /carries no entitlements at all/.test(ipaRun.out)
            && /no embedded\.mobileprovision/.test(ipaRun.out)) {
            console.log('  ok   the CLI unzips an ipa and verifies the one app in its Payload');
        } else { failures += 1; console.error(`  FAIL the CLI could not open a synthesised ipa (exit ${ipaRun.code}):\n${ipaRun.out}`); }

        // A real archive and a real ipa when the operator points at a build
        // directory. Not discovered automatically: a stale build lying around
        // would turn an unrelated commit red for a reason nobody is looking at.
        const buildDir = process.env.XCHAIN_IOS_ARTIFACT_DIR;
        if (buildDir) {
            const realApp = join(buildDir, 'App.xcarchive/Products/Applications/App.app');
            if (existsSync(realApp)) {
                const r = cli([realApp, '--stage', 'archive']);
                if (r.code === 0) console.log('  ok   a real xcarchive passes the archive stage');
                else { failures += 1; console.error(`  FAIL a real xcarchive was refused:\n${r.out}`); }
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
} else {
    console.log('  --   CLI extraction checks skipped: plutil and codesign are macOS-only');
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nios-artifact-verify: all checks passed');
