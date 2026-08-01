// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE store integer, for both stores, derived from the release tag alone
// (rails spec claude/specs/wallet-release-rails.md §2 owns it; 
// reconciled the three copies that used to disagree).
//
//     storeVersion = MAJOR·10⁷ + MINOR·10⁴ + PATCH·10² + BUILD
//
// Android reads it as `versionCode`, iOS as `CFBundleVersion`. One number so
// the two shells cannot drift, and so a release's identity does not depend on
// which store you ask.
//
// WHY A FORMULA AND NOT A COUNTER. Play refuses a duplicate versionCode even
// on the internal track, so the number has to be stable for a given tag and
// different for the next one. A CI run counter or a timestamp gives you that
// only as long as one machine does every build: the release ceremony happens
// on the maintainer's release machine ( §6) while smoke artifacts come
// off a runner, and those two would disagree about what build 41 was. Deriving
// from the tag makes the number a property of the release rather than of the
// machine that built it, so the AAB, the APK and the ipa carry the same code
// and re-running a build changes nothing.
//
// WHY THE BUILD COMPONENT IS BANDED. Three kinds of upload share one semver
// and each needs its own integer, in this order:
//
//     v0.333.1-beta.1    build  1     3330101   beta lane, N in 1..49
//     v0.333.1-beta.2    build  2     3330102
//     v0.333.1           build 50     3330150   stable
//     v0.333.1-respin.1  build 51     3330151   respin lane, N in 1..49
//
// Betas MUST sort below the stable of the same version: Play will not let a
// closed-track tester move to a production build with a lower versionCode, and
// App Store Connect refuses a build number below one already in the train. So
// stable sits at 50 with a band on either side rather than at 0.
//
// A RESPIN is a re-upload of IDENTICAL SOURCE: a store rejected the binary
// over metadata, an upload burned itself in processing, a TestFlight build
// expired. Both stores spend a number on those attempts and neither gives it
// back, and forcing a public patch bump for them would put a version on the
// web and desktop shells that means nothing to a user. So the respin tag rides
// the same commit and, deliberately, does NOT change the user-visible version
// string: the integer moves, `0.333.1` stays `0.333.1`.
//
// A HOTFIX IS NOT A RESPIN and gets no suffix here: it changes code, so it
// bumps PATCH like any other release (rails §2). `-hotfix.N` is refused by
// name for that reason - it was a second mechanism for a thing the version
// scheme already had.
//
// The grammar is deliberately narrow: exactly `v?MAJOR.MINOR.PATCH` with at
// most one `-beta.N` or `-respin.N`. Anything else is refused rather than
// coerced, because every accepted spelling is a chance for two different tags
// to land on ONE integer, and the failure mode of that collision is a release
// you cannot upload (or, worse, one that silently overwrites the meaning of a
// shipped build). `v0.333.01` and `-beta.0` are refused for exactly that
// reason: they are second spellings of a number that already has one.
//
// Bounds come from Play's 2,100,000,000 ceiling: MAJOR ≤ 209 keeps the largest
// representable release (209.999.99-respin.49 → 2,099,999,999) under it.
// MINOR ≤ 999 and PATCH ≤ 99 are the field widths.

import { pathToFileURL } from 'node:url';

const TAG_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(beta|respin)\.(0|[1-9]\d*))?$/;

export const MAX_MAJOR = 209;
export const MAX_MINOR = 999;
export const MAX_PATCH = 99;

// The build component's bands. Stable is the midpoint so betas can sit below
// it and respins above, in one 0-99 field.
export const STABLE_BUILD = 50;
export const MAX_LANE_N = 49;

// Play's hard ceiling on versionCode.
export const PLAY_VERSION_CODE_CEILING = 2100000000;

// Parse a release tag into its fields. Throws on anything the grammar above
// does not accept; callers in the release path WANT the throw, since the
// alternative is shipping a build numbered by a guess.
export function parseTag(tag) {
    if (typeof tag !== 'string') {
        throw new TypeError(`release tag must be a string, got ${typeof tag}`);
    }
    const trimmed = tag.trim();

    // Named refusal rather than a generic parse error: `-hotfix.N` was this
    // field's old meaning, so a stale tag or a stale script deserves to be
    // told which rule replaced it instead of "unusable tag".
    if (/-hotfix\./.test(trimmed)) {
        throw new Error(
            `unusable release tag ${JSON.stringify(tag)}: a hotfix changes code, so it bumps`
            + ' PATCH (rails §2) rather than carrying a suffix. The only suffixes are'
            + ' -beta.N (pre-release) and -respin.N (re-upload of identical source).',
        );
    }

    const m = TAG_RE.exec(trimmed);
    if (!m) {
        throw new Error(
            `unusable release tag ${JSON.stringify(tag)}: expected vMAJOR.MINOR.PATCH,`
            + ' vMAJOR.MINOR.PATCH-beta.N or vMAJOR.MINOR.PATCH-respin.N,'
            + ' with no leading zeros',
        );
    }

    const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
    const lane = m[4] === undefined ? 'stable' : m[4];
    const laneN = m[5] === undefined ? 0 : Number(m[5]);

    // Lane 0 would be a second spelling of the stable number: exactly the
    // collision this grammar exists to prevent.
    if (lane !== 'stable' && laneN === 0) {
        throw new Error(
            `unusable release tag ${JSON.stringify(tag)}: -${lane}.0 is not a release;`
            + ` ${lane} numbering starts at 1`,
        );
    }
    if (laneN > MAX_LANE_N) {
        throw new RangeError(
            `release tag ${JSON.stringify(tag)}: ${lane} ${laneN} exceeds ${MAX_LANE_N},`
            + ' which the build component cannot represent',
        );
    }

    const bounds = [
        ['MAJOR', major, MAX_MAJOR],
        ['MINOR', minor, MAX_MINOR],
        ['PATCH', patch, MAX_PATCH],
    ];
    for (const [name, value, max] of bounds) {
        if (value > max) {
            throw new RangeError(
                `release tag ${JSON.stringify(tag)}: ${name} ${value} exceeds ${max},`
                + ' which the store-integer formula cannot represent',
            );
        }
    }

    const build = lane === 'beta' ? laneN
        : lane === 'respin' ? STABLE_BUILD + laneN
            : STABLE_BUILD;

    return { major, minor, patch, lane, laneN, build };
}

// The store integer for a tag: Android's versionCode and iOS's CFBundleVersion.
// Strictly increasing along a release sequence, and identical on every machine
// that builds that tag.
export function storeVersionFromTag(tag) {
    const { major, minor, patch, build } = parseTag(tag);
    return major * 10_000_000 + minor * 10_000 + patch * 100 + build;
}

// Android's name for the same number. Kept as its own export so the Gradle
// side reads in Play's vocabulary without a second formula existing.
export const versionCodeFromTag = storeVersionFromTag;

// The user-visible version string on Play. Beta identity is visible (testers
// should know they are on one); a respin is NOT, because it is the same
// software as the stable release it re-uploads and every other shell is
// already shipping that string.
export function versionNameFromTag(tag) {
    const { major, minor, patch, lane, laneN } = parseTag(tag);
    const base = `${major}.${minor}.${patch}`;
    return lane === 'beta' ? `${base}-beta.${laneN}` : base;
}

// The version string that goes in ARTIFACT NAMES, which is not the same
// question as what a store shows. A respin is invisible to users but must not
// be invisible in the file system: its aab/apk/ipa carry a different store
// integer from the stable release they re-upload, so naming both
// `xchain-wallet-android-v0.333.1.aab` would put two different files under one
// name, in two manifests, in an append-only record whose entire job is to say
// which bytes shipped. Every tag therefore gets its own artifact name.
export function artifactVersionFromTag(tag) {
    const { major, minor, patch, lane, laneN } = parseTag(tag);
    const base = `${major}.${minor}.${patch}`;
    return lane === 'stable' ? base : `${base}-${lane}.${laneN}`;
}

// iOS CFBundleShortVersionString. Apple accepts only dot-separated integers
// here, so the beta suffix Play shows has nowhere to live: on iOS the lane is
// carried by TestFlight and by the build number, never by this string.
export function marketingVersionFromTag(tag) {
    const { major, minor, patch } = parseTag(tag);
    return `${major}.${minor}.${patch}`;
}

// The tag as this module understands it, echoed into generated files so a
// stale one is readable at a glance. Canonical spelling, not the input: the
// leading `v` is always present and whitespace is gone.
export function canonicalTag(tag) {
    const { major, minor, patch, lane, laneN } = parseTag(tag);
    const base = `v${major}.${minor}.${patch}`;
    return lane === 'stable' ? base : `${base}-${lane}.${laneN}`;
}

// The `key=value` body Gradle reads (see android/app/build.gradle). Written as
// a file rather than passed as -P properties so a local `./gradlew` build and a
// CI build get their numbers from the same place.
export function versionPropertiesFor(tag) {
    return [
        '# Generated by packages/mobile/scripts/version.js - do not edit.',
        `# Derived from release tag ${canonicalTag(tag)} (rails §2).`,
        `versionCode=${storeVersionFromTag(tag)}`,
        `versionName=${versionNameFromTag(tag)}`,
        '',
    ].join('\n');
}

// The xcconfig Xcode reads, same role as version.properties on the Android
// side: generated, never committed, and the only place the iOS project gets a
// version from (the pbxproj carries no literal to fall back to).
export function versionXcconfigFor(tag) {
    return [
        '// Generated by packages/mobile/scripts/version.js - do not edit.',
        `// Derived from release tag ${canonicalTag(tag)} (rails §2).`,
        `MARKETING_VERSION = ${marketingVersionFromTag(tag)}`,
        `CURRENT_PROJECT_VERSION = ${storeVersionFromTag(tag)}`,
        '',
    ].join('\n');
}

// CLI: `node scripts/version.js v0.333.1` prints `<storeVersion> <versionName>`,
// which is what the ceremony and the CI workflow read. Exactly two fields, since
// both read it with a bare shell `read`; `--artifact` prints the artifact-name
// version alone rather than adding a third field that a two-variable `read`
// would silently glue onto the second. Kept here rather than in its own file so
// the printed numbers cannot drift from the exported ones.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const artifactOnly = args.includes('--artifact');
    const tag = args.find((a) => !a.startsWith('--'));
    if (!tag) {
        console.error('usage: node scripts/version.js <tag> [--artifact]   e.g. v0.333.1');
        process.exit(2);
    }
    try {
        console.log(artifactOnly
            ? artifactVersionFromTag(tag)
            : `${storeVersionFromTag(tag)} ${versionNameFromTag(tag)}`);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
