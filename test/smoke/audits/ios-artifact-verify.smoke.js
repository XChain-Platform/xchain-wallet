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

const {
    readExpectations, runChecks, resolveVersionExpectations, associationAppIDs, loadAssociation,
} = await import(VERIFIER);

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

// The TEAM half of the appID, which nothing here checked until. An
// appID is `<TEAM>.<bundle id>` and the published apple-app-site-association
// pins the whole string, so a wrong team with the right bundle id passes every
// suffix check above and loses Universal Links on devices with no error
// anywhere. `829JG9YLH3` below is the fixture's own team, not an assertion
// about the pin; this tool is never the place that reads the AASA.
{
    const wrongTeam = (over) => buildEntitlements({
        'application-identifier': `OTHERTEAM1.${expected.bundleId}`,
        'com.apple.developer.team-identifier': 'OTHERTEAM1',
        ...over,
    });

    mustPass('a correct artifact with the ceremony\'s team supplied', { teamId: '829JG9YLH3' });
    mustFail('an artifact signed by a team the ceremony never asked for',
        { entitlements: wrongTeam(), teamId: '829JG9YLH3' },
        /signed for team "OTHERTEAM1" and the ceremony asked for 829JG9YLH3/);
    // The circular half, stated as a test so nobody has to re-derive it: with
    // no external authority reachable, a consistently-wrong team is ACCEPTED.
    // That is the residual this flag does not close, not an oversight.
    mustPass('a consistently-wrong team with no requested team supplied',
        { entitlements: wrongTeam() });
    assert.ok(
        run({}).passes.some((p) => /SKIPPED: the signed Team ID/.test(p)),
        'a run with no --team-id must SAY the signed team went unchecked; a silent omission is how '
        + '"nothing was checked" reads as "everything passed"',
    );

    // Needs no --team-id at all: one signature cannot belong to two teams.
    mustFail('a signature whose two team values disagree with each other',
        { entitlements: wrongTeam({ 'com.apple.developer.team-identifier': '829JG9YLH3' }) },
        /prefixed OTHERTEAM1 and com\.apple\.developer\.team-identifier is 829JG9YLH3/);
    mustFail('a signature carrying no team-identifier entitlement at all',
        { entitlements: buildEntitlements({ 'com.apple.developer.team-identifier': undefined }) },
        /com\.apple\.developer\.team-identifier undefined/);
    assert.ok(
        run({ teamId: '829JG9YLH3' }).passes.some((p) => /does NOT check that team against the published AASA/.test(p)),
        'with no --aasa the pass line must refuse to claim a pin it never read, or a green run reads '
        + 'as evidence of a comparison nothing made',
    );
    assert.ok(
        run({}).passes.some((p) => /SKIPPED: the signed appID/.test(p)),
        'a run with no --aasa must SAY the published appID went unchecked, for the same reason the '
        + 'team line does',
    );
}

// The published appID, which is the ONLY authority for the team that is not
// another copy of $APPLE_TEAM_ID. Everything else in the fixture above descends
// from the build input, so a consistently-wrong team passes every one of those
// checks - that is the residual the block above states as a passing test, and
// this block is what closes it.
//
// The association is a plain object here because the CLI does the reading: the
// fixture is what a supplied source parses to, including the shapes it can fail
// to parse to.
{
    const AASA_SRC = '../xchain-websites/xchain.io/.well-known/apple-app-site-association';
    const claimed = (...appIDs) => ({ source: AASA_SRC, appIDs });
    const signedAppID = `829JG9YLH3.${expected.bundleId}`;

    mustPass('an artifact whose signed appID is the one the association publishes',
        { teamId: '829JG9YLH3', aasa: claimed(signedAppID) });
    assert.ok(
        run({ teamId: '829JG9YLH3', aasa: claimed(signedAppID) }).passes
            .some((p) => new RegExp(`the signed appID ${signedAppID.replace(/\./g, '\\.')} is claimed by`).test(p)),
        'the pass line must name the appID and the source, because "checked against the association" '
        + 'is unfalsifiable in a log a year later',
    );
    assert.ok(
        run({ teamId: '829JG9YLH3', aasa: claimed(signedAppID) }).passes
            .some((p) => /the published AASA appID is checked separately below/.test(p)),
        'once a source IS supplied, the team line must stop disclaiming a check that now happens; a '
        + 'stale disclaimer is as misleading as a stale claim',
    );

    // The failure this whole item exists for: a team migration re-pinned in one
    // repo. Both values below are internally consistent and every other check
    // in this file passes on them.
    mustFail('a team migration that landed in the wallet and not in the published association',
        {
            teamId: 'NEWTEAM123',
            entitlements: buildEntitlements({
                'application-identifier': `NEWTEAM123.${expected.bundleId}`,
                'com.apple.developer.team-identifier': 'NEWTEAM123',
            }),
            aasa: claimed(signedAppID),
        },
        /signed as NEWTEAM123\.io\.xchain\.wallet\.ios and .* claims \[829JG9YLH3\.io\.xchain\.wallet\.ios\]/);
    mustFail('a team migration that landed in the published association and not in the wallet',
        { teamId: '829JG9YLH3', aasa: claimed(`NEWTEAM123.${expected.bundleId}`) },
        /signed as 829JG9YLH3\.io\.xchain\.wallet\.ios and .* claims \[NEWTEAM123\./);
    // The bundle half travels in the same string, so this check sees a
    // one-sided rename too even where the team agrees.
    mustFail('an association that claims a different bundle under the same team',
        { teamId: '829JG9YLH3', aasa: claimed('829JG9YLH3.io.xchain.other') },
        /claims \[829JG9YLH3\.io\.xchain\.other\]/);
    // A wildcard appID is a scope decision, not agreement: the signature names
    // one app and a wildcard names any of them.
    mustFail('an association claiming a wildcard appID rather than this app',
        { teamId: '829JG9YLH3', aasa: claimed('829JG9YLH3.*') },
        /claims \[829JG9YLH3\.\*\]/);

    // Fail-closed. A supplied source that could not be read is NOT the
    // unchecked case, and treating it as one is how a release lane reports
    // "could not check" as "passed" on the run where it mattered.
    mustFail('a supplied association that could not be read at all',
        { teamId: '829JG9YLH3', aasa: { source: AASA_SRC, error: 'ENOENT: no such file or directory' } },
        /could not be read: ENOENT/);
    mustFail('a supplied association that claims no appIDs at all',
        { teamId: '829JG9YLH3', aasa: claimed() },
        /claims no appIDs at all/);
    mustFail('a supplied association held against a signature that names no app',
        {
            teamId: '829JG9YLH3',
            entitlements: buildEntitlements({ 'application-identifier': undefined }),
            aasa: claimed(signedAppID),
        },
        /no appID to hold against/);

    // The parser, on the shapes a published file really takes.
    assert.deepEqual(
        associationAppIDs(JSON.stringify({
            applinks: { details: [{ appIDs: [signedAppID], components: [{ '/': '/wallet/link/*' }] }] },
        })),
        [signedAppID],
        'the shape aasa.build.js emits must parse to the appID it emits');
    assert.deepEqual(
        associationAppIDs(JSON.stringify({
            applinks: { details: [{ appID: signedAppID, paths: ['/wallet/link/*'] }] },
        })),
        [signedAppID],
        'appID singular is Apple\'s pre-iOS-13 spelling and live files still carry it; reading only '
        + 'the plural would report a real association as claiming nothing');
    assert.throws(() => associationAppIDs('{"webcredentials":{}}'), /not an apple-app-site-association/,
        'a JSON file that is not an association must be refused, not read as an empty claim');
    assert.throws(() => associationAppIDs('<html>404</html>'), /JSON/,
        'an error page fetched from a URL is the commonest wrong answer and must not parse');

    // The real published file, when the sibling is beside this repo: the
    // fixtures above prove the rule and this proves the rule is about the thing
    // that actually ships. Absent, it says so rather than passing quietly.
    const publishedPath = join(root, AASA_SRC);
    if (existsSync(publishedPath)) {
        const ids = associationAppIDs(readFileSync(publishedPath, 'utf8'));
        assert.ok(
            ids.every((id) => id.endsWith(`.${expected.bundleId}`)),
            `the sibling repo publishes [${ids.join(', ')}], none of which is an appID for the bundle `
            + `this project builds (${expected.bundleId}). The two repos have already drifted.`,
        );
        console.log(`  ok   the sibling's published association claims [${ids.join(', ')}]`);
    } else {
        console.log('  SKIP the sibling xchain-websites checkout is not beside this repo, so the '
            + `published association at ${publishedPath} was NOT read this run`);
    }
}

// The READ, which every fixture above skips past. Feeding runChecks a
// pre-parsed association proves the rule and proves nothing about the code that
// turns a path or a URL into one - and that code is where the fail-closed
// promise actually lives, because it is the thing that decides whether an
// unreachable source arrives as an `error` or as silence.
{
    const dir = mkdtempSync(join(tmpdir(), 'xc-aasa-'));
    const check = (what, ok) => {
        if (ok) console.log(`  ok   ${what}`);
        else { failures += 1; console.error(`  FAIL ${what}`); }
    };
    try {
        const good = join(dir, 'apple-app-site-association');
        writeFileSync(good, `${JSON.stringify({
            applinks: { details: [{ appIDs: [`829JG9YLH3.${expected.bundleId}`] }] },
        }, null, 2)}\n`);

        const fromPath = await loadAssociation(good);
        check('a local association path is read and parsed',
            fromPath.error === undefined && fromPath.appIDs.length === 1
            && fromPath.appIDs[0] === `829JG9YLH3.${expected.bundleId}`);

        const absent = await loadAssociation(join(dir, 'not-there'));
        check('a missing path comes back as an error rather than an exception or an empty claim',
            absent.error !== undefined && /ENOENT/.test(absent.error) && absent.appIDs === undefined);

        const junk = join(dir, 'junk');
        writeFileSync(junk, 'not json at all');
        check('a source that is not JSON comes back as an error',
            (await loadAssociation(junk)).error !== undefined);

        // Apple fetches this over https and nothing else. A cleartext source is
        // an authority any network on the path can rewrite, which would make
        // the check worse than absent.
        const cleartext = await loadAssociation('http://xchain.io/.well-known/apple-app-site-association');
        check('an http:// source is refused rather than trusted',
            cleartext.error !== undefined && /https/.test(cleartext.error));

        // The network boundary is stubbed, not the unit: loadAssociation still
        // runs its own branch, response handling and parse.
        const realFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => new Response(
                JSON.stringify({ applinks: { details: [{ appIDs: ['NEWTEAM123.io.xchain.wallet.ios'] }] } }),
                { status: 200 },
            );
            const fromUrl = await loadAssociation('https://xchain.io/.well-known/apple-app-site-association');
            check('an https source is fetched and parsed',
                fromUrl.error === undefined && fromUrl.appIDs[0] === 'NEWTEAM123.io.xchain.wallet.ios');

            globalThis.fetch = async () => new Response('<html>404</html>', { status: 404 });
            const notFound = await loadAssociation('https://xchain.io/.well-known/apple-app-site-association');
            check('a host answering 404 is a FAILURE, not an unchecked run',
                notFound.error !== undefined && /404/.test(notFound.error));

            globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND xchain.io'); };
            const offline = await loadAssociation('https://xchain.io/.well-known/apple-app-site-association');
            check('an unreachable host is a FAILURE, not an unchecked run',
                offline.error !== undefined && /ENOTFOUND/.test(offline.error));
        } finally {
            globalThis.fetch = realFetch;
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
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

// S46. The line above is why the CLI half of this smoke was RED on
// every fresh checkout and green in a checkout that had built iOS: the file is
// generated and git-ignored, the CLI read its expectation from it regardless,
// and `--marketing-version` / `--build-number` fed only the TAG side, so the
// documented standalone use ("looking at an artifact you already have") was
// refused no matter what it was told. The resolution rule is one-directional
// and both directions are asserted here, because the permissive half is the
// one that could quietly turn this tool into something a caller can satisfy by
// asserting.
{
    const withFile = { marketingVersion: '0.336.0', buildNumber: '3360050', bundleId: 'x' };
    const absent = { marketingVersion: undefined, buildNumber: undefined, bundleId: 'x' };

    const supplied = resolveVersionExpectations(absent, '0.337.0', '3370050');
    assert.equal(supplied.versionSource, 'flags',
        'a supplied pair must stand in for an absent Version.xcconfig, or every fresh checkout '
        + 'refuses the standalone run this tool advertises');
    assert.equal(supplied.expected.marketingVersion, '0.337.0');
    assert.equal(supplied.expected.buildNumber, '3370050');

    const present = resolveVersionExpectations(withFile, '0.337.0', '3370050');
    assert.equal(present.versionSource, 'xcconfig',
        'FAIL: a supplied version pair overrode a Version.xcconfig that was present. That turns '
        + 'the stale-xcconfig failure above into something the caller can switch off from the '
        + 'command line, which is the one thing this rule may never do.');
    assert.equal(present.expected.marketingVersion, '0.336.0',
        'the file must win while it exists');

    const half = resolveVersionExpectations(absent, '0.337.0', undefined);
    assert.equal(half.versionSource, 'xcconfig',
        'half a pair is not a pair: a supplied marketing version with no build number must fall '
        + 'through to the missing-xcconfig failure rather than checking one number and skipping '
        + 'the other in silence');
}

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
        // The flag existing on the tool proves nothing about a release: an
        // authority nobody passes is an authority nobody consults, and this is
        // the leg of the identity seam that has no static gate anywhere else.
        ['both ceremony scripts hand the verifier the published association',
            /verify_args\+=\(--aasa "\$aasa"\)/.test(archiveSh)
            && /verify_args\+=\(--aasa "\$aasa"\)/.test(exportSh)],
        ['both resolve it from $XCHAIN_AASA first and the sibling checkout second',
            [archiveSh, exportSh].every((src) => /aasa="\$\{XCHAIN_AASA:-\}"/.test(src)
                && /xchain-websites\/xchain\.io\/\.well-known\/apple-app-site-association/.test(src))],
        ['ios-archive.sh asks for the association only in the signed lane',
            at(archiveSh, '--aasa "$aasa"') > at(archiveSh, 'verify_args+=(--team-id')],
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
        // The version pair the CLI itself will trust on THIS machine. A
        // generated Version.xcconfig outranks supplied flags by design (a
        // flag pair must never override a present file), so on a machine
        // mid-release the fixture app has to carry the file's pair for this
        // to stay a can-the-CLI-read-an-app test rather than a version test.
        // On a fresh clone both halves fall back to the pins above.
        const cliMarketing = repoExpectations.marketingVersion || MARKETING;
        const cliBuild = repoExpectations.buildNumber || BUILD;
        const info = buildInfo({ CFBundleShortVersionString: cliMarketing, CFBundleVersion: cliBuild });
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
            '--marketing-version', cliMarketing, '--build-number', cliBuild]);
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
