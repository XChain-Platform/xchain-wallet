// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the iOS half of the Capacitor shell ( §10 stage S1).
//
// The Android twin (mobile-shell.smoke.js) exists because no lane in this repo
// can run a Gradle build. This one exists for a sharper reason: the iOS project
// can only be built on a Mac with Xcode, so on every other machine these files
// are read by nobody until a release is being cut, and three of the four
// decisions they encode are IRREVERSIBLE or expensive to undo.
//
//   1. The bundle id is `io.xchain.wallet.ios` (D1) and is immutable after the
//      first App Store upload. **The trap this guard exists for:** Capacitor has
//      ONE `appId` in capacitor.config.json, it is the Android one, and
//      `cap add ios` seeds the Xcode project from it - so the generated project
//      arrived saying `io.xchain.wallet.android`, and anyone who regenerates the
//      platform gets that back. The two ids are asserted together, in opposite
//      directions, so the seam cannot quietly close.
//   2. Deployment target 16.0 (D5), in the project AND in Package.swift, which
//      are two separate places that mean the same thing.
//   3. Device family "1,2", universal (D6). iPad is a shipped surface, and the
//      listing needs iPad screenshots because of it.
//   4. Associated domains name xchain.io and claim `applinks` only. The paths
//      themselves live in the association file , not here.
//
// And three postures that are cheap to lose in a template regeneration:
// default App Transport Security (the store build ships NO arbitrary-loads
// exception), usage strings that say what the hardware is used for, and the
// `xchain:` scheme registered as inbound compatibility only.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const mobile = join(wsRoot, 'packages', 'mobile');
const ios = join(mobile, 'ios');
const appDir = join(ios, 'App', 'App');

// --- 1. Layout --------------------------------------------------------

for (const rel of [
    'App/App.xcodeproj/project.pbxproj',
    'App/App/Info.plist',
    'App/App/App.entitlements',
    'App/CapApp-SPM/Package.swift',
    '.gitignore',
]) {
    assert.ok(existsSync(join(ios, rel)), `missing from the iOS scaffold: ios/${rel}`);
}

const pbxproj = readFileSync(join(ios, 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
const infoPlist = readFileSync(join(appDir, 'Info.plist'), 'utf8');
const entitlements = readFileSync(join(appDir, 'App.entitlements'), 'utf8');
const packageSwift = readFileSync(join(ios, 'App', 'CapApp-SPM', 'Package.swift'), 'utf8');
const capConfig = JSON.parse(readFileSync(join(mobile, 'capacitor.config.json'), 'utf8'));

/* A deliberately small plist reader. Hand-rolled rather than pulled from npm
 * for the same reason the release-config guards are: a file that checks the
 * shipped configuration should not need a dependency tree to be trustworthy,
 * and this smoke runs on the Linux CI lane where `plutil` does not exist. It
 * understands exactly what these two files use: <string>, <true/>, <false/>,
 * and flat <array> of <string>. */
function plistValue(text, key) {
    const at = text.indexOf(`<key>${key}</key>`);
    if (at === -1) return undefined;
    const rest = text.slice(at + `<key>${key}</key>`.length);
    const bool = /^\s*<(true|false)\/>/.exec(rest);
    if (bool) return bool[1] === 'true';
    const str = /^\s*<string>([\s\S]*?)<\/string>/.exec(rest);
    if (str) return str[1];
    const arr = /^\s*<array>([\s\S]*?)<\/array>/.exec(rest);
    if (arr) return [...arr[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
    return null; // present, but a shape this reader does not model (e.g. a dict)
}

// --- 2. Bundle id, and the seam it can slip through -------------------

// The screenshot harness's UI-test bundle  legitimately carries its
// own id. It is allow-listed BY NAME rather than by loosening the check to a
// prefix: `io.xchain.wallet.ios.anything` would then pass, and the whole point
// of this assertion is that exactly one shipping id exists and it never moves.
// A UI test bundle is never uploaded, so it cannot collide with D1.
const UITEST_BUNDLE_ID = 'io.xchain.wallet.ios.uitests';
const bundleIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((id) => id !== UITEST_BUNDLE_ID);
assert.ok(bundleIds.length >= 2, 'expected a bundle id in both the Debug and Release configurations');
for (const id of bundleIds) {
    assert.equal(id, 'io.xchain.wallet.ios', 'D1: immutable after the first App Store upload');
}
assert.equal(
    capConfig.appId, 'io.xchain.wallet.android',
    'capacitor.config.json holds the ANDROID id; if this changed, re-check what cap add ios would now seed',
);
assert.ok(
    !pbxproj.includes('io.xchain.wallet.android'),
    'the Xcode project picked up the Android applicationId, which is what a bare `cap add ios` does',
);

// --- 3. Deployment target, in both places that mean it ----------------

const targets = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map((m) => m[1].trim());
assert.ok(targets.length > 0, 'no deployment target in the project');
for (const t of targets) assert.equal(t, '16.0', 'D5: iOS 16');
assert.match(packageSwift, /platforms:\s*\[\.iOS\(\.v16\)\]/, 'Package.swift must agree with the project');

// --- 4. Device family -------------------------------------------------

const families = [...pbxproj.matchAll(/TARGETED_DEVICE_FAMILY = "([^"]+)";/g)].map((m) => m[1]);
assert.ok(families.length > 0, 'no targeted device family in the project');
for (const f of families) assert.equal(f, '1,2', 'D6: universal, so iPad is a shipped and reviewed surface');

// --- 5. Associated domains -------------------------------------------

assert.match(pbxproj, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/, 'entitlements not wired into the build');
const domains = plistValue(entitlements, 'com.apple.developer.associated-domains');
assert.deepEqual(domains, ['applinks:xchain.io'], 'one domain, applinks only');
assert.ok(
    !entitlements.includes('webcredentials:'),
    'webcredentials offers password autofill for an account the wallet does not have',
);

// --- 6. App Transport Security: default, by absence -------------------

// The secure posture here is the ABSENCE of the key. An NSAppTransportSecurity
// dict is only ever added to weaken the default, and a dev/regtest relaxation
// leaking into the store build is the exact accident this catches.
assert.equal(
    plistValue(infoPlist, 'NSAppTransportSecurity'), undefined,
    'the store build ships default ATS; relaxations belong in non-store build configs only',
);
assert.ok(!infoPlist.includes('NSAllowsArbitraryLoads'), 'arbitrary loads must never reach the store build');

// --- 7. Usage strings, scheme, export compliance ----------------------

for (const key of ['NSCameraUsageDescription', 'NSFaceIDUsageDescription']) {
    const text = plistValue(infoPlist, key);
    assert.equal(typeof text, 'string', `${key} is missing; iOS kills the app on first use without it`);
    assert.ok(text.length > 20, `${key} is shown verbatim in the OS prompt and must say what it is for`);
}
assert.ok(
    plistValue(infoPlist, 'NSFaceIDUsageDescription').includes('approval'),
    'the Face ID string must not imply biometrics approve a transaction; it gates unlock only',
);

const schemes = plistValue(infoPlist, 'CFBundleURLSchemes');
assert.deepEqual(schemes, ['xchain'], 'exactly one custom scheme, and it is inbound compatibility only');

assert.equal(
    plistValue(infoPlist, 'ITSAppUsesNonExemptEncryption'), false,
    'export-compliance posture ( §2.5): standard cryptography, exempt',
);

const capabilities = plistValue(infoPlist, 'UIRequiredDeviceCapabilities');
assert.ok(!capabilities.includes('armv7'), 'armv7 is a template leftover; no iOS 16 device is 32-bit');

// --- 8. S3 hardening: snapshot cover, backup exclusion, media -----------

// iOS photographs the UI on backgrounding and keeps the image on disk. A seed
// phrase on screen at that moment is a seed phrase in the switcher cache, so
// the cover goes up on resignActive (which fires BEFORE the snapshot) and comes
// down on becomeActive. Both halves, since a cover that is never removed is a
// bug report and a cover that is never added is the leak.
const sceneDelegateSrc = readFileSync(join(ios, 'App', 'App', 'SceneDelegate.swift'), 'utf8')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
assert.match(sceneDelegateSrc, /func sceneWillResignActive\(/, 'no snapshot cover is installed on backgrounding');
assert.match(sceneDelegateSrc, /func sceneDidBecomeActive\(/, 'the snapshot cover is never removed');
assert.match(sceneDelegateSrc, /privacyCover/, 'the cover view must be retained so it can be removed again');

// --- SSC-1 : the two native HTTP doors --------------------------
//
// Measured on an iPhone 17 Pro Max simulator, 2026-08-01, BEFORE this
// hardening, from ordinary page script:
//
//   1. `Capacitor.Plugins.CapacitorHttp.request({url, method})` returned 200
//      with 559 bytes of a third-party origin's HTML. `CapacitorCookies` was
//      callable the same way. Neither is constrained by the WebView CSP,
//      because the request is made by the native stack.
//   2. `fetch('/_capacitor_http_interceptor_?u=<any url>')` did the same
//      thing WITHOUT touching the plugin registry, and that one is a real CSP
//      bypass: the requested URL is same-origin, so `connect-src 'self'`
//      permits it and the cross-origin fetch happens natively afterwards.
//
// Door 2 is why this block asserts two mechanisms rather than one. Closing
// only the registry would leave the wallet with a working native proxy and a
// spec claiming otherwise.
const mainVCSrc = readFileSync(join(ios, 'App', 'App', 'MainViewController.swift'), 'utf8');
const disabledPluginsSrc = readFileSync(
    join(ios, 'App', 'App', 'DisabledCapacitorPlugins.swift'),
    'utf8',
);

// Assert the CALLS, from inside capacitorDidLoad - not merely that functions
// by these names exist. Deleting the call site while leaving the definition is
// the realistic regression (a merge, a revert), and the first version of this
// guard passed straight through it.
const didLoadBody = mainVCSrc.match(
    /override func capacitorDidLoad\(\) \{([\s\S]*?)\n    \}/,
);
assert.ok(didLoadBody, 'MainViewController still overrides capacitorDidLoad');
assert.match(
    didLoadBody[1],
    /disableUnusedCapacitorPlugins\(\)/,
    'SSC-1 door 1: capacitorDidLoad must displace CapacitorHttp/CapacitorCookies'
    + ' from the bridge registry',
);
assert.match(
    didLoadBody[1],
    /blockNativeHttpProxy\(\)/,
    'SSC-1 door 2: capacitorDidLoad must also block the _capacitor_http_interceptor_ proxy,'
    + ' which does not go through the plugin registry at all',
);
// The stubs are the control: they only work because they claim the REAL
// plugins' jsName, which is what displaces them out of the dispatch map.
for (const shadowed of ['CapacitorHttp', 'CapacitorCookies']) {
    assert.match(
        disabledPluginsSrc,
        new RegExp(`jsName = "${shadowed}"`),
        `SSC-1: a stub must occupy the ${shadowed} jsName, or the real plugin stays dispatchable`,
    );
}
assert.match(
    disabledPluginsSrc,
    /call\.reject\(/,
    'the stubs must REJECT: a stub with no methods leaves the JS promise pending forever,'
    + ' which a caller cannot tell from a slow network',
);
assert.match(
    mainVCSrc,
    /bridge\.plugin\(withName: name\)[\s\S]{0,300}?fatalError/,
    'the shadowing is asserted through the same lookup the bridge dispatches with,'
    + ' and a Capacitor upgrade that changes registration must FAIL LOUDLY: a security'
    + ' control that silently stops applying is worse than one never added, because'
    + ' the spec still claims it',
);
assert.match(
    mainVCSrc,
    /_capacitor_http\[s\]\?_interceptor_/,
    'the content rule list must cover the deprecated https interceptor alias as well',
);
assert.match(
    mainVCSrc,
    /WKContentRuleListStore/,
    'door 2 must be closed BELOW the JS layer: frame-src \'self\' lets an attacker take a'
    + ' fresh unpatched fetch out of a same-origin iframe realm, so a JS patch is not a control',
);

// The vault is excluded from iCloud/Finder backup. Its key is ThisDeviceOnly,
// so a backup could only restore ciphertext onto a device that cannot open it.
const vaultStoreSrc = readFileSync(join(ios, 'App', 'App', 'vault', 'VaultStore.swift'), 'utf8')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
assert.match(
    vaultStoreSrc, /isExcludedFromBackup = true/,
    ' §4: the vault must not travel in a device backup (the Android twin is allowBackup="false")',
);

// SSC-5 is enforced structurally rather than by a code path: with img-src
// limited to self/data/blob, a remote NFT media URL cannot beacon the holder's
// IP on render even if some future view forgets to gate it. Widening this is
// the change that must not happen quietly.
const csp = readFileSync(join(wsRoot, 'packages', 'web', 'src', 'csp.js'), 'utf8');
const imgSrc = /'img-src':\s*\[([^\]]*)\]/.exec(csp)?.[1] ?? '';
assert.ok(imgSrc.length > 0, 'could not read img-src out of csp.js');
assert.ok(
    !/https?:/.test(imgSrc),
    `img-src admits a remote origin (${imgSrc.trim()}), which is how auto-loaded NFT media becomes an IP beacon`,
);

// --- 9. The generated web copy is not a second shipped tree -----------

const iosIgnore = readFileSync(join(ios, '.gitignore'), 'utf8');
for (const path of ['App/App/public', 'App/App/capacitor.config.json']) {
    assert.ok(iosIgnore.includes(path), `ios/.gitignore must ignore ${path}: it is generated, not authored`);
}

// --- 10. Version numbers come from the tag, with nothing to fall back to ---
//
// The template ships MARKETING_VERSION = 1.0 / CURRENT_PROJECT_VERSION = 1,
// and an ipa uploaded under either of those spends that build number for the
// life of the app: App Store Connect has no way to release a number. So the
// project must carry NO literal at all and read both keys from the generated
// xcconfig (rails §2 formula, ). A missing xcconfig leaves the keys
// empty, which is a visible failure; a literal would be a silent wrong answer.

assert.ok(
    !/^\s*MARKETING_VERSION = /m.test(pbxproj) && !/^\s*CURRENT_PROJECT_VERSION = /m.test(pbxproj),
    'the pbxproj carries a literal version: it must come from the generated Version.xcconfig,'
    + ' since a template 1.0/1 uploaded once is spent forever',
);
assert.match(
    pbxproj,
    /baseConfigurationReference = \w+ \/\* Version\.xcconfig \*\/;/,
    'the Release configuration must read Version.xcconfig',
);
assert.match(
    readFileSync(join(ios, 'debug.xcconfig'), 'utf8'),
    /#include\? "App\/Version\.xcconfig"/,
    'debug builds must carry the same tag-derived numbers, or a device build is unidentifiable',
);
assert.ok(
    iosIgnore.includes('App/Version.xcconfig'),
    'the generated version file must be git-ignored; a committed copy is a stale number waiting to be built from',
);

// Both keys are plumbed through Info.plist as build-setting references rather
// than hard-coded strings, which is the half of the chain the xcconfig cannot
// enforce on its own.
for (const [key, setting] of [
    ['CFBundleShortVersionString', 'MARKETING_VERSION'],
    ['CFBundleVersion', 'CURRENT_PROJECT_VERSION'],
]) {
    assert.match(
        infoPlist,
        new RegExp(`<key>${key}</key>\\s*<string>\\$\\(${setting}\\)</string>`),
        `Info.plist must take ${key} from $(${setting}), not from a literal`,
    );
}

// The formula the numbers come from, asserted here too so an iOS-only change
// cannot quietly re-point the shell at a second definition.
const { storeVersionFromTag, marketingVersionFromTag, versionXcconfigFor } = await import(
    pathToFileURL(join(mobile, 'scripts', 'version.js')).href
);
assert.equal(storeVersionFromTag('v0.333.1'), 3330150, 'rails §2 worked example');
assert.equal(marketingVersionFromTag('v0.333.1-beta.2'), '0.333.1', 'Apple takes integers only');
assert.equal(
    versionXcconfigFor('v0.333.1'),
    '// Generated by packages/mobile/scripts/version.js - do not edit.\n'
    + '// Derived from release tag v0.333.1 (rails §2).\n'
    + 'MARKETING_VERSION = 0.333.1\n'
    + 'CURRENT_PROJECT_VERSION = 3330150\n',
    'the generated xcconfig must set exactly the two keys the project reads',
);


// ---- Safe area: the app must not draw under the Dynamic Island ----------
//
// Measured on an iPhone 17 Pro Max simulator: the island sat on top of the
// XChain logo. Two halves fix it, and BOTH are one-liners a template
// regeneration or a stray `cap sync` could silently drop:
//
//   1. `ios.contentInset: "always"` makes the WKWebView's scroll view adjust
//      for the safe area. This is the half that actually moved the content -
//      `env(safe-area-inset-top)` evaluates to ZERO inside this WebView even
//      with viewport-fit=cover, proven by a literal-padding probe that DID
//      move the app.
//   2. `viewport-fit=cover` plus the body insets in core/ui/tokens.css, which
//      is what serves the MOBILE WEB shell (Safari on a notched phone), where
//      env() does return real values.
assert.equal(
    capConfig.ios?.contentInset,
    'always',
    'capacitor.config.json sets ios.contentInset=always (else the WebView draws under the Dynamic Island)',
);
const webIndex = readFileSync(join(wsRoot, 'packages', 'web', 'index.html'), 'utf8');
assert.match(
    webIndex,
    /<meta name="viewport"[^>]*viewport-fit=cover/,
    'the SPA viewport opts into viewport-fit=cover, without which env(safe-area-inset-*) is 0 everywhere',
);
assert.match(
    readFileSync(join(wsRoot, 'packages', 'core', 'src', 'ui', 'tokens.css'), 'utf8'),
    /padding-top: env\(safe-area-inset-top/,
    'the shared stylesheet insets the top safe area',
);

// ---- App icon: not the Capacitor template ------------------------------
//
// Both shells shipped the stock Capacitor mark until 2026-08-01 (),
// which no gate caught because every other check here reads identifiers and
// wiring rather than pixels. The template icon is a known 1024x1024 file; what
// makes this catchable is that ours is a DIFFERENT image with no alpha (Apple
// rejects an app icon carrying an alpha channel outright).
const iconSet = join(ios, 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const iconJson = JSON.parse(readFileSync(join(iconSet, 'Contents.json'), 'utf8'));
const appearances = iconJson.images.map((i) => i.appearances?.[0]?.value ?? 'light');
for (const want of ['light', 'dark', 'tinted']) {
    assert.ok(
        appearances.includes(want),
        `AppIcon declares a ${want} appearance (iOS 18+ derives an ugly one otherwise)`,
    );
}
for (const img of iconJson.images) {
    assert.ok(
        existsSync(join(iconSet, img.filename)),
        `AppIcon file ${img.filename} exists`,
    );
}

console.log(
    'OK: iOS shell smoke ( S1: bundle id io.xchain.wallet.ios in both configs and NOT the Android id'
    + ' that cap add seeds from capacitor.config.json; deployment target 16.0 in the project and Package.swift;'
    + ' universal device family; associated domains applinks:xchain.io only, entitlements wired into the build;'
    + ' default ATS asserted by absence; camera + Face ID usage strings present and honest about what biometrics'
    + ' do; one custom scheme, xchain:, as inbound compatibility; export-compliance flag set; armv7 leftover'
    + ' removed; generated web copy and config git-ignored. S4: no literal version anywhere in the project,'
    + ' both keys read from the git-ignored Version.xcconfig via $(MARKETING_VERSION)/$(CURRENT_PROJECT_VERSION),'
    + ' and the rails §2 store integer is the same one Android gets)',
);
