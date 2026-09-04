// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2 / Step 19 (piece 5d): electron-builder packaging,
// Level-2 reproducible pre-signing artifact, URI scheme registration,
// and electron-updater wiring (§40.12, §51).
//
// Coverage:
//
//   1. File layout: electron-builder.config.cjs + Dockerfile +
//      scripts/{build,reproduce}.sh + build/entitlements.mac.plist +
//      vite.config.js + main/{protocol,updater}.js
//      all exist.
//
//   2. electron-builder config:
//      - Loads cleanly as CommonJS.
//      - appId / productName set; `protocols` declares Tier-1
//        (xchain) + Tier-2 (bitcoin/litecoin/dogecoin) schemes.
//      - asar true; npmRebuild false; buildDependenciesFromSource false
//        (all reproducibility-critical flags).
//      - mac / win / linux targets present with expected shape.
//      - Signing fields are env-var-driven: mac.identity is the team
//        qualifier whenever a certificate was supplied, and null only
// when one was not.
//      - publish is electron-updater generic provider pointing at
//        downloads.xchain.io.
//
//   3. Protocol module:
//      - TIER_1_SCHEME = 'xchain'; TIER_2_SCHEMES = [bitcoin, litecoin,
//        dogecoin]; ALL_SCHEMES = union.
//      - `registerProtocolClients` calls setAsDefaultProtocolClient
//        for Tier 1 always; for Tier 2 only when opted in.
//      - `classifyDeepLink` parses `xchain:` URIs (parsed: null,
//        renderer decodes), BIP21 coin URIs (parsed: {address, amount,
//        …}), and rejects unknown schemes.
//      - `attachDeepLinkHandlers` rejects bad onDeepLink.
//
//   4. Updater module:
//      - `attachUpdater` validates deps, short-circuits in dev mode,
//        forwards events correctly in prod mode, handles missing
//        autoUpdater on loaded module.
//
//   5. main/index.js wires everything:
//      - Imports from protocol.js + updater.js.
//      - Calls registerProtocolClients + attachDeepLinkHandlers +
//        attachUpdater on app ready.
//
//   6. Dockerfile + scripts hygiene: pnpm version pinning via
//      packageManager field; SOURCE_DATE_EPOCH handling; reproduce.sh
//      is executable.
//
//   7. CSP: renderer/index.html allow-lists connect.trezor.io in
//      script-src (hosted Trezor Connect global build, loaded instead
//      of bundling T-RSL @trezor/connect-web) + frame-src (its signing
//      iframe); connect-src stays 'self'.
//
//   8. The hosted desktop reproducible-build recipe has its key sections.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';

import {
    TIER_1_SCHEME,
    TIER_2_SCHEMES,
    ALL_SCHEMES,
    registerProtocolClients,
    updateCoinSchemeOptIn,
    classifyDeepLink,
    attachDeepLinkHandlers,
} from '../../../packages/desktop/main/protocol.js';
import { attachUpdater } from '../../../packages/desktop/main/updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const requireCjs = createRequire(import.meta.url);

// --- 1. File layout ---------------------------------------------------

for (const rel of [
    'electron-builder.config.cjs',
    'vite.config.js',
    'Dockerfile',
    '.dockerignore',
    'scripts/build.sh',
    'scripts/reproduce.sh',
    'build/entitlements.mac.plist',
    'build/README.md',
    'main/protocol.js',
    'main/updater.js',
]) {
    assert.ok(existsSync(join(desktop, rel)), `packaging scaffold has ${rel}`);
}

// --- 2. electron-builder config ---------------------------------------

const configPath = join(desktop, 'electron-builder.config.cjs');

// The signing fields are computed at module load from the environment, so a
// cached copy tests whatever the shell happened to export. Every identity
// assertion below names the environment it is asserting about.
function loadConfig(env = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    delete requireCjs.cache[requireCjs.resolve(configPath)];
    try {
        return requireCjs(configPath);
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        delete requireCjs.cache[requireCjs.resolve(configPath)];
    }
}

const NO_SIGNING_ENV = { CSC_IDENTITY_NAME: undefined, CSC_LINK: undefined, CSC_KEYCHAIN: undefined };

const config = requireCjs(configPath);

assert.equal(config.appId, 'io.xchain.wallet.desktop', 'appId is io.xchain.wallet.desktop');
assert.equal(config.productName, 'XChain Wallet', 'productName is XChain Wallet');
assert.equal(config.asar, true, 'asar packaging enabled');
// NOT "no native deps": there is one, and `pnpm install` inside the pinned
// container is what compiles it. npmRebuild is off so electron-builder does
// not invoke node-gyp AFTERWARDS, outside that toolchain. The old message
// said the opposite, which is what the next person greps for; the payload
// gate in tools/release/lib.sh exists precisely because a bundle that lost
// that addon reads as fine everywhere else.
assert.equal(
    config.npmRebuild,
    false,
    'npmRebuild disabled: the native addon is compiled by pnpm install inside the pinned '
    + 'container, so electron-builder must not rebuild it afterwards',
);
// And the premise is MEASURED rather than re-worded, against the committed
// lockfile so it reads the same on every host: if tiny-secp256k1 ever really
// does leave this tree, the flag's rationale changes and this line is where
// that gets noticed, instead of a comment quietly going stale again.
assert.match(
    readFileSync(join(wsRoot, 'pnpm-lock.yaml'), 'utf8'),
    /^ {2}tiny-secp256k1@/m,
    'tiny-secp256k1 is no longer in the lockfile. It is the native dependency the whole '
    + 'install-time-compile arrangement exists for (npmRebuild off, the pinned container, '
    + 'the release payload gate that refuses a bundle shipping without the addon), so if it '
    + 'is gone those three things need re-deciding rather than inheriting.',
);
assert.equal(
    config.buildDependenciesFromSource,
    false,
    'buildDependenciesFromSource disabled: prebuilt Electron is a known trust anchor',
);

assert.ok(Array.isArray(config.protocols), 'protocols declared');
const declaredSchemes = new Set(config.protocols.flatMap((p) => p.schemes));
assert.ok(declaredSchemes.has('xchain'), 'electron-builder declares xchain scheme');
assert.ok(declaredSchemes.has('bitcoin'), 'electron-builder declares bitcoin scheme');
assert.ok(declaredSchemes.has('litecoin'), 'electron-builder declares litecoin scheme');
assert.ok(declaredSchemes.has('dogecoin'), 'electron-builder declares dogecoin scheme');

assert.ok(config.mac, 'mac target config present');
assert.equal(config.mac.hardenedRuntime, true, 'macOS hardenedRuntime enabled');
assert.equal(
    config.mac.entitlements,
    'build/entitlements.mac.plist',
    'macOS entitlements point at build/entitlements.mac.plist',
);

// --- The signed app has to be able to START (row 143) ----------
//
// THIS SHIPPED. `com.apple.security.cs.allow-jit` was false, on a comment
// that said "We don't JIT any code" - and Electron is V8, which does. A
// hardened-runtime build without it cannot reserve executable memory and
// dies before a line of our code runs: "Fatal process out of memory:
// Failed to reserve virtual memory for CodeRange". Measured on the
// PUBLISHED v0.338.0 .dmg, and proven by flipping only this entitlement
// on that same bundle, after which it boots.
//
// NOTHING ELSE IN THIS SUITE CAN SEE IT, which is the reason for a
// file-level assertion rather than a behavioural one: every test that
// launches the app runs it unsigned out of the source tree, where the
// hardened runtime does not apply, so the app under test is not the app
// users get. The behavioural check needs a signed, packaged bundle and
// belongs in the release lane.
{
    const entitlements = readFileSync(join(desktop, 'build/entitlements.mac.plist'), 'utf8');
    const valueFor = (key) => {
        const m = entitlements.match(new RegExp(`<key>${key}</key>\\s*<(true|false)/>`));
        return m ? m[1] : null;
    };
    assert.equal(
        valueFor('com.apple.security.cs.allow-jit'),
        'true',
        'the hardened runtime must allow JIT: without it the signed app cannot start at all',
    );
    assert.equal(
        valueFor('com.apple.security.cs.allow-unsigned-executable-memory'),
        'false',
        'the wider of the two memory entitlements stays off: allow-jit alone was proven sufficient',
    );
}
// --- The direct-download signing identity -------------------
//
// `mac.identity` was `CSC_IDENTITY_NAME || null`, and the only non-null
// source of it anywhere was one env line in each of release.yml's two
// Developer-ID steps. app-builder-lib's `macPackager.sign` tests
// `qualifier === null` and returns BEFORE it looks at CSC_LINK and before
// `notarizeIfProvided`, so deleting either line signed nothing, notarized
// nothing, exited 0, and shipped correctly named installers that Gatekeeper
// blocks on every user's machine. guards the workflow lines; these
// assert the config no longer depends on them.
assert.equal(
    loadConfig(NO_SIGNING_ENV).mac.identity,
    null,
    'mac.identity is null when no certificate was supplied: unsigned dev builds stay quiet',
);
assert.equal(
    loadConfig({ ...NO_SIGNING_ENV, CSC_LINK: 'base64-p12' }).mac.identity,
    'Dankest, LLC',
    'a build handed a certificate via CSC_LINK signs under the team qualifier with no CSC_IDENTITY_NAME set at all',
);
assert.equal(
    loadConfig({ ...NO_SIGNING_ENV, CSC_KEYCHAIN: '/tmp/xchain-devid.keychain' }).mac.identity,
    'Dankest, LLC',
    'a certificate pre-imported into a keychain resolves the same qualifier, for a local Developer-ID rehearsal',
);
assert.equal(
    loadConfig({ ...NO_SIGNING_ENV, CSC_LINK: 'base64-p12', CSC_IDENTITY_NAME: 'Some Other Org' }).mac.identity,
    'Some Other Org',
    'CSC_IDENTITY_NAME still overrides the default for a differently-named signer',
);
assert.ok(
    !/^Developer ID/.test(loadConfig({ ...NO_SIGNING_ENV, CSC_LINK: 'base64-p12' }).mac.identity),
    'mac.identity is a qualifier, not a certificate name: `_findIdentity` matches it with line.includes()',
);
assert.ok(
    Array.isArray(config.mac.target) && config.mac.target.some((t) => t.target === 'dmg'),
    'macOS dmg target configured',
);

// --- The disk image is signed and notarized too (row 140) ------
//
// v0.338.0 published a .dmg containing a signed, notarized, stapled app
// inside a container `codesign` called "not signed at all", because
// dmg-builder signs the image only on `sign === true` and the default is
// false. These two assertions pin the trigger to the same value the app's
// own signing uses, so the two cannot drift into a signed bundle inside an
// unsigned image again.
assert.equal(
    loadConfig({ ...NO_SIGNING_ENV, CSC_LINK: 'base64-p12' }).dmg.sign,
    true,
    'a build with a certificate signs the disk image, not only the app inside it',
);
assert.equal(
    loadConfig(NO_SIGNING_ENV).dmg.sign,
    false,
    'an unsigned dev build leaves the image unsigned rather than failing on a missing identity',
);
{
    const { shouldNotarize } = requireCjs(join(here, '../../../packages/desktop/scripts/notarize-dmg.cjs'));
    // The trigger is the same pair `mac.notarize` uses. A build that
    // signs but cannot notarize is the case that shipped the warning, so
    // it must not read as a decision to skip.
    assert.equal(
        shouldNotarize({ platform: 'darwin', identity: 'Dankest, LLC', env: { APPLE_API_KEY_ID: 'K' } }).notarize,
        true,
        'identity plus App Store Connect credentials notarizes the image',
    );
    assert.equal(
        shouldNotarize({ platform: 'darwin', identity: 'Dankest, LLC', env: {} }).notarize,
        false,
        'no credentials is the dev case: quiet, and the release gate is what refuses it',
    );
    assert.equal(
        shouldNotarize({ platform: 'linux', identity: 'Dankest, LLC', env: { APPLE_API_KEY_ID: 'K' } }).notarize,
        false,
        'notarytool and stapler do not exist off macOS',
    );
}

assert.ok(config.win, 'win target config present');

// electron-builder v26 moved signtool settings into `win.signtoolOptions`
// (stage 2). Read from whichever signing block this build selected:
// with Azure env vars set the config emits `azureSignOptions` instead, and
// the two are mutually exclusive. Both carry publisherName, because it is
// what electron-updater matches an update's publisher against.
const winSigning = config.win.signtoolOptions || config.win.azureSignOptions;
assert.ok(winSigning, 'a Windows signing block is configured');
assert.equal(winSigning.publisherName, 'Dankest, LLC', 'Windows publisherName set');
if (config.win.signtoolOptions) {
    assert.ok(
        config.win.signtoolOptions.rfc3161TimeStampServer,
        'Windows RFC 3161 timestamp server pinned (signatures survive cert expiry)',
    );
}

assert.ok(config.linux, 'linux target config present');
assert.ok(
    Array.isArray(config.linux.target)
        && config.linux.target.some((t) => t.target === 'AppImage')
        && config.linux.target.some((t) => t.target === 'deb'),
    'Linux AppImage + deb targets configured',
);

// --- The three settings without which the Linux lane cannot build -----
//
// None of these was set, and the lane had never been run to find out: CI
// is not configured, and the reproduce container uses `--dir`, which
// Packages nothing. Running a real packaged build (2026-08-01)
// failed three times in a row, each time on a different one of these.
// `*.AppImage` and `*.deb` are REQUIRED rows in expected-artifacts.txt,
// so each of these is a launch blocker for Linux, not a nicety.
{
    // 1. electron-builder derives the Linux executable name from the
    //    package.json `name`, not productName. Ours is a scoped package,
    //    so the default sanitizes to `@xchain-walletdesktop` and the
    //    AppImage builder rejects it outright.
    const exe = config.linux.executableName;
    assert.ok(typeof exe === 'string' && exe.length > 0,
        'linux.executableName must be set explicitly: the default comes from the '
        + 'package.json name (@xchain-wallet/desktop), which sanitizes to '
        + '@xchain-walletdesktop and fails the AppImage build on every arch.');
    assert.ok(/^[a-z0-9][a-z0-9._-]*$/.test(exe),
        `linux.executableName "${exe}" must be lowercase alphanumerics, dots, `
        + 'hyphens and underscores only. AppImage rejects anything else in a file '
        + 'path, and Debian rejects it in a package name.');

    // 2. fpm refuses to build a .deb without a homepage, and
    //    electron-builder's v26 schema refuses `homepage` in the build
    //    config, so it has to be app metadata.
    const appPkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
    assert.ok(/^https:\/\/\S+$/.test(appPkg.homepage || ''),
        'packages/desktop/package.json needs an https homepage; without it fpm fails '
        + 'with "Please specify project homepage" and the .deb is never produced.');

    // 3. The default deb artifact name interpolates the package name and
    //    therefore contained a SLASH, so electron-builder wrote
    //    dist/@xchain-wallet/desktop_<v>_amd64.deb - into a subdirectory
    //    that publish.sh and expected-artifacts.txt never look in. That
    //    loses the artifact quietly rather than failing the release.
    const debName = config.deb && config.deb.artifactName;
    assert.ok(typeof debName === 'string' && debName.length > 0,
        'deb.artifactName must be pinned; the default embeds the scoped package name.');
    assert.ok(!/[/\s]/.test(debName),
        `deb.artifactName "${debName}" must contain no slash and no whitespace: a slash `
        + 'writes the package into a subdirectory nothing enumerates.');
}

assert.ok(Array.isArray(config.publish), 'publish config is an array');
assert.equal(config.publish[0].provider, 'generic', 'electron-updater generic provider');
assert.match(
    config.publish[0].url,
    /^https:\/\/downloads\.xchain\.io\//,
    'update URL points at downloads.xchain.io over HTTPS',
);

// --- 3. Protocol module -----------------------------------------------

assert.equal(TIER_1_SCHEME, 'xchain');
assert.deepEqual([...TIER_2_SCHEMES], ['bitcoin', 'litecoin', 'dogecoin']);
assert.deepEqual(
    [...ALL_SCHEMES],
    ['xchain', 'bitcoin', 'litecoin', 'dogecoin'],
    'ALL_SCHEMES = Tier 1 + Tier 2',
);

{
    const fakeApp = makeFakeApp();
    registerProtocolClients(fakeApp, { optedInSchemes: [] });
    assert.deepEqual(
        fakeApp.claimed,
        new Set(['xchain']),
        'no opt-in → only xchain claimed',
    );
    assert.ok(
        fakeApp.removed.has('bitcoin')
            && fakeApp.removed.has('litecoin')
            && fakeApp.removed.has('dogecoin'),
        'coin schemes proactively removed when not opted in',
    );
}

{
    const fakeApp = makeFakeApp();
    registerProtocolClients(fakeApp, { optedInSchemes: ['bitcoin'] });
    assert.ok(fakeApp.claimed.has('xchain'), 'xchain always claimed');
    assert.ok(fakeApp.claimed.has('bitcoin'), 'opted-in bitcoin claimed');
    assert.ok(!fakeApp.claimed.has('litecoin'), 'un-opted litecoin not claimed');
    assert.ok(fakeApp.removed.has('litecoin'), 'un-opted litecoin removed');
}

{
    // updateCoinSchemeOptIn is just an alias for the same path; sanity check.
    const fakeApp = makeFakeApp();
    updateCoinSchemeOptIn(fakeApp, ['dogecoin']);
    assert.ok(fakeApp.claimed.has('xchain'), 'xchain still always claimed');
    assert.ok(fakeApp.claimed.has('dogecoin'), 'dogecoin opted in');
}

// registerProtocolClients validates its input.
assert.throws(
    () => registerProtocolClients(null, {}),
    /invalid Electron app handle/,
    'registerProtocolClients rejects null app',
);

// classifyDeepLink covers the four schemes + rejects junk.
assert.equal(classifyDeepLink(''), null, 'empty string → null');
assert.equal(classifyDeepLink('http://example.com'), null, 'unknown scheme → null');
assert.equal(classifyDeepLink('not a url at all'), null, 'non-URI → null');

{
    // §47.4 / G145: `xchain:` URIs are now parsed via `parseXchainUri`
    // and `parsed` carries the intent shape instead of being null. The
    // renderer can act on the structured intent directly. A malformed
    // URI still falls back to `parsed: null` (covered below).
    const e = classifyDeepLink('xchain:broadcast?data=abc');
    assert.equal(e.scheme, 'xchain');
    assert.equal(e.raw, 'xchain:broadcast?data=abc');
    assert.ok(e.parsed && e.parsed.kind, 'xchain: URIs surface a structured intent');
    assert.equal(e.parsed.kind, 'send');
    assert.equal(e.parsed.address, 'broadcast');
    assert.equal(e.parsed.params.data, 'abc');
}

{
    const e = classifyDeepLink(
        'bitcoin:bc1qaddress?amount=0.01&label=Test',
    );
    assert.equal(e.scheme, 'bitcoin');
    assert.equal(e.parsed.address, 'bc1qaddress');
    assert.equal(e.parsed.amount, '0.01');
    assert.equal(e.parsed.label, 'Test');
}

{
    // Malformed BIP21 → parsed:null, raw preserved.
    const e = classifyDeepLink('litecoin:?amount=0.5');
    assert.equal(e.scheme, 'litecoin');
    assert.equal(e.parsed, null, 'malformed BIP21 surfaces as parsed:null');
    assert.equal(e.raw, 'litecoin:?amount=0.5', 'raw URI preserved for debugging');
}

assert.throws(
    () => attachDeepLinkHandlers(makeFakeApp(), { onDeepLink: null }),
    /onDeepLink must be a function/,
    'attachDeepLinkHandlers rejects bad callback',
);

// --- 4. Updater module ------------------------------------------------

{
    const events = [];
    const ctx = await attachUpdater({
        loader: async () => ({
            autoUpdater: {
                isUpdaterActive() { return false; },
                checkForUpdates() { throw new Error('should not be called in dev'); },
                on() { throw new Error('should not register in dev'); },
            },
        }),
        onEvent: (e) => events.push(e),
    });
    assert.equal(ctx.isActive, false, 'updater short-circuits in dev mode');
    await ctx.checkForUpdates();  // no-op
    assert.deepEqual(events, [], 'no events fire in dev mode');
}

{
    // Prod-mode: collect event forwarding + error handling.
    const listeners = {};
    let checkCount = 0;
    const fakeAutoUpdater = {
        autoDownload: true,  // overwritten by attachUpdater
        isUpdaterActive() { return true; },
        on(evt, fn) { listeners[evt] = fn; },
        async checkForUpdates() { checkCount += 1; },
    };
    const events = [];
    const ctx = await attachUpdater({
        loader: async () => ({ autoUpdater: fakeAutoUpdater }),
        onEvent: (e) => events.push(e),
    });
    assert.equal(ctx.isActive, true, 'updater active when isUpdaterActive returns true');
    assert.equal(fakeAutoUpdater.autoDownload, false, 'autoDownload forced off');

    // Fire each event type + confirm forwarding.
    listeners['checking-for-update']();
    listeners['update-available']({ version: '1.0.0' });
    listeners['update-not-available']({});
    listeners['download-progress']({ percent: 50 });
    listeners['update-downloaded']({ version: '1.0.0' });
    listeners['error'](new Error('boom'));

    assert.deepEqual(
        events.map((e) => e.type),
        ['checking', 'available', 'not-available', 'progress', 'downloaded', 'error'],
        'updater events forwarded in the right sequence + shape',
    );
    assert.equal(events[5].info.message, 'boom', 'error info carries message');

    await ctx.checkForUpdates();
    assert.equal(checkCount, 1, 'checkForUpdates invokes autoUpdater.checkForUpdates');
}

// attachUpdater validates inputs.
await assert.rejects(
    attachUpdater({ onEvent: null }),
    /onEvent must be a function/,
);
await assert.rejects(
    attachUpdater({
        loader: async () => ({ /* no autoUpdater */ }),
        onEvent: () => {},
    }),
    /does not expose autoUpdater\.checkForUpdates/,
);

// --- 5. main/index.js wires everything --------------------------------

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
assert.ok(
    /from ['"]\.\/protocol\.js['"]/.test(mainIndex),
    'main/index.js imports ./protocol.js',
);
assert.ok(
    /from ['"]\.\/updater\.js['"]/.test(mainIndex),
    'main/index.js imports ./updater.js',
);
assert.ok(
    /registerProtocolClients\(app/.test(mainIndex),
    'main/index.js calls registerProtocolClients on app.whenReady',
);
assert.ok(
    /attachDeepLinkHandlers\(app/.test(mainIndex),
    'main/index.js calls attachDeepLinkHandlers',
);
assert.ok(
    /attachUpdater\(\{/.test(mainIndex),
    'main/index.js calls attachUpdater',
);
assert.ok(
    /requestSingleInstanceLock|gotLock/.test(mainIndex),
    'main/index.js respects the single-instance lock',
);
// Renderer bundle is what loads (not renderer/index.html source). Said in
// two halves since §9.3.2 made that directory the trust root too: the
// window loads APP_ROOT/index.html and APP_ROOT is renderer/dist.
assert.ok(
    /const APP_ROOT = join\(here, ['"]\.\.['"], ['"]renderer['"], ['"]dist['"]\)/.test(mainIndex),
    'main/index.js pins APP_ROOT to renderer/dist (packaged output)',
);
assert.ok(
    /loadFile\(join\(APP_ROOT, ['"]index\.html['"]\)/.test(mainIndex),
    'mainWindow.loadFile points at APP_ROOT/index.html, the dir the trust predicates use',
);

// --- 6. Dockerfile + scripts hygiene ----------------------------------

const dockerfile = readFileSync(join(desktop, 'Dockerfile'), 'utf8');
assert.ok(
    /@sha256:[a-f0-9]{64}/.test(dockerfile),
    'Dockerfile pins base image by digest (not tag)',
);
assert.ok(
    /NODE_VERSION=\d/.test(dockerfile),
    'Dockerfile pins NODE_VERSION',
);
// Arch-suffixed: the container is amd64-only (matching the
// amd64 release runner it must produce identical bytes to), and the hash
// is per tarball. That the value agrees with tools/release/toolchain.json
// and with the release lanes is a separate, stricter check in
// test/smoke/audits/reproducible-toolchain.smoke.js; this one only cares
// that the download is integrity-checked at all.
assert.ok(
    /NODE_SHA256_X64=[a-f0-9]{64}/.test(dockerfile),
    'Dockerfile pins NODE_SHA256_X64 (Node tarball integrity)',
);
assert.ok(
    /ARG PNPM_VERSION/.test(dockerfile),
    'Dockerfile takes PNPM_VERSION as build arg (sourced from packageManager field)',
);
assert.ok(
    /USER builder/.test(dockerfile),
    'Dockerfile runs as non-root user (UID mapping in reproduce.sh)',
);

const buildSh = readFileSync(join(desktop, 'scripts', 'build.sh'), 'utf8');
assert.ok(
    /set -euo pipefail/.test(buildSh),
    'build.sh uses strict mode',
);
assert.ok(
    /SOURCE_DATE_EPOCH/.test(buildSh),
    'build.sh requires SOURCE_DATE_EPOCH',
);
assert.ok(
    /--frozen-lockfile/.test(buildSh),
    'build.sh runs pnpm install --frozen-lockfile',
);
assert.ok(
    /sha256sum/.test(buildSh),
    'build.sh emits a SHA256 manifest',
);

const reproduceSh = readFileSync(join(desktop, 'scripts', 'reproduce.sh'), 'utf8');
// This assertion used to read `%ct` while its own message said "author
// date", so it pinned the defect in place and described it as the fix.
// %ct is the COMMITTER date and diverges from %at on any rebase or
// amend; the release lane injects %at, so the two sides stamped
// different mtimes into the asar and the reproduction could not match
//The version pin lives in tools/release/toolchain.json and
// reproducible-toolchain.smoke.js holds both sides to it.
assert.ok(
    /git log -1 --pretty=%at/.test(reproduceSh),
    'reproduce.sh derives SOURCE_DATE_EPOCH from the commit author date (%at), '
    + 'the same field the release lane uses',
);
assert.ok(
    /git worktree add/.test(reproduceSh),
    'reproduce.sh uses a git worktree (isolates from local changes)',
);
assert.ok(
    /--user "\$\(id -u\):\$\(id -g\)"/.test(reproduceSh),
    'reproduce.sh passes --user for host-UID file ownership',
);

// scripts are executable.
for (const rel of ['scripts/build.sh', 'scripts/reproduce.sh']) {
    const stat = statSync(join(desktop, rel));
    assert.ok((stat.mode & 0o111) !== 0, `${rel} is executable`);
}

// --- 7. Renderer CSP ---------------------------------------------------

const html = readFileSync(join(desktop, 'renderer', 'index.html'), 'utf8');
const cspMatch = html.match(/Content-Security-Policy[^>]*content="([^"]+)"/);
assert.ok(cspMatch, 'renderer/index.html declares CSP via meta tag');
const csp = cspMatch[1];

// PARSED, not substring-matched. Every assertion below used to be a /regex/
// against the raw policy text, and a regex cannot tell `script-src 'self'
// https://connect.trezor.io` from the same directive with an attacker origin
// appended: the documented prefix still matches, so a widened renderer CSP
// shipped green. Splitting the policy into directive -> sources and comparing
// source-for-source is the only form of this check that can fail.
const rendererCsp = Object.fromEntries(
    csp
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const [name, ...sources] = part.split(/\s+/);
            return [name, sources];
        }),
);

// Written out rather than read back from index.html, which would be the file
// checking itself. The renderer's policy is hand-maintained (the web shell's
// comes from packages/web/src/csp.js), so this literal is its only reviewer.
const EXPECTED_RENDERER_CSP = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://connect.trezor.io'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'"],
    'frame-src': ['https://connect.trezor.io'],
};

assert.deepEqual(
    Object.keys(rendererCsp).sort(),
    Object.keys(EXPECTED_RENDERER_CSP).sort(),
    'renderer CSP declares exactly the expected directives (a dropped one falls back to default-src)',
);
for (const [name, sources] of Object.entries(EXPECTED_RENDERER_CSP)) {
    assert.deepEqual(
        rendererCsp[name],
        sources,
        `renderer CSP ${name} must be exactly [${sources.join(' ')}];`
        + ` got [${(rendererCsp[name] ?? []).join(' ')}]`,
    );
}

// The two allowances that are deliberate, restated so the deepEqual above is
// read as a decision rather than as whatever the file happened to say:
// connect.trezor.io is allowed in script-src and frame-src for the hosted
// Trezor Connect build and its signing iframe (no bundled @trezor/*), and
// connect-src stays 'self' because the wallet's own code never fetches from it.

// --- 8. The desktop reproducible-build recipe -------------------------
//
// a later change moved it out of this package and into the sibling
// xchain-documentation checkout, where it is the "Desktop" section of
// components/wallet/reproducible-builds.md. The recipe is still what the
// scripts in this package are checked against, so the assertion followed it
// across; it skips loudly when that checkout is absent.

if (docsAvailable()) {
    const reproDoc = readDoc('reproducible-builds.md');
    const at = reproDoc.indexOf('## Desktop (`@xchain-wallet/desktop`)');
    assert.notEqual(at, -1, 'the reproducible-builds doc has a Desktop section');
    const rest = reproDoc.slice(at);
    const end = rest.slice(1).search(/\n## /);
    const rb = end === -1 ? rest : rest.slice(0, end + 1);
    for (const heading of [
        "What's reproducible",
        "What's not reproducible",
        'Verification protocol',
        'Update trust chain',
        'Trezor Connect trust boundary',
        'Per-release checklist',
    ]) {
        assert.ok(rb.includes(heading), `the Desktop repro section has heading: ${heading}`);
    }
    // The shared non-determinism floor moved up to a document-level section
    // when the four per-shell docs merged, so it is checked on the page
    // rather than inside the Desktop section.
    assert.ok(reproDoc.includes('Non-determinism sources addressed across every shell'),
        'the reproducible-builds doc keeps its shared non-determinism section');
} else {
    console.log('SKIP (partial): desktop-packaging smoke - the reproducible-build recipe half needs the '
        + `sibling xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

// --- Helpers ----------------------------------------------------------

function makeFakeApp() {
    const claimed = new Set();
    const removed = new Set();
    return {
        setAsDefaultProtocolClient(scheme) {
            claimed.add(scheme);
            removed.delete(scheme);
            return true;
        },
        removeAsDefaultProtocolClient(scheme) {
            removed.add(scheme);
            claimed.delete(scheme);
            return true;
        },
        requestSingleInstanceLock() { return true; },
        on(_evt, _fn) { /* noop */ },
        claimed,
        removed,
    };
}

console.log(
    'OK: desktop packaging smoke (Step 19 §40.12 / §51: electron-builder config (appId, protocols, asar, reproducibility flags, mac/win/linux targets, env-driven signing, electron-updater generic provider at downloads.xchain.io); Tier-1/Tier-2 URI scheme registration (xchain always, bitcoin/litecoin/dogecoin opt-in); BIP21 classification of coin URIs, xchain: pass-through, malformed URI handling; electron-updater wiring (dev-mode short-circuit, event forwarding, error handling); main/index.js delegates to protocol.js + updater.js; Dockerfile with digest-pinned base + SHA256-pinned Node + UID-mapped user; build.sh + reproduce.sh with SOURCE_DATE_EPOCH derivation + frozen lockfile + SHA256 manifest; CSP frame-src allowlists connect.trezor.io; the hosted desktop repro recipe documents the verification protocol)',
);
