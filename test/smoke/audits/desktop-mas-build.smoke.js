// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the Mac App Store universal build runs from the repo as it
// stands, with no hand step, and declares its export-compliance answer.
//
// WHAT THIS IS DEFENDING. The v0.343.0 store build needed two hand steps
// (recorded in that release's Mac App Store build notes):
//
//   - tiny-secp256k1/build, an arm64-only secp256k1.node a Mac install
//     compiles, was moved aside, because @electron/universal refuses an
//     arm64 Mach-O in the x64 half of a universal app. The package's
//     index.js falls back to its pure-JS implementation when the binding is
//     absent, which is what the store build ships. mas.files now leaves the
//     build directory out, for the store build only: the Linux packages
//     still ship the binding their install compiles.
//   - -c.mas.mergeASARs=false was passed by hand after glob 14 made
//     @electron/asar 3.4.1's promisified callback call never settle. The
//     ASAR subtree now stays on patched glob 7 and minimatch 3 lines. Keeping
//     the merge off remains a separate release configuration decision.
//
// And App Store Connect asks every macOS upload the export-compliance
// question that iOS answers in its Info.plist: ITSAppUsesNonExemptEncryption.
//
// Coverage:
//
//   1. The effective mas config (deepAssign(mac, mas), as app-builder-lib
//      computes it) declares ITSAppUsesNonExemptEncryption false, the same
//      value as the iOS Info.plist, and keeps the camera text it inherits.
//   2. mas.mergeASARs is false.
//   3. @electron/asar resolves callback-compatible glob and minimatch lines,
//      and its real crawl completes.
//   4. mas.files excludes tiny-secp256k1/build, matched with the same
//      minimatch app-builder-lib uses; no other platform excludes it.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const require = createRequire(import.meta.url);

// The mas target and its identity read these; scrub them so this file
// tests the config, not the caller's shell.
const OWNED_VARS = ['XCHAIN_BUILD_MAS', 'MAS_IDENTITY_NAME', 'MAS_PROVISIONING_PROFILE',
    'CSC_LINK', 'CSC_NAME', 'CSC_IDENTITY_NAME', 'XCHAIN_REQUIRE_MAC_SIGNING', 'XCHAIN_STAGING_FEED_URL'];
const saved = {};
for (const k of OWNED_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
const CONFIG = join(desktop, 'electron-builder.config.cjs');
delete require.cache[require.resolve(CONFIG)];
const config = require(CONFIG);
delete require.cache[require.resolve(CONFIG)];
for (const k of OWNED_VARS) { if (saved[k] !== undefined) process.env[k] = saved[k]; }

let libDir = null;
let asarDir = null;
try {
    const requireFromDesktop = createRequire(join(desktop, 'package.json'));
    const builderPkg = requireFromDesktop.resolve('electron-builder/package.json');
    libDir = dirname(createRequire(builderPkg).resolve('app-builder-lib/package.json'));
    asarDir = dirname(requireFromDesktop.resolve('@electron/asar/package.json'));
} catch {
    libDir = null;
    asarDir = null;
}
const requireFromLib = libDir ? createRequire(join(libDir, 'package.json')) : null;

// --- 1. Export compliance ---------------------------------------------

const iosPlist = readFileSync(join(wsRoot, 'packages', 'mobile', 'ios', 'App', 'App', 'Info.plist'), 'utf8');
const iosMatch = iosPlist.match(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<(true|false)\s*\/>/);
assert.ok(iosMatch, 'the iOS Info.plist declares ITSAppUsesNonExemptEncryption');
const iosValue = iosMatch[1] === 'true';

assert.equal(config.mas.extendInfo?.ITSAppUsesNonExemptEncryption, false,
    'mas.extendInfo declares ITSAppUsesNonExemptEncryption false');
assert.equal(config.mas.extendInfo.ITSAppUsesNonExemptEncryption, iosValue,
    'the Mac App Store build answers export compliance the way the iOS app does');
assert.equal(config.mac.extendInfo?.ITSAppUsesNonExemptEncryption, undefined,
    'the key is on the store build only; the Developer ID build has no export question');

let effectiveMas = null;
if (requireFromLib) {
    const { deepAssign } = requireFromLib('builder-util-runtime');
    effectiveMas = deepAssign({}, config.mac, config.mas);
} else {
    effectiveMas = { ...config.mac, ...config.mas,
        extendInfo: { ...config.mac.extendInfo, ...config.mas.extendInfo } };
}
assert.equal(effectiveMas.extendInfo.ITSAppUsesNonExemptEncryption, false,
    'the effective store Info.plist carries ITSAppUsesNonExemptEncryption false');
assert.equal(effectiveMas.extendInfo.NSCameraUsageDescription, config.mac.extendInfo.NSCameraUsageDescription,
    'the effective store Info.plist still carries the camera text it inherits from mac');

// --- 2. Store build retains the current merge setting --------------------

assert.equal(config.mas.mergeASARs, false,
    'mas.mergeASARs retains the v0.343.1 store-build setting');
assert.equal(config.mac.mergeASARs, undefined,
    'mergeASARs is set on the store build only (the direct-download builds are per-arch)');

// --- 3. The ASAR crawler keeps its callback-compatible dependency API -----

if (asarDir) {
    const requireFromAsar = createRequire(join(asarDir, 'package.json'));
    const globPkg = requireFromAsar('glob/package.json');
    const minimatchPkg = requireFromAsar('minimatch/package.json');
    assert.match(globPkg.version, /^7\./,
        '@electron/asar resolves callback-compatible glob 7');
    assert.match(minimatchPkg.version, /^3\./,
        '@electron/asar resolves its compatible minimatch 3 line');

    const { crawl } = requireFromAsar('./lib/crawlfs.js');
    const crawlResult = await Promise.race([
        crawl(join(desktop, 'build', '**', '*'), { nodir: false, dot: true }),
        new Promise((_, reject) => setTimeout(() => reject(
            new Error('@electron/asar crawl did not resolve within 5 seconds')), 5000).unref()),
    ]);
    assert.ok(crawlResult[0].some((file) => file.endsWith('entitlements.mas.plist')),
        '@electron/asar crawl resolves and finds the desktop build fixture');
}

// --- 4. The native binding stays out of the store build ------------------

const TINY_NODE = 'node_modules/tiny-secp256k1/build/Release/secp256k1.node';
const masFiles = Array.isArray(config.mas.files) ? config.mas.files : [];
const exclusions = masFiles.filter((p) => typeof p === 'string' && p.startsWith('!'));
assert.ok(exclusions.some((p) => p.includes('tiny-secp256k1/build')),
    'mas.files excludes tiny-secp256k1/build');
if (requireFromLib) {
    const { minimatch } = requireFromLib('minimatch');
    for (const rel of [TINY_NODE, 'node_modules/tiny-secp256k1/build',
        'node_modules/tiny-secp256k1/build/Makefile']) {
        assert.ok(exclusions.some((p) => minimatch(rel, p.slice(1), { dot: true })),
            `a mas.files exclusion matches ${rel}`);
    }
    for (const rel of ['node_modules/tiny-secp256k1/index.js', 'node_modules/tiny-secp256k1/js.js',
        'node_modules/tiny-secp256k1/package.json']) {
        assert.ok(!exclusions.some((p) => minimatch(rel, p.slice(1), { dot: true })),
            `no mas.files exclusion removes ${rel}, the pure-JS fallback the store build runs`);
    }
}
for (const where of ['files', 'mac', 'linux', 'win']) {
    const list = where === 'files' ? config.files : (config[where]?.files ?? []);
    assert.ok(!list.some((p) => typeof p === 'string' && p.includes('tiny-secp256k1')),
        `${where === 'files' ? 'the top-level files list' : `${where}.files`} keeps tiny-secp256k1's `
        + 'binding (the Linux packages ship the one their install compiles)');
}

console.log('OK: desktop MAS build smoke (ITSAppUsesNonExemptEncryption false as on iOS, '
    + 'camera text inherited, ASAR crawl resolves, mergeASARs setting retained, '
    + 'tiny-secp256k1/build excluded from the store build only)');
