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

// tools/release/verify-ios-artifact.mjs - assert the Info.plist and entitlement
// facts of a BUILT iOS artifact ( §5,).
//
// Usage:
//     node tools/release/verify-ios-artifact.mjs <App.app|*.ipa> --stage archive|export
//         [--marketing-version 0.336.0] [--build-number 3360050] [--team-id ABCDE12345]
//         [--unsigned]
//
// WHY THIS EXISTS, AND WHY IT IS NOT A RENAME OF THE ANDROID ONE.
//
// tools/release/ios-archive.sh and ios-export.sh asserted exactly one thing
// about what they produced: that a directory called App.app was where
// xcodebuild said it would be. Not the bundle id, not the version pair, not the
// Universal Link entitlement, not whether the thing was even signed for
// distribution. release.yml's mobile-ios job has never run once, so nothing had
// ever asserted a fact about a built iOS artifact anywhere.
//
// That is the state the Android bundle was in until, and the control
// that was missing there is the same control missing here wearing Apple's
// spelling. The `associated-domains` entitlement plus the AASA's CLAIMED_PATH
// are one claim split across two files in two repos; already names
// them as drifting silently, and is what the drift costs once the
// artifact is in a store - the claim swallowed the listing's own privacy-policy
// URL, which Apple's reviewers open exactly as Google's do.
//
// It is a separate script rather than a shared one because almost nothing about
// the two artifacts is shared: an `.ipa` is a zip around a signed bundle, the
// entitlements live in the code signature rather than in a manifest, the
// version pair is CFBundleShortVersionString + CFBundleVersion rather than a
// single versionCode, and half of what matters is decided by the provisioning
// profile Xcode chose rather than by anything in the repo.
//
// EXPECTATIONS ARE DERIVED FROM THE BUILD INPUTS, NEVER PASTED BESIDE THEM. The
// bundle id comes out of the pbxproj, the version pair out of the generated
// Version.xcconfig, the applinks host out of the URI parser, and the permission
// prompts, URL schemes and requested capabilities out of the source Info.plist
// and App.entitlements. So every check is really "the artifact carries what the
// repo asked for", which is the only form that catches the case this is for: a
// Swift package, a Capacitor plugin or a portal-side App ID capability adding
// something to the shipped app that no file here requests.
//
// THE TEAM ID ARRIVES BY FLAG, BECAUSE NO FILE HERE HOLDS IT. The signing team
// is the one expectation this repo cannot derive: ios-archive.sh signs with
// DEVELOPMENT_TEAM="$APPLE_TEAM_ID", an environment value, and the authority it
// is meant to agree with - the appID pinned into the published
// apple-app-site-association - lives in xchain-websites, which release.yml's
// mobile-ios job does not check out. So --team-id carries the same build input
// the ceremony signed with, and the checks below state plainly what that does
// and does not cover. It catches the SIGNATURE disagreeing with what the
// ceremony asked for, which cloud signing can produce on its own: provisioning
// updates pick a profile, and the profile's team is the portal's answer rather
// than the flag's. It does NOT catch a $APPLE_TEAM_ID that is itself wrong
// against the AASA pin; reconciling the input to that pin is a separate control
// at a separate place, and the pass line says so rather than reading
// as a check against the pin.
//
// The two entitlement values are also held against EACH OTHER whether or not a
// team id is supplied, because that comparison needs no external authority at
// all and a signature whose application-identifier prefix disagrees with its
// own team-identifier is malformed however it was requested.
//
// The assertions are a pure function of plain objects (runChecks) and the
// plist extraction is the CLI's business, so the guard can be shown broken
// artifacts on any platform while the real artifacts only exist on a Mac.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Added by the signing identity on every build, so it is present in artifacts
// whose source entitlements never mention it. The only such key: anything else
// appearing without a source request is the capability-creep case below.
//
// Exempt from the capability-creep NAME check only. Its VALUE is asserted in
// runChecks, against the application-identifier prefix always and against the
// supplied --team-id when there is one; being signing-added is why no source
// file requests it, not a reason to trust what it says.
const SIGNING_ADDED_ENTITLEMENTS = new Set(['com.apple.developer.team-identifier']);

/**
 * The facts the repo asks the artifact to carry, read out of the build inputs.
 *
 * @param {string} [root] wallet repo root
 * @returns {object}
 */
export function readExpectations(root = REPO_ROOT) {
    const read = (p) => readFileSync(join(root, p), 'utf8');
    const ios = 'packages/mobile/ios/App';

    const pbxproj = read(`${ios}/App.xcodeproj/project.pbxproj`);
    // The test target's id is a suffix of the app's, so filtering on it rather
    // than taking the first match keeps a reordered pbxproj from silently
    // pinning the artifact to `io.xchain.wallet.ios.uitests`.
    const bundleIds = [...new Set(
        [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
            .map((m) => m[1].trim())
            .filter((id) => !id.endsWith('.uitests')),
    )];
    if (bundleIds.length !== 1) {
        throw new Error(
            `the pbxproj declares ${bundleIds.length} app bundle identifiers (${bundleIds.join(', ')}), `
            + 'so there is no single id to hold the artifact to',
        );
    }

    const parser = read('packages/core/src/uri/xchainUri.js');
    const origin = /const WEB_LINK_ORIGIN = '([^']+)'/.exec(parser)?.[1];
    if (!origin) {
        throw new Error(
            'WEB_LINK_ORIGIN was not found in packages/core/src/uri/xchainUri.js. This script derives '
            + 'the associated-domains host from the parser rather than holding a copy of it; if the '
            + 'constant moved or was renamed, point this at the new one - do not paste a literal back in.',
        );
    }

    const infoPlist = read(`${ios}/App/Info.plist`);
    const entitlements = read(`${ios}/App/App.entitlements`);

    // Version.xcconfig is generated by sync:ios from the release tag and is
    // git-ignored, so its absence is a real state (staging did not run) rather
    // than a broken checkout, and runChecks reports it as a failure.
    const xcconfigPath = join(root, `${ios}/Version.xcconfig`);
    const xcconfig = existsSync(xcconfigPath) ? readFileSync(xcconfigPath, 'utf8') : undefined;

    return {
        bundleId: bundleIds[0],
        applinksHost: new URL(origin).host,
        marketingVersion: xcconfig && /^MARKETING_VERSION = (.+)$/m.exec(xcconfig)?.[1].trim(),
        buildNumber: xcconfig && /^CURRENT_PROJECT_VERSION = (.+)$/m.exec(xcconfig)?.[1].trim(),
        usageDescriptionKeys: [...new Set(
            [...infoPlist.matchAll(/<key>(NS\w*UsageDescription)<\/key>/g)].map((m) => m[1]),
        )].sort(),
        urlSchemes: plistArrayStrings(infoPlist, 'CFBundleURLSchemes').sort(),
        associatedDomains: plistArrayStrings(entitlements, 'com.apple.developer.associated-domains').sort(),
        requestedEntitlements: [...new Set(
            [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]),
        )].sort(),
    };
}

/**
 * Decide where the expected version pair comes from.
 *
 * Version.xcconfig is GENERATED by sync:ios and git-ignored, so a checkout
 * that has not built iOS does not have it - which is every fresh clone, and
 * the exact shape of the standalone use this tool's own --help advertises
 * ("here for looking at an artifact you already have"). Until  S46 the
 * two version flags fed only the TAG side while the expectation still came
 * from the absent file, so such a run was refused with "sync:ios did not run"
 * no matter what the caller passed.
 *
 * The rule is one-directional on purpose: supplied numbers stand in for the
 * file when it is absent, and NEVER override it when it is present. An
 * artifact agreeing with a stale xcconfig is the failure this tool exists to
 * catch, and letting a flag win would let a caller pass by asserting.
 *
 * @param {object} fromFile result of readExpectations
 * @param {string} [suppliedVersion] --marketing-version
 * @param {string} [suppliedBuild] --build-number
 * @returns {{expected: object, versionSource: 'xcconfig'|'flags'}}
 */
export function resolveVersionExpectations(fromFile, suppliedVersion, suppliedBuild) {
    const fileIsShort = !fromFile.marketingVersion || !fromFile.buildNumber;
    if (fileIsShort && suppliedVersion && suppliedBuild) {
        return {
            expected: { ...fromFile, marketingVersion: suppliedVersion, buildNumber: suppliedBuild },
            versionSource: 'flags',
        };
    }
    return { expected: fromFile, versionSource: 'xcconfig' };
}

/** Strings of the `<array>` following `<key>name</key>` in an XML plist. */
function plistArrayStrings(xml, name) {
    const out = [];
    const re = new RegExp(`<key>${name}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g');
    for (const block of xml.matchAll(re)) {
        for (const s of block[1].matchAll(/<string>([^<]*)<\/string>/g)) out.push(s[1]);
    }
    return [...new Set(out)];
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every artifact assertion, as a pure function so the guard can be driven
 * against fixtures on a machine that has never seen Xcode.
 *
 * @param {object} args
 * @param {object} args.info parsed Info.plist of the built .app
 * @param {object} [args.entitlements] entitlements read out of the code signature
 * @param {object} [args.profile] parsed embedded.mobileprovision
 * @param {'archive'|'export'} args.stage
 * @param {object} args.expected result of readExpectations
 * @param {boolean} [args.unsigned] the caller declared an unsigned lane build
 * @param {string} [args.teamId] the Apple Developer Team ID the ceremony asked
 *   xcodebuild to sign for ($APPLE_TEAM_ID). Undefined when the caller supplied
 *   none, which is reported as unchecked rather than passed over in silence.
 * @param {string} [args.taggedVersion] marketing version the release tag derives
 * @param {string} [args.taggedBuild] build number the release tag derives
 * @param {'xcconfig'|'flags'} [args.versionSource] where the expected version
 *   pair came from. `flags` means the caller supplied it because the generated
 *   Version.xcconfig was absent, which makes the tag comparison below a
 *   comparison of a value with itself; it is reported as supplied rather than
 *   dressed up as a cross-check.
 * @returns {{failures: string[], passes: string[]}}
 */
export function runChecks({
    info, entitlements, profile, stage, expected, unsigned = false, teamId, taggedVersion, taggedBuild,
    versionSource = 'xcconfig',
}) {
    const failures = [];
    const passes = [];
    const fail = (what, why) => { failures.push(`${what}\n    ${why}`); };
    const pass = (what) => { passes.push(what); };

    if (stage !== 'archive' && stage !== 'export') {
        throw new Error(`stage must be 'archive' or 'export', not ${JSON.stringify(stage)}`);
    }

    if (info.CFBundleIdentifier === expected.bundleId) {
        pass(`bundle id is ${expected.bundleId}, which is what the project builds`);
    } else {
        fail(`the artifact's bundle id is ${info.CFBundleIdentifier}, not ${expected.bundleId}`,
            'App Store Connect binds a record to one bundle id for the life of the app, and an id '
            + 'that is not the project\'s means a build setting was overridden on the command line.');
    }

    // Version.xcconfig is the only place the project reads a version from
    // (S4a), and the tag is what generated it. Comparing the artifact against
    // the file and the file against the tag are two different failures: a
    // matching pair proves nothing if both are last release's numbers.
    if (!expected.marketingVersion || !expected.buildNumber) {
        fail('Version.xcconfig was missing when the expectations were read',
            'The project takes both version numbers from that generated file and the pbxproj carries '
            + 'no literal to fall back on, so sync:ios did not run and there is nothing to check against.');
    } else {
        for (const [key, want, label] of [
            ['CFBundleShortVersionString', expected.marketingVersion, 'MARKETING_VERSION'],
            ['CFBundleVersion', expected.buildNumber, 'CURRENT_PROJECT_VERSION'],
        ]) {
            if (info[key] === want) pass(`${key} is ${want}, which is what ${label} pins`);
            else {
                fail(`the artifact's ${key} is ${info[key]}, not the ${want} ${label} pins`,
                    'App Store Connect accepts a build number exactly once per version, so uploading '
                    + 'the wrong pair spends it permanently and the correction costs a new tag.');
            }
        }
        if (versionSource === 'flags') {
            // Nothing to cross-check: the tag side and the expectation are one
            // value here. Saying so keeps the record honest, because a pass
            // line reading "agrees with the tag" would be this value agreeing
            // with itself, which is the shape of evidence this whole file
            // exists to refuse.
            pass(`the version pair was SUPPLIED (${expected.marketingVersion} / ${expected.buildNumber}), `
                + 'not read from Version.xcconfig, so it is not cross-checked against the tag');
        } else {
            for (const [want, got, label] of [
                [taggedVersion, expected.marketingVersion, 'marketing version'],
                [taggedBuild, expected.buildNumber, 'build number'],
            ]) {
                if (want !== undefined && want !== got) {
                    fail(`Version.xcconfig's ${label} is ${got} and the tag derives ${want}`,
                        'The artifact matching a stale xcconfig is the failure this catches: both halves '
                        + 'agree and the build still carries a previous release\'s numbers.');
                }
            }
            if (taggedVersion !== undefined && taggedVersion === expected.marketingVersion) {
                pass(`Version.xcconfig agrees with the tag (${taggedVersion})`);
            }
        }
    }

    if (!entitlements) {
        if (unsigned && stage === 'archive') {
            passes.push('SKIPPED: entitlement checks, because the caller declared an unsigned lane build');
        } else {
            fail('the artifact carries no entitlements at all',
                'It was not signed. An unsigned build has no keychain-access-group, so every vault '
                + 'call in it returns OSStatus -34018, and it cannot be distributed. If this was the '
                + 'unsigned lane rehearsal, say so with --unsigned.');
        }
    } else {
        const appId = entitlements['application-identifier'];
        if (typeof appId === 'string' && appId.endsWith(`.${expected.bundleId}`)) {
            pass('application-identifier ends with the bundle id the project builds');
        } else {
            fail(`application-identifier is ${JSON.stringify(appId)}, which does not end with .${expected.bundleId}`,
                'The signature was issued for a different app id than the bundle carries, which is how '
                + 'a build signed against the wrong App ID record reaches an upload before Apple rejects it.');
        }

        // The Team ID half of the same string, which nothing read until
        //: `<TEAM>.<bundle id>` is one appID and the suffix check
        // above only ever saw the second half. The AASA publishes the WHOLE
        // appID, so a build signed under another team keeps the right bundle id
        // and still loses Universal Links, silently and only on devices.
        const signedTeam = entitlements['com.apple.developer.team-identifier'];
        const dot = typeof appId === 'string' ? appId.indexOf('.') : -1;
        const appIdTeam = dot > 0 ? appId.slice(0, dot) : undefined;

        // Needs no external authority, so it runs on every signed artifact: the
        // two values are written by one signing identity and disagreeing is
        // malformed however the build was requested.
        if (appIdTeam === undefined || typeof signedTeam !== 'string') {
            fail(`the signature carries application-identifier ${JSON.stringify(appId)} and `
                + `com.apple.developer.team-identifier ${JSON.stringify(signedTeam)}`,
                'Every signed build carries both, and the pair is what names the team the app belongs '
                + 'to. One of them missing means these entitlements did not come off a real signature.');
        } else if (appIdTeam !== signedTeam) {
            fail(`application-identifier is prefixed ${appIdTeam} and com.apple.developer.team-identifier is ${signedTeam}`,
                'One signature cannot belong to two teams. A pair that disagrees is a rewritten or '
                + 'merged entitlement set, and neither value can then be trusted as the app\'s team.');
        } else {
            pass(`both entitlements name team ${signedTeam}`);
        }

        // Against the build input, when the ceremony passed one. Stated as
        // "what the ceremony asked for" rather than as agreement with the
        // published AASA, which this repo cannot see: a pass line claiming the
        // pin would be the same value agreeing with itself, the shape of
        // evidence this file refuses everywhere else.
        if (teamId === undefined) {
            pass('SKIPPED: the signed Team ID was not held against any requested team, because no '
                + '--team-id was supplied (the release ceremony passes $APPLE_TEAM_ID)');
        } else if (appIdTeam === teamId && signedTeam === teamId) {
            pass(`the signed team is ${teamId}, which is the team the ceremony asked xcodebuild for `
                + '(this does NOT check that team against the published AASA appID)');
        } else {
            fail(`the artifact is signed for team ${JSON.stringify(signedTeam ?? appIdTeam)} and the ceremony asked for ${teamId}`,
                'The published apple-app-site-association names one <TEAM>.<bundle id> appID, so an app '
                + 'signed under a different team is not the app the association claims: iOS silently '
                + 'stops opening https links in it and nothing anywhere reports an error. Cloud signing '
                + 'chooses the profile, so the team the portal hands back can differ from the one asked '
                + 'for without any file in this repo changing.');
        }

        const domains = entitlements['com.apple.developer.associated-domains'];
        const wantDomains = expected.associatedDomains;
        if (!Array.isArray(domains) || domains.length === 0) {
            fail('the signed app claims no associated domains at all',
                `Every printed https://${expected.applinksHost} link stays in the browser and the app is `
                + 'never offered, so the Universal Link path has nothing to verify against.');
        } else if (!eq([...domains].sort(), wantDomains)) {
            fail(`the signed app claims [${domains.join(', ')}] and App.entitlements asks for [${wantDomains.join(', ')}]`,
                'The signature is what iOS reads, not the source file, and a provisioning profile can '
                + 'carry a claim the repo never wrote.');
        } else if (domains.some((d) => !d.startsWith('applinks:'))) {
            fail(`an associated-domains entry is not an applinks claim: [${domains.join(', ')}]`,
                'Each key here grants the app a capability on the domain; webcredentials would offer '
                + 'password autofill for a wallet that has no server-side account.');
        } else if (domains.some((d) => d.includes('*'))) {
            fail(`an associated-domains entry is a wildcard claim: [${domains.join(', ')}]`,
                'A wildcard takes every subdomain, so the paths the AASA claims stop being the scope '
                + 'and any future host on the domain inherits the app.');
        } else if (!domains.includes(`applinks:${expected.applinksHost}`)) {
            fail(`the claim names [${domains.join(', ')}] and the parser acts on ${expected.applinksHost}`,
                'A host the parser never unwraps means the OS hands the app URLs it drops: the wallet '
                + 'surfaces on its default view, the page never loads, and nothing reports an error.');
        } else {
            pass(`associated domains are exactly applinks:${expected.applinksHost}, which is the parser's host`);
        }

        // -allowProvisioningUpdates lets Xcode mint a profile carrying whatever
        // capabilities the App ID has enabled in the portal, so an entitlement
        // can appear in the shipped app that no file in this repo requests and
        // no review of the repo would ever show.
        const unrequested = Object.keys(entitlements)
            .filter((k) => k.startsWith('com.apple.developer.'))
            .filter((k) => !SIGNING_ADDED_ENTITLEMENTS.has(k))
            .filter((k) => !expected.requestedEntitlements.includes(k));
        if (unrequested.length > 0) {
            fail(`the signed app holds capabilities App.entitlements never requests: [${unrequested.join(', ')}]`,
                'Cloud signing grants whatever the App ID record has enabled, so a capability toggled '
                + 'in the developer portal ships without a commit anywhere. Each one is App Review '
                + 'surface and a privilege the wallet did not ask for.');
        } else {
            pass('no capability beyond what App.entitlements requests');
        }

        if (stage === 'export') {
            if (entitlements['get-task-allow'] === true) {
                fail('the exported app is signed with get-task-allow',
                    'The wallet is debuggable: a debugger can attach to the process holding the '
                    + 'decrypted vault. This is a development signature, and App Store Connect rejects '
                    + 'it - which is the good case, because the bad one is a TestFlight build.');
            } else {
                pass('get-task-allow is not set, so the shipped app is not debuggable');
            }
        }
    }

    if (stage === 'export') {
        if (!profile) {
            fail('the exported app carries no embedded.mobileprovision',
                'Nothing says which App ID, team or capabilities the build was authorised for, and '
                + 'an ipa without one cannot install anywhere.');
        } else {
            if (Array.isArray(profile.ProvisionedDevices)) {
                fail(`the ipa is signed with a DEVELOPMENT profile (${profile.ProvisionedDevices.length} provisioned devices)`,
                    'A device list means the profile is development or ad-hoc, so the build installs '
                    + 'on those UDIDs and nowhere else. Cloud signing picks a profile, and picking the '
                    + 'wrong one produces an ipa that looks correct everywhere except at upload.');
            } else {
                pass('the profile provisions no device list, so it is a distribution profile');
            }
            if (profile.Entitlements?.['get-task-allow'] === true) {
                fail('the provisioning profile itself grants get-task-allow',
                    'Even where the binary\'s signature looks right, the profile is a development one '
                    + 'and the pairing is what Apple validates.');
            }
        }
    }

    const ats = info.NSAppTransportSecurity;
    const atsHoles = ats
        ? ['NSAllowsArbitraryLoads', 'NSAllowsArbitraryLoadsInWebContent', 'NSAllowsLocalNetworking']
            .filter((k) => ats[k] === true)
        : [];
    if (atsHoles.length > 0) {
        fail(`App Transport Security is disabled in the artifact: [${atsHoles.join(', ')}]`,
            'The shell is a WKWebView, so an ATS hole permits a downgrade to cleartext on any network '
            + 'the device joins, for the web view that renders the wallet.');
    } else {
        pass('App Transport Security carries no arbitrary-loads exception');
    }

    // The SET, not a count: a swapped prompt and an added one are different
    // failures and a count sees neither. Every usage string is App Review
    // surface, and an SPM package or Capacitor plugin merges one in silently.
    const actualUsage = Object.keys(info).filter((k) => /^NS\w*UsageDescription$/.test(k)).sort();
    if (!eq(actualUsage, expected.usageDescriptionKeys)) {
        const added = actualUsage.filter((k) => !expected.usageDescriptionKeys.includes(k));
        const removed = expected.usageDescriptionKeys.filter((k) => !actualUsage.includes(k));
        fail('the artifact\'s permission-prompt set is not the one Info.plist declares',
            `added: [${added.join(', ') || 'none'}]; removed: [${removed.join(', ') || 'none'}]. `
            + 'An added key is a permission the wallet now asks for and App Review will ask about; a '
            + 'removed one is a prompt iOS refuses to show, so the feature behind it dies on a device.');
    } else if (actualUsage.some((k) => !String(info[k] ?? '').trim())) {
        const empty = actualUsage.filter((k) => !String(info[k] ?? '').trim());
        fail(`a permission prompt in the artifact has an empty string: [${empty.join(', ')}]`,
            'The string is shown verbatim in the OS prompt, and Apple rejects a build whose usage '
            + 'description is blank.');
    } else {
        pass(`permission-prompt set matches exactly (${actualUsage.length} prompts, all non-empty)`);
    }

    const actualSchemes = [...new Set(
        (info.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []),
    )].sort();
    if (eq(actualSchemes, expected.urlSchemes)) {
        pass(`URL schemes are exactly [${actualSchemes.join(', ')}]`);
    } else {
        fail(`the artifact claims URL schemes [${actualSchemes.join(', ')}], not [${expected.urlSchemes.join(', ')}]`,
            'Any app may claim a scheme and iOS picks between claimants unpredictably, so each one is '
            + 'an untrusted inbound channel into the signing flows. A merged-in scheme is one nobody '
            + 'wrote a validator for.');
    }

    // CAPACITOR_DEBUG decides whether the WebView sets isInspectable. The
    // source-level guard proves the flag lives only in debug.xcconfig; only the
    // artifact can prove no configuration leaked it into the build that ships.
    const capDebug = info.CAPACITOR_DEBUG;
    if (capDebug === undefined || capDebug === '' || capDebug === false || capDebug === 'false') {
        pass('CAPACITOR_DEBUG is not set in the artifact, so Safari cannot attach to the wallet');
    } else {
        fail(`the artifact carries CAPACITOR_DEBUG=${JSON.stringify(capDebug)}`,
            'Safari\'s Web Inspector can attach to a shipped wallet over a cable, and CAPLog prints '
            + 'into the device log. A Release build reaching this state is a configuration leak, not a '
            + 'code change, so no diff shows it.');
    }

    if (info.ITSAppUsesNonExemptEncryption === false) {
        pass('ITSAppUsesNonExemptEncryption is declared false');
    } else {
        fail(`ITSAppUsesNonExemptEncryption is ${JSON.stringify(info.ITSAppUsesNonExemptEncryption)}, not false`,
            'Missing, every upload stops for a manual export-compliance answer that a script cannot '
            + 'give; true, the declaration is wrong for a wallet that uses standard cryptography only '
            + 'and carries filing obligations it does not owe ( §2.5).');
    }

    return { failures, passes };
}

/** Parse a plist file (binary or XML) into a plain object. Needs macOS. */
function readPlist(path) {
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', path], { encoding: 'utf8' });
    return JSON.parse(json);
}

/** The entitlements in a bundle's code signature, or undefined if unsigned. */
function readEntitlements(appDir, scratch) {
    let xml;
    try {
        xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', appDir], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
    if (!xml.trim().startsWith('<?xml')) return undefined;
    const path = join(scratch, 'entitlements.plist');
    writeFileSync(path, xml);
    return readPlist(path);
}

/** One key path out of a plist, or undefined when it is not there. */
function plistExtract(path, keypath) {
    try {
        return JSON.parse(execFileSync('plutil', ['-extract', keypath, 'json', '-o', '-', '--', path], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }));
    } catch {
        return undefined;
    }
}

// Read key by key rather than whole: a provisioning profile carries the signing
// certificates as <data>, which has no JSON form, so converting the whole plist
// fails on every real profile.
function readProfile(appDir, scratch) {
    const src = join(appDir, 'embedded.mobileprovision');
    if (!existsSync(src)) return undefined;
    const der = execFileSync('security', ['cms', '-D', '-i', src], {
        encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = join(scratch, 'profile.plist');
    writeFileSync(path, der);
    return {
        Name: plistExtract(path, 'Name'),
        ProvisionedDevices: plistExtract(path, 'ProvisionedDevices'),
        Entitlements: { 'get-task-allow': plistExtract(path, 'Entitlements.get-task-allow') },
    };
}

/** Resolve the argument to a .app directory, unzipping an ipa if that is what it is. */
function locateApp(target, scratch) {
    if (target.endsWith('.app')) return target;
    if (!target.endsWith('.ipa')) {
        throw new Error(`${basename(target)} is neither a .app directory nor a .ipa`);
    }
    const out = join(scratch, 'ipa');
    execFileSync('unzip', ['-q', '-o', target, '-d', out]);
    const payload = join(out, 'Payload');
    const apps = existsSync(payload) ? readdirSync(payload).filter((n) => n.endsWith('.app')) : [];
    if (apps.length !== 1) {
        throw new Error(
            `the ipa's Payload holds ${apps.length} .app bundles (${apps.join(', ') || 'none'}), not 1. `
            + 'An ipa is a zip and anything can be inside one; the store installs Payload/<one>.app.',
        );
    }
    return join(payload, apps[0]);
}

const VALUE_FLAGS = new Set(['stage', 'tag', 'marketing-version', 'build-number', 'team-id']);

// The tag is what the release lane actually holds, and rails §2 owns the
// formula turning it into the two numbers. Imported rather than reimplemented:
//  already reconciled three copies of this arithmetic that disagreed.
async function versionsFromTag(tag) {
    const mod = await import(new URL('../../packages/mobile/scripts/version.js', import.meta.url));
    return {
        taggedVersion: mod.marketingVersionFromTag(tag),
        taggedBuild: String(mod.storeVersionFromTag(tag)),
    };
}

function parseArgs(args) {
    const values = {};
    const positional = [];
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (!a.startsWith('--')) { positional.push(a); continue; }
        const name = a.slice(2);
        if (VALUE_FLAGS.has(name)) { values[name] = args[i + 1]; i += 1; } else values[name] = true;
    }
    return { values, positional };
}

// Answered before anything else and on STDOUT at exit 0, for the reason
// ios-archive.sh states at the same position : a tool that answers
// "how do I use you" in its own refusal vocabulary turns a question into an
// emergency, at the exact moment something else has already gone wrong.
const HELP = `verify-ios-artifact.mjs - assert what a BUILT iOS artifact carries ( §5, ).

Usage:
  node tools/release/verify-ios-artifact.mjs <App.app|*.ipa> --stage archive|export [options]

Both iOS ceremony scripts call this themselves, so a normal release never runs
it by hand; it is here for looking at an artifact you already have.

Arguments:
  <App.app|*.ipa>          the archived app bundle, or an exported ipa

Options:
  --stage archive|export   which facts to demand. \`export\` adds the three only a
                           signed export can carry: a distribution provisioning
                           profile, no get-task-allow, one app in the Payload
  --tag vX.Y.Z             the release tag, so the version pair is checked
                           against the tag and not only against Version.xcconfig
  --marketing-version X.Y.Z, --build-number N
                           the same two numbers, given directly
  --team-id ABCDE12345     the Apple Developer Team ID the ceremony signed for
                           (\$APPLE_TEAM_ID), so both signed entitlement values
                           are held against it. Omitted, the signed team is
                           reported as UNCHECKED rather than passed over. This
                           is the requested team, not the appID the published
                           apple-app-site-association pins
  --unsigned               the caller archived without a signing identity, so
                           the entitlement checks are reported as skipped rather
                           than failing. Never accepted at the export stage

Exit: 0 all checks passed, 1 the artifact is wrong, 2 it could not be read.

Expectations come from the pbxproj, Version.xcconfig, packages/core's URI parser
and the source Info.plist and App.entitlements. Nothing here is a pasted copy of
a rule, so moving a rule moves this with it.`;

async function main(argv) {
    const args = argv.slice(2);
    const { values, positional } = parseArgs(args);
    const artifact = positional[0];
    const stage = values.stage;

    if (values.help || args.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    // No args is a REFUSAL, not a question: exiting 0 there would let a caller
    // that lost its arguments read "nothing was checked" as "everything passed".
    if (!artifact || !stage) {
        console.error(
            'usage: verify-ios-artifact.mjs <App.app|*.ipa> --stage archive|export\n'
            + '           [--tag vX.Y.Z] [--marketing-version X.Y.Z] [--build-number N]\n'
            + '           [--team-id ABCDE12345] [--unsigned]',
        );
        return 2;
    }
    if (!existsSync(artifact)) {
        console.error(`verify-ios-artifact: nothing at ${artifact}`);
        return 2;
    }

    const scratch = mkdtempSync(join(tmpdir(), 'xc-ios-verify-'));
    try {
        const derived = values.tag ? await versionsFromTag(values.tag) : {};
        const appDir = locateApp(artifact, scratch);
        const info = readPlist(join(appDir, 'Info.plist'));
        const entitlements = readEntitlements(appDir, scratch);
        const profile = stage === 'export' ? readProfile(appDir, scratch) : undefined;

        const { expected, versionSource } = resolveVersionExpectations(
            readExpectations(), values['marketing-version'], values['build-number']);

        const { failures, passes } = runChecks({
            info,
            entitlements,
            profile,
            stage,
            expected,
            versionSource,
            unsigned: values.unsigned === true,
            teamId: values['team-id'],
            taggedVersion: values['marketing-version'] ?? derived.taggedVersion,
            taggedBuild: values['build-number'] ?? derived.taggedBuild,
        });

        for (const p of passes) console.log(`  ok  ${p}`);
        if (failures.length > 0) {
            // GitHub renders `::error::` as an annotation on the failing step;
            // anywhere else it is noise.
            const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
            console.error(`\n${failures.length} artifact check(s) failed on ${basename(artifact)} (${stage}):\n`);
            for (const f of failures) console.error(`  ${annotate}${f}\n`);
            return 1;
        }
        console.log(`\nall ${stage}-stage checks passed on ${basename(artifact)}`);
        return 0;
    } catch (err) {
        // Exit 2, never 1: "the artifact is wrong" and "this could not look at
        // the artifact" are different answers, and a caller that cannot tell
        // them apart eventually reads the second as the first.
        console.error(`verify-ios-artifact: could not read ${basename(artifact)}: ${err.message}`);
        return 2;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv));
}
