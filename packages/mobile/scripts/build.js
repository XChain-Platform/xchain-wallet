// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The mobile shell's whole "build": stage the web shell's built SPA into the
// Capacitor webDir, then write the tag-derived version properties Gradle reads.
//
// There is no bundler here and there must not be one. The mobile shell wraps
// the SAME artifact the web shell ships (spec §1: "mobile is a wrapper, not a
// port"), so a second build of the SPA would be a second set of bytes to
// review, a second CSP to keep in step, and a place for the two shells to
// silently diverge. `packages/web/dist` is copied verbatim; `pnpm -r build`
// orders web before mobile because this package depends on it.
//
// Runs on any machine with Node 22: no JDK, no Android SDK, no Gradle. That
// matters because `pnpm -r --if-present build` runs in the ordinary CI test
// lane, where none of those exist; the native build lives in its own workflow.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { versionPropertiesFor, versionXcconfigFor } from './version.js';
import { PROFILE_STAMP_FILE, parseProfileStamp } from '../../web/buildProfile.js';

// The staged-bundle stamp. The same literal appears in
// `android/app/src/main/../build.gradle`, which cannot import this file;
// `test/smoke/shells/mobile-shell.smoke.js` fails if the two ever disagree.
const WEBDIR_STAMP_FILE = 'webdir-stamp.txt';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const webDist = join(pkgRoot, '..', 'web', 'dist');
const www = join(pkgRoot, 'www');
const versionProps = join(pkgRoot, 'android', 'version.properties');
const versionXcconfig = join(pkgRoot, 'ios', 'App', 'Version.xcconfig');

// The tag to number this build as. CI passes the pushed tag; a developer
// building locally gets the version in package.json, which is the same value
// the release tag will carry. Never a counter, never a timestamp: see
// version.js for why the number must be a property of the release.
const require = createRequire(import.meta.url);
const releaseTag = process.env.XCHAIN_RELEASE_TAG || '';
const tag = releaseTag || `v${require('../package.json').version}`;

if (!existsSync(join(webDist, 'index.html'))) {
    console.error(
        `@xchain-wallet/mobile: no built web SPA at ${webDist}.\n`
        + 'Build the web shell first (`pnpm --filter @xchain-wallet/web build`),'
        + ' or run `pnpm -r build` from the repo root.',
    );
    process.exit(1);
}

// Which feature set the bundle we are about to wrap was built with
// . This package compiles nothing: it copies the web
// dist verbatim, so the profile is a property of a build that already
// happened somewhere else, and the only honest way to know it is the stamp
// the web build wrote into the dist.
//
// Enforced for a RELEASE build and advisory otherwise. A contributor running
// `pnpm -r build` to get an APK onto a phone should not have to know this
// exists; a release that ships a `default` bundle inside an artifact the
// signed manifest labels `store` is the false claim the whole mechanism
// exists to prevent, and by then the number is spent.
const stampPath = join(webDist, PROFILE_STAMP_FILE);
const stagedProfile = existsSync(stampPath)
    ? parseProfileStamp(readFileSync(stampPath, 'utf8'))
    : null;

if (releaseTag && stagedProfile !== 'store') {
    console.error(
        `@xchain-wallet/mobile: refusing to stage a ${stagedProfile ?? 'unstamped'} web bundle`
        + ` into a release build of ${releaseTag}.\n`
        + 'Mobile store artifacts must carry the `store` profile. Rebuild the web shell with\n'
        + '  XCHAIN_BUILD_PROFILE=store pnpm --filter @xchain-wallet/web build\n'
        + 'and stage again. (An unstamped bundle is one whose profile nobody recorded,'
        + ' which is not the same as a default build.)',
    );
    process.exit(1);
}
if (!releaseTag && stagedProfile !== 'store') {
    console.warn(
        `@xchain-wallet/mobile: staging a ${stagedProfile ?? 'unstamped'} web bundle.`
        + ' Fine for local work; a release build refuses it.',
    );
}

// Replaced wholesale rather than merged: a stale asset left behind from an
// earlier build would be shipped inside the APK, and hashing the two trees
// against each other (test/smoke/shells/mobile-web-asset-parity.smoke.js) is
// only meaningful if this directory holds nothing the web build did not emit.
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(webDist, www, { recursive: true });

// A stamp naming exactly which bundle this is, so Gradle can refuse to package
// a DIFFERENT one (see WEBDIR_STAMP_FILE below and app/build.gradle).
//
// WHY THIS EXISTS. Staging into `www` does not put anything into the APK.
// Capacitor copies `www` to `android/app/src/main/assets/public` in a separate
// step (`cap copy android`), and Gradle packages whatever that directory
// happens to hold. Skip the copy and the build succeeds, the version is right,
// every source-level gate passes, and the APK ships the PREVIOUS web bundle.
// That is not hypothetical: it cost a build cycle on 2026-08-02, when a fix
// was reproduced as still-broken on an APK that contained it.
//
// The release ceremony runs `cap sync` and is not exposed to this. What is
// exposed is every hand-driven `./gradlew` - which is how a developer checks a
// change on a device, and therefore exactly where a wrong answer is most
// expensive.
writeFileSync(join(www, WEBDIR_STAMP_FILE), `${webDirStamp(www)}\n`);

// Both native halves are numbered from the one tag in the one place, so an
// iOS build and an Android build of a release can never disagree about which
// release they are. Written unconditionally: the Xcode project carries no
// literal version to fall back on, so a missing file is a visibly broken
// build rather than a silently misnumbered one.
mkdirSync(dirname(versionProps), { recursive: true });
writeFileSync(versionProps, versionPropertiesFor(tag));
mkdirSync(dirname(versionXcconfig), { recursive: true });
writeFileSync(versionXcconfig, versionXcconfigFor(tag));

console.log(`@xchain-wallet/mobile: staged ${webDist} -> www, versioned as ${tag}`);

/**
 * Content hash of a staged webDir, ignoring the stamp file itself.
 *
 * Content and not mtimes: `cap copy` rewrites timestamps, and two directories
 * that differ only in when they were written are the same bundle. Paths are
 * included and separators normalised so a moved or renamed file registers, and
 * the list is sorted so directory order never enters the answer.
 *
 * @param {string} dir
 * @returns {string} sha256 hex
 */
function webDirStamp(dir) {
    const entries = [];
    (function walk(current) {
        for (const item of readdirSync(current, { withFileTypes: true })) {
            const abs = join(current, item.name);
            if (item.isDirectory()) { walk(abs); continue; }
            const rel = relative(dir, abs).split(sep).join('/');
            if (rel === WEBDIR_STAMP_FILE) continue;
            entries.push(`${rel}:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
        }
    }(dir));
    entries.sort();
    return createHash('sha256').update(entries.join('\n')).digest('hex');
}
