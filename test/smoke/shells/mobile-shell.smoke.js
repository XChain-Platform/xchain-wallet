// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the Capacitor mobile shell scaffold ( §11 stage S1).
//
// Everything here is a claim the Android build makes that NOTHING ELSE in
// this repo's CI can check: the native build needs a JDK and the Android SDK,
// which the test lane does not have, so these files would otherwise be
// reviewed once and then drift silently. Each assertion below is a decision
// with a paper trail, not a style preference:
//
//   1. Layout: the scaffold's files exist, and the native project is the one
//      Capacitor generates (gradlew, settings.gradle, manifest).
//   2. capacitor.config.json: applicationId = D1, webDir = the staged copy of
//      the web build, androidScheme = https. That last one is load-bearing:
//      under `http` the WebView origin is not a secure context, and the
//      wallet's KDF and AEAD are `crypto.subtle`, which simply is not there.
//   3. minSdkVersion = 26 (D2).
//   4. versionCode/versionName come from the generated version.properties,
//      never a literal and never a counter (§7).
//   5. Exactly one exported component (§1 deep-link invariant): a second
//      exported activity, receiver or service is an entry point into a wallet
//      that no unlock screen guards.
//   6. No Firebase/Play-Services wiring (§1, §9: push is a non-goal).
//   7. Keystores and the generated version file are ignored by git (K9/K10
//      custody, §4).
//   8. When both trees exist, the staged webDir is byte-identical to
//      packages/web/dist: the mobile shell ships the web shell's bytes or it
//      is not the same wallet.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const mobile = join(wsRoot, 'packages', 'mobile');
const android = join(mobile, 'android');

// --- 1. Layout --------------------------------------------------------

for (const rel of [
    'package.json',
    'capacitor.config.json',
    'README.md',
    'scripts/build.js',
    'scripts/version.js',
    'android/gradlew',
    'android/settings.gradle',
    'android/variables.gradle',
    'android/build.gradle',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
]) {
    assert.ok(existsSync(join(mobile, rel)), `mobile scaffold has ${rel}`);
}

const pkg = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8'));
assert.equal(pkg.name, '@xchain-wallet/mobile');
assert.equal(pkg.private, true, 'mobile package is private (never published to npm)');
// The dependency is what orders `pnpm -r build`: web's dist has to exist
// before this package can stage it.
assert.ok(
    pkg.dependencies['@xchain-wallet/web'],
    'mobile depends on the web shell so the SPA is built first',
);

// --- 2. Capacitor config ----------------------------------------------

const capConfig = JSON.parse(readFileSync(join(mobile, 'capacitor.config.json'), 'utf8'));
assert.equal(capConfig.appId, 'io.xchain.wallet.android',
    'D1 (revised 2026-07-31): every shell carries its own suffix under the io.xchain.wallet parent');
assert.equal(capConfig.webDir, 'www', 'webDir is the staged copy of the web build');
assert.equal(
    capConfig.server?.androidScheme,
    'https',
    'androidScheme https: crypto.subtle needs a secure context',
);
assert.equal(
    capConfig.android?.allowMixedContent,
    false,
    'mixed content refused in the WebView',
);
assert.deepEqual(
    capConfig.plugins,
    {},
    'no plugins registered yet: every registered plugin is reachable from any'
    + ' script in the WebView (§1 bridge boundary), so they arrive one at a'
    + ' time with the feature that needs them',
);

// --- 3 + 4. Gradle: SDK floor and tag-derived version -----------------

const variables = readFileSync(join(android, 'variables.gradle'), 'utf8');
assert.match(variables, /minSdkVersion\s*=\s*26\b/, 'D2: minSdkVersion is 26');

const appGradle = readFileSync(join(android, 'app', 'build.gradle'), 'utf8');
assert.match(
    appGradle,
    /applicationId "io\.xchain\.wallet\.android"/,
    'D1 in the Gradle config too',
);
assert.match(
    appGradle,
    /namespace = "io\.xchain\.wallet\.android"/,
    'the Java namespace tracks the applicationId; Capacitor generates the two'
    + ' together and a half-renamed project still compiles',
);
// The rename has to reach the source tree too, not just the Gradle strings: a
// stale package directory is exactly the kind of leftover that builds fine
// until an intent filter or a FileProvider authority stops resolving.
assert.ok(
    existsSync(join(
        android, 'app', 'src', 'main', 'java', 'io', 'xchain', 'wallet', 'android',
        'MainActivity.java',
    )),
    'MainActivity lives under the io.xchain.wallet.android package directory',
);
assert.ok(
    !existsSync(join(
        android, 'app', 'src', 'main', 'java', 'io', 'xchain', 'wallet', 'MainActivity.java',
    )),
    'no MainActivity left behind at the pre-rename package path',
);
assert.match(
    appGradle,
    /versionCode versionProps\['versionCode'\]/,
    'versionCode is read from version.properties',
);
assert.match(
    appGradle,
    /versionName versionProps\['versionName'\]/,
    'versionName is read from version.properties',
);
assert.doesNotMatch(
    appGradle,
    /^\s*versionCode\s+\d/m,
    'no literal versionCode: a number uploaded once is spent for the life of the app',
);
assert.match(
    appGradle,
    /throw new GradleException/,
    'a missing version.properties fails the build instead of defaulting',
);

// The formula is the contract between the tag and the store listing; assert it
// here as well as in the unit suite so the smoke lane alone would catch a
// change to it.
const { versionCodeFromTag } = await import(
    pathToFileURL(join(mobile, 'scripts', 'version.js')).href
);
// Stable sits at build 50, not 0: betas occupy 1-49 below it so a closed-track
// tester can be promoted to production, and respins 51-99 above (rails §2,
// , which superseded this spec's original stable-at-0 formula).
assert.equal(versionCodeFromTag('v0.333.1'), 3330150, 'rails §2 worked example');
assert.ok(
    versionCodeFromTag('v0.333.1-beta.1') < versionCodeFromTag('v0.333.1'),
    'a beta sorts below the stable it precedes',
);

// --- 5. Exported components -------------------------------------------

const manifest = readFileSync(
    join(android, 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
);
const exportedTrue = manifest.match(/android:exported="true"/g) || [];
assert.equal(
    exportedTrue.length,
    1,
    'exactly one exported component (the launcher activity); every other'
    + ' activity, receiver, provider and service stays internal',
);
assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
assert.match(
    manifest,
    /androidx\.core\.content\.FileProvider[\s\S]*?android:exported="false"/,
    'the FileProvider is not exported',
);

// --- 6. No Firebase / Play Services -----------------------------------

const rootGradle = readFileSync(join(android, 'build.gradle'), 'utf8');
for (const [name, text] of [['app/build.gradle', appGradle], ['build.gradle', rootGradle]]) {
    assert.doesNotMatch(
        text,
        /^\s*(classpath|apply plugin:).*google-services/m,
        `${name} does not wire google-services (push/FCM is a non-goal)`,
    );
}

// --- 7. Ignore rules for key material and generated files -------------

const androidIgnore = readFileSync(join(android, '.gitignore'), 'utf8');
for (const pattern of ['*.jks', '*.keystore', 'version.properties']) {
    assert.ok(
        androidIgnore.split('\n').some((line) => line.trim() === pattern),
        `android/.gitignore ignores ${pattern}`,
    );
}
const rootIgnore = readFileSync(join(wsRoot, '.gitignore'), 'utf8');
assert.ok(
    rootIgnore.split('\n').some((line) => line.trim() === '/packages/mobile/www'),
    'the staged webDir is not committed',
);

// --- 8. Staged assets are the web shell's bytes -----------------------

function hashTree(root) {
    const out = new Map();
    const walk = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else {
                out.set(
                    relative(root, full),
                    createHash('sha256').update(readFileSync(full)).digest('hex'),
                );
            }
        }
    };
    walk(root);
    return out;
}

const webDist = join(wsRoot, 'packages', 'web', 'dist');
const www = join(mobile, 'www');
if (existsSync(webDist) && existsSync(www)) {
    const distHashes = hashTree(webDist);
    const wwwHashes = hashTree(www);
    assert.deepEqual(
        [...wwwHashes.entries()].sort(),
        [...distHashes.entries()].sort(),
        'the staged webDir is byte-identical to packages/web/dist',
    );
} else {
    // Not a skip that hides a failure: without a web build there is nothing to
    // compare, and the build script itself refuses to stage in that state.
    console.log('  (web dist or staged www absent: asset-parity check not applicable)');
}

// --- 9. S2: the native vault plugin -----------------------------------
//
// The Java below is compiled by nothing on this machine (no JDK, no Android
// SDK), so these checks are the only thing standing between a rename on one
// side of the bridge and a wallet that silently falls back to WebView storage.
// The contract is a set of method names shared by two languages; assert it.

const vaultDir = join(
    android, 'app', 'src', 'main', 'java', 'io', 'xchain', 'wallet', 'android', 'vault',
);
for (const rel of [
    'XChainVaultPlugin.java',
    'VaultStore.java',
    'VaultBiometricSidecar.java',
    'VaultReadResult.java',
]) {
    assert.ok(existsSync(join(vaultDir, rel)), `native vault has ${rel}`);
}

const pluginJava = readFileSync(join(vaultDir, 'XChainVaultPlugin.java'), 'utf8');
const nativeVaultJs = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'storage', 'nativeVault.js'), 'utf8',
);
const pluginNameJs = /PLUGIN_NAME = '([^']+)'/.exec(nativeVaultJs)?.[1];
assert.equal(pluginNameJs, 'XChainVault', 'JS names the plugin XChainVault');
assert.match(
    pluginJava,
    new RegExp(`@CapacitorPlugin\\(name = "${pluginNameJs}"\\)`),
    'the Java plugin registers under the name the JS looks up',
);

// Every method the JS calls must exist natively. A missing one is not a
// compile error on either side: it surfaces at runtime as an unavailable
// vault, on a device holding the only copy of someone's wallet.
const declaredNatively = new Set(
    [...pluginJava.matchAll(/@PluginMethod\s+public void (\w+)\(/g)].map((m) => m[1]),
);
const jsSources = [
    nativeVaultJs,
    readFileSync(join(wsRoot, 'packages', 'web', 'src', 'storage', 'CapacitorStorageBackend.js'), 'utf8'),
    readFileSync(join(wsRoot, 'packages', 'web', 'src', 'storage', 'backends.js'), 'utf8'),
    readFileSync(join(wsRoot, 'packages', 'web', 'src', 'storage', 'nativeBiometricProvider.js'), 'utf8'),
].join('\n');
const calledFromJs = new Set(
    [...jsSources.matchAll(/callNativeVault\(\s*'(\w+)'/g)].map((m) => m[1]),
);
assert.ok(calledFromJs.size >= 8, `expected the full method surface, saw ${calledFromJs.size}`);
for (const method of calledFromJs) {
    assert.ok(
        declaredNatively.has(method),
        `XChainVaultPlugin.java implements ${method}() (called from the web shell)`,
    );
}

// Registration ordering is the failure that looks like nothing: a plugin
// registered after super.onCreate() is absent from the bridge map, so the
// wallet quietly uses IndexedDB in an app whose backup posture assumes it
// does not.
const mainActivity = readFileSync(
    join(android, 'app', 'src', 'main', 'java', 'io', 'xchain', 'wallet', 'android', 'MainActivity.java'),
    'utf8',
);
assert.match(mainActivity, /registerPlugin\(XChainVaultPlugin\.class\)/);
assert.ok(
    mainActivity.indexOf('registerPlugin(XChainVaultPlugin.class)')
        < mainActivity.indexOf('super.onCreate('),
    'the plugin is registered BEFORE super.onCreate builds the bridge',
);

// Biometric lifecycle: the three properties that make the sidecar safe. Each
// has a convenient wrong version (a validity window, weak biometrics, a key
// that survives re-enrollment), so assert the right ones are present.
const sidecarJava = readFileSync(join(vaultDir, 'VaultBiometricSidecar.java'), 'utf8');
assert.match(
    sidecarJava,
    /setUserAuthenticationParameters\(0, KeyProperties\.AUTH_BIOMETRIC_STRONG\)/,
    'auth-per-use (0 seconds), not a validity window',
);
assert.match(
    sidecarJava,
    /setInvalidatedByBiometricEnrollment\(true\)/,
    'enrolling a new biometric destroys the wrap',
);
assert.match(
    sidecarJava,
    /setAllowedAuthenticators\(BiometricManager\.Authenticators\.BIOMETRIC_STRONG\)/,
    'Class 3 only',
);
assert.doesNotMatch(
    sidecarJava,
    /setDeviceCredentialAllowed\(true\)|DEVICE_CREDENTIAL/,
    'no device-credential fallback: the PIN must not stand in for the biometric',
);
assert.match(
    sidecarJava,
    /new BiometricPrompt\.CryptoObject\(cipher\)/,
    'the prompt is bound to the cipher it authorizes',
);

// The vault blob's write discipline (§1): fsync before publish, and never
// overwrite something that could not be read.
const storeJava = readFileSync(join(vaultDir, 'VaultStore.java'), 'utf8');
assert.match(storeJava, /getFD\(\)\.sync\(\)/, 'payload is fsynced before the rename');
assert.match(storeJava, /renameTo\(live\)/, 'published by rename, not by writing in place');
assert.match(
    storeJava,
    /if \(!read\(\)\.isReadable\(\)\)/,
    'a save is refused when the current vault cannot be read',
);
assert.match(storeJava, /setUnlockedDeviceRequired\(true\)/, 'ciphertext unreadable while locked');

// Permissions stay at exactly what ships (§5 review surface).
const permissions = [...manifest.matchAll(/uses-permission[\s\S]*?android:name="([\w.]+)"/g)]
    .map((m) => m[1])
    .sort();
assert.deepEqual(
    permissions,
    [
        'android.permission.CAMERA',
        'android.permission.INTERNET',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
    ],
    'exactly four permissions: internet, camera (QR), and the two spellings of'
    + ' biometric. Every addition here is store-review surface (§5) and has to'
    + ' earn its place against a shipped feature.',
);
assert.match(
    manifest,
    /USE_FINGERPRINT"\s*\n?\s*android:maxSdkVersion="27"/,
    'the legacy fingerprint permission is capped at API 27',
);

// --- 10. S3: deep links, camera, ceremony -----------------------------

// One exported component still, now carrying three intent filters. A deep
// link that arrives at a second exported activity is an entry point no
// unlock screen guards, which is why the count above is asserted at 1 and
// the filters are asserted to live on the launcher activity.
assert.match(
    manifest,
    /android:autoVerify="true"/,
    'App Links are auto-verified against assetlinks.json',
);
assert.match(
    manifest,
    /<data android:scheme="https" android:host="xchain\.io" android:pathPrefix="\/wallet" \/>/,
    'https App Link filter is scoped to xchain.io/wallet',
);
assert.match(
    manifest,
    /<data android:scheme="xchain" \/>/,
    'the xchain: scheme is accepted inbound',
);
assert.doesNotMatch(
    manifest,
    /android:scheme="http"[^s]/,
    'no cleartext http filter: a downgrade is not a link we claim',
);

const linksJava = readFileSync(
    join(android, 'app', 'src', 'main', 'java', 'io', 'xchain', 'wallet', 'android', 'links',
        'XChainLinksPlugin.java'),
    'utf8',
);
assert.match(linksJava, /@CapacitorPlugin\(name = "XChainLinks"\)/);
assert.match(
    linksJava,
    /public void takePendingLink\(PluginCall call\)/,
    'the cold-start link is queued natively and collected by the SPA;'
    + ' an event-only design drops the tap that launched the app',
);
assert.match(
    linksJava,
    /pending = null;/,
    'the queued link is cleared on read, so a reload cannot replay it',
);
assert.match(mainActivity, /registerPlugin\(XChainLinksPlugin\.class\)/);
assert.ok(
    mainActivity.indexOf('registerPlugin(XChainLinksPlugin.class)')
        < mainActivity.indexOf('super.onCreate('),
    'the links plugin is registered before the bridge is built, like the vault',
);

// The web half must agree with the native half on the plugin name and must
// still refuse the lookalike hosts.
const deepLinkJs = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'deeplinks', 'nativeDeepLinks.js'), 'utf8',
);
assert.match(deepLinkJs, /LINKS_PLUGIN = 'XChainLinks'/, 'JS looks up the name Java registers');
const { isAcceptableDeepLink } = await import(
    pathToFileURL(join(wsRoot, 'packages', 'web', 'src', 'deeplinks', 'nativeDeepLinks.js')).href
);
assert.equal(isAcceptableDeepLink('https://xchain.io/wallet/send?to=x'), true);
assert.equal(isAcceptableDeepLink('https://xchain.io.evil.com/wallet/send'), false);
assert.equal(isAcceptableDeepLink('http://xchain.io/wallet/send'), false);

// assetlinks: a template, because the fingerprints do not exist until the
// operator generates K9/K10. Shipping it half-filled would be worse than
// shipping a template: App Link verification fails SILENTLY.
const assetlinks = JSON.parse(
    readFileSync(join(mobile, 'assetlinks.template.json'), 'utf8'),
);
assert.equal(assetlinks[0].target.package_name, 'io.xchain.wallet.android');
assert.equal(
    assetlinks[0].target.sha256_cert_fingerprints.length,
    2,
    'both lanes: Play app-signing and K10, under the one applicationId (D3a)',
);
assert.ok(
    assetlinks[0].target.sha256_cert_fingerprints.every((f) => f.startsWith('REPLACE_WITH_')),
    'placeholders, not invented fingerprints',
);

// Camera: declared, and NOT required, so the app still lists for devices
// without one.
assert.match(
    manifest,
    /<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>/,
    'camera is optional hardware',
);

// The ceremony script: the two properties that keep keys off runners and
// off command lines.
const ceremony = readFileSync(join(wsRoot, 'tools', 'release', 'android-ceremony.sh'), 'utf8');
assert.match(ceremony, /refusing to run in CI/, 'the ceremony refuses to run unattended');
assert.doesNotMatch(
    ceremony,
    /-storepass\s|--ks-pass\s|-keypass\s/,
    'no password ever reaches a command line; jarsigner and apksigner prompt',
);
assert.match(ceremony, /--mode=universal/, 'the APK is derived from the AAB, not built again');
const expectedArtifacts = readFileSync(
    join(wsRoot, 'tools', 'release', 'expected-artifacts.txt'), 'utf8',
);
for (const glob of ['xchain-wallet-android-v*.aab', 'xchain-wallet-v*.apk']) {
    assert.ok(
        expectedArtifacts.includes(glob),
        `the release manifest declares ${glob} (undeclared artifacts hard-fail sign.sh)`,
    );
}

// --- 11. S4: hardening, update notice, listing pack --------------------

// Backup posture. The single most consequential attribute in the manifest:
// the default would put the vault ciphertext in Google's cloud backup and
// the address book there in the clear.
assert.match(manifest, /android:allowBackup="false"/, 'no cloud backup');
assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/, 'API 26-30 too');
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);

const xmlDir = join(android, 'app', 'src', 'main', 'res', 'xml');
const extraction = readFileSync(join(xmlDir, 'data_extraction_rules.xml'), 'utf8');
for (const surface of ['cloud-backup', 'device-transfer']) {
    // BOTH surfaces: Android 12 split them, and excluding only one leaves the
    // vault flowing to a new phone during setup.
    assert.match(extraction, new RegExp(`<${surface}>`), `${surface} rules present`);
}
assert.equal(
    (extraction.match(/<exclude domain="root" \/>/g) || []).length,
    2,
    'both surfaces exclude everything',
);

const netConfig = readFileSync(join(xmlDir, 'network_security_config.xml'), 'utf8');
assert.match(netConfig, /cleartextTrafficPermitted="false"/, 'release refuses cleartext');
assert.doesNotMatch(
    netConfig,
    /certificates src="user"/,
    'release does not trust user-added CAs: a wallet whose traffic can be'
    + ' intercepted is a wallet whose balances can be lied to',
);
// The regtest exemption exists, and exists ONLY in the debug source set.
const debugNet = join(android, 'app', 'src', 'debug', 'res', 'xml', 'network_security_config.xml');
assert.ok(existsSync(debugNet), 'debug builds carry the regtest exemption');
assert.match(readFileSync(debugNet, 'utf8'), /cleartextTrafficPermitted="true"/);

// R8: a decision, pinned, with the reasoning attached.
assert.match(appGradle, /minifyEnabled false/, 'R8 off (pinned decision, §7)');
assert.match(appGradle, /R8 DECISION, PINNED/, 'and the reasoning is written down');
assert.equal(
    capConfig.android?.webContentsDebuggingEnabled,
    false,
    'no WebView debugging in the shipped app',
);

// Screenshot protection: the switch is native, the policy is in core, and
// every screen that shows or accepts key material asks for it.
assert.match(pluginJava, /public void setScreenProtected\(PluginCall call\)/);
assert.match(pluginJava, /FLAG_SECURE/, 'the native switch really sets FLAG_SECURE');
for (const route of [
    'ViewPrivateKey.jsx',
    'CreateWallet.jsx',
    'ImportWallet.jsx',
    'MigrateToBip39.jsx',
    'Locked.jsx',
]) {
    const src = readFileSync(
        join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', route), 'utf8',
    );
    assert.match(
        src,
        /useProtectedScreen\(/,
        `${route} protects its screen (seed, key export, phrase entry, unlock)`,
    );
}
// And NOT on the screens where blocking screenshots would be user-hostile.
for (const route of ['Receive.jsx', 'Settings.jsx']) {
    const p = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', route);
    if (!existsSync(p)) continue;
    assert.doesNotMatch(
        readFileSync(p, 'utf8'),
        /useProtectedScreen\(/,
        `${route} stays screenshottable: sharing your own receive QR is normal use`,
    );
}

// The update feed: one field, and the client renders none of it.
const updateClient = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'update', 'directUpdateCheck.js'), 'utf8',
);
assert.match(updateClient, /downloads\.xchain\.io\/wallet\/android\/latest\.json/);
assert.match(updateClient, /credentials: 'omit'/, 'the request identifies nobody');
assert.match(updateClient, /redirect: 'error'/, 'a redirect off our origin is not our feed');
assert.doesNotMatch(
    updateClient,
    /body\.(message|url|title|notes)|reply\.(message|url)/,
    'no field but `version` is ever read, let alone rendered',
);
const feedTemplate = JSON.parse(readFileSync(join(mobile, 'latest.json.template'), 'utf8'));
assert.match(feedTemplate.version, /^\d+\.\d+\.\d+$/, 'the feed carries a plain semver');
assert.deepEqual(
    Object.keys(feedTemplate).filter((k) => !k.startsWith('//')),
    ['version'],
    'exactly one meaningful field in the feed',
);

// WebView floor: hard tier feature-detected, soft tier version-based.
const floorSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'platform', 'webviewFloor.js'), 'utf8',
);
for (const primitive of ['crypto.subtle', 'crypto.getRandomValues', 'indexedDB']) {
    assert.ok(floorSrc.includes(primitive), `the floor checks for ${primitive}`);
}
const mainJsx = readFileSync(join(wsRoot, 'packages', 'web', 'src', 'main.jsx'), 'utf8');
assert.ok(
    mainJsx.indexOf('checkWebViewFloor()') < mainJsx.indexOf('createRoot(container).render'),
    'the floor is checked BEFORE React mounts, not from inside a component',
);

// Listing pack: in-repo so a resubmission never improvises (§8).
for (const doc of ['docs/PLAY_LISTING.md', 'docs/DATA_SAFETY.md']) {
    assert.ok(existsSync(join(mobile, doc)), `listing pack has ${doc}`);
}
const dataSafety = readFileSync(join(mobile, 'docs', 'DATA_SAFETY.md'), 'utf8');
// The form is derived from an audit of the wire, not from intent: every
// first-party endpoint the app can call has to appear in it.
for (const host of [
    'explorer.xchain.io',
    'encoder.xchain.io',
    'hub.xchain.io',
    'downloads.xchain.io',
]) {
    assert.ok(dataSafety.includes(host), `the wire audit lists ${host}`);
}
const listing = readFileSync(join(mobile, 'docs', 'PLAY_LISTING.md'), 'utf8');
assert.match(listing, /D8/, 'country availability is still an open operator decision');
assert.match(
    readFileSync(join(wsRoot, 'SECURITY.md'), 'utf8'),
    /PENDING K10 CEREMONY/,
    'the fingerprint slot exists and is honestly empty until the key does',
);
assert.match(
    readFileSync(join(wsRoot, 'docs', 'Privacy_Policy.md'), 'utf8'),
    /## The Android app/,
    'the hosted policy has the mobile section the data-safety answers derive from',
);

console.log(
    'OK: mobile shell smoke ( S1: Capacitor scaffold layout; appId io.xchain.wallet.android (D1 revised);'
    + ' webDir www; androidScheme https for secure-context crypto.subtle; no mixed content;'
    + ' zero registered plugins; minSdkVersion 26 (D2); versionCode/versionName read from the'
    + ' tag-derived version.properties with no literal fallback and a hard failure when absent;'
    + ' exactly one exported component; no google-services wiring; keystores + generated version'
    + ' file + staged webDir all git-ignored; staged assets byte-identical to packages/web/dist.'
    + ' S2: every callNativeVault() method exists as a @PluginMethod under the plugin name the JS'
    + ' looks up; the plugin is registered before super.onCreate; biometric key is auth-per-use,'
    + ' Class 3 only, invalidated by enrollment, CryptoObject-bound, with no device-credential'
    + ' fallback; vault writes fsync before an atomic rename and refuse to overwrite an unreadable'
    + ' vault; ciphertext unreadable while the device is locked; permissions are exactly internet,'
    + ' camera and the two biometric spellings, the legacy one capped at API 27.'
    + ' S3: auto-verified App Links scoped to xchain.io/wallet plus the inbound xchain: scheme and no'
    + ' http downgrade, all on the one exported activity; XChainLinks queues the cold-start link and'
    + ' clears it on read; the JS half agrees on the plugin name and refuses lookalike hosts;'
    + ' assetlinks ships as a two-fingerprint template rather than invented values; camera is optional'
    + ' hardware; the ceremony refuses to run in CI, passes no password on any command line, derives'
    + ' the APK from the AAB, and both artifact names are declared in expected-artifacts.txt.'
    + ' S4: allowBackup=false with BOTH the cloud-backup and device-transfer surfaces excluded and'
    + ' the API 26-30 rules beside them; cleartext refused and user-added CAs untrusted in release,'
    + ' with the regtest exemption confined to the debug source set; R8 pinned off with its reasoning;'
    + ' no WebView debugging; FLAG_SECURE wired to the five screens that show or accept key material'
    + ' and deliberately not to receive/settings; the update feed carries one semver field and the'
    + ' client renders none of it, identifies nobody and refuses redirects; the capability floor is'
    + ' feature-detected before React mounts; and the listing pack, wire audit, privacy-policy mobile'
    + ' section and honestly-empty K10 fingerprint slot are all in the repo)',
);
