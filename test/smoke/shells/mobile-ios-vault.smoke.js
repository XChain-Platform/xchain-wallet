// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The iOS vault plugin, checked from the side that can actually run (S2).
//
// NONE of the Swift below can be compiled by this repo's CI, and on the release
// Mac it cannot be compiled either right now: Xcode's iOS platform support is
// not installed, so `xcodebuild` has no destination at all. That leaves the
// contract between the SPA and the native plugin verified by nobody, which is
// the worst place for it, because the contract is a set of STRINGS: a method
// name that does not match is not a compile error on either side, it is a
// wallet that reports "no native vault" and quietly stores itself somewhere
// else.
//
// So this smoke reads both sides as text and holds them to each other:
//
//   1. Every method the SPA calls exists in the Swift plugin's declared method
//      list AND has an @objc implementation. Capacitor needs BOTH: the list is
//      what the bridge exposes to JS, the func is what runs, and a method in
//      one but not the other fails at run time only.
//   2. The plugin's jsName is the name nativeVault.js looks up.
//   3. MainViewController registers the plugin. Capacitor 8 registers iOS
//      plugins from capacitor.config.json's packageClassList, which is
//      generated from installed plugin PACKAGES; an app-local plugin never
//      appears there, so without an explicit registerPluginInstance the plugin
//      does not exist - and backends.js then silently hands the app an
//      IndexedDB backend, in an installed app whose backup posture assumes the
//      vault is the only copy. There is no error anywhere in that path.
//   4. The Keychain attributes SSC-2 and SSC-3 pin: WhenUnlockedThisDeviceOnly
//      and non-synchronizable for the vault key (never iCloud Keychain), and
//      `.biometryCurrentSet` rather than `.biometryAny` for the wrap, since
//      that is what makes re-enrolment destroy it.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const iosApp = join(wsRoot, 'packages', 'mobile', 'ios', 'App', 'App');
const webStorage = join(wsRoot, 'packages', 'web', 'src', 'storage');

/**
 * Swift with its `//` comments removed.
 *
 * Every assertion below reads this rather than the raw file, and the first run
 * of this smoke is why: these sources EXPLAIN their security choices, so
 * `.biometryAny` and `kSecAttrAccessibleAfterFirstUnlock` both appear in prose
 * saying why they are not used. A guard that greps the whole file then fails on
 * the explanation and, worse, would PASS a positive check on a rule that was
 * only ever described.
 */
function codeOnly(text) {
    return text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

const plugin = codeOnly(readFileSync(join(iosApp, 'vault', 'XChainVaultPlugin.swift'), 'utf8'));
const store = codeOnly(readFileSync(join(iosApp, 'vault', 'VaultStore.swift'), 'utf8'));
const sidecar = codeOnly(readFileSync(join(iosApp, 'vault', 'VaultBiometricSidecar.swift'), 'utf8'));
const viewController = codeOnly(readFileSync(join(iosApp, 'MainViewController.swift'), 'utf8'));

const nativeVaultJs = readFileSync(join(webStorage, 'nativeVault.js'), 'utf8');
const jsCallers = [
    readFileSync(join(webStorage, 'CapacitorStorageBackend.js'), 'utf8'),
    readFileSync(join(webStorage, 'nativeBiometricProvider.js'), 'utf8'),
].join('\n');

// --- 1 + 2. The contract is a set of strings, so compare the strings --------

const jsPluginName = /export const PLUGIN_NAME = '([^']+)'/.exec(nativeVaultJs)?.[1];
assert.equal(jsPluginName, 'XChainVault', 'the SPA looks up this plugin by name');

const swiftJsName = /public let jsName = "([^"]+)"/.exec(plugin)?.[1];
assert.equal(
    swiftJsName, jsPluginName,
    'the Swift plugin exposes a different name than the SPA looks up, so the SPA would find no vault',
);

const declared = new Set(
    [...plugin.matchAll(/CAPPluginMethod\(name:\s*"([^"]+)"/g)].map((m) => m[1]),
);
const implemented = new Set(
    [...plugin.matchAll(/@objc func ([A-Za-z0-9_]+)\(/g)].map((m) => m[1]),
);
const calledByJs = new Set(
    [...jsCallers.matchAll(/callNativeVault\(\s*'([^']+)'/g)].map((m) => m[1]),
);

assert.ok(calledByJs.size >= 8, `expected the SPA to call the vault plugin; found ${calledByJs.size}`);
for (const method of calledByJs) {
    assert.ok(declared.has(method), `the SPA calls ${method}, which the Swift plugin does not declare`);
    assert.ok(implemented.has(method), `${method} is declared to the bridge but has no @objc implementation`);
}
// And the other direction: a declared method with no implementation is a
// runtime failure the moment anything calls it.
for (const method of declared) {
    assert.ok(implemented.has(method), `${method} is in pluginMethods with no @objc func behind it`);
}

// The detection function the SPA uses to decide "is there a native vault"
// probes exactly one method, so that method must exist or every device reads
// as a browser.
// Either spelling: the inline duck-type it used to do, or the `method:` argument
// it now passes to core's shared probe (collapsed the two copies of that
// probe into one).
const probe = (
    /typeof plugin\.([A-Za-z0-9_]+) === 'function'/.exec(nativeVaultJs)
    || /getNativePlugin\(PLUGIN_NAME,\s*\{\s*method:\s*'([A-Za-z0-9_]+)'/.exec(nativeVaultJs)
)?.[1];
assert.ok(probe && declared.has(probe), `nativeVault.js probes ${probe}, which the plugin must declare`);

// --- 3. Registration, without which none of the above runs -----------------

assert.match(
    viewController, /override func capacitorDidLoad\(\)/,
    'the bridge registers app-local plugins from capacitorDidLoad; nothing else runs early enough',
);
assert.match(
    viewController, /bridge\?\.registerPluginInstance\(XChainVaultPlugin\(\)\)/,
    'without this call the plugin does not exist at run time and the app silently uses WebView storage',
);
const storyboard = readFileSync(join(iosApp, 'Base.lproj', 'Main.storyboard'), 'utf8');
assert.match(
    storyboard, /customClass="MainViewController"/,
    'the storyboard must instantiate our subclass, or capacitorDidLoad never runs',
);
// And the path that actually runs. The Capacitor template's SceneDelegate
// builds the window itself and assigns a root view controller in code, which
// WINS over the storyboard: the first version of this stage set the storyboard
// alone, and the result was an app that registered nothing while looking
// correctly wired. Both places, or the guard is decorative.
const sceneDelegate = codeOnly(readFileSync(join(iosApp, 'SceneDelegate.swift'), 'utf8'));
assert.match(
    sceneDelegate, /rootViewController = MainViewController\(\)/,
    'SceneDelegate assigns the root view controller in code and must not use the base class',
);
assert.ok(
    !/rootViewController = CAPBridgeViewController\(\)/.test(sceneDelegate),
    'the base CAPBridgeViewController registers no plugins; the vault would silently fall back to WebView storage',
);

// --- 4. The pinned Keychain posture ---------------------------------------

assert.match(
    store, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/,
    '§4 pins this accessibility class; a weaker one is a spec change, not an implementation choice',
);
assert.match(store, /kSecAttrSynchronizable as String: false/, 'vault key material must never reach iCloud Keychain');
for (const weaker of ['kSecAttrAccessibleAfterFirstUnlock', 'kSecAttrAccessibleAlways']) {
    assert.ok(!store.includes(weaker), `${weaker} would keep the vault key readable in states the wallet never runs in`);
}

assert.match(
    sidecar, /\.biometryCurrentSet/,
    'SSC-3 needs the wrap destroyed on re-enrolment, which is what biometryCurrentSet buys',
);
assert.ok(
    !sidecar.includes('.biometryAny'),
    'biometryAny survives a new face or finger being enrolled, so the wrap would open for someone else',
);
assert.ok(
    !sidecar.includes('touchIDAuthenticationAllowableReuseDuration'),
    'a reuse window is exactly the per-use authorization rule SSC-3 forbids',
);
// The theatre check: a Bool from evaluatePolicy gates nothing, because the
// secret it guards was readable the whole time.
assert.ok(
    !/evaluatePolicy\(\s*\.deviceOwnerAuthentication[A-Za-z]*\s*,\s*localizedReason/.test(sidecar),
    'the wrap must be released by the Keychain ACL, never by branching on an evaluatePolicy result',
);

// --- The other half of the registration guard -----------------
//
// Every assertion above proves the plugin registration EXISTS in source. None
// of them can prove it RAN: the registration ran on this shell right up until
// the template SceneDelegate quietly replaced the view controller, and the app
// carried on storing vaults in WebView storage. So the shared SPA refuses to
// boot on a native shell with no plugin, and that refusal is checked here
// because this is the file that owns the vault contract.

const bootEntry = readFileSync(join(wsRoot, 'packages', 'web', 'src', 'main.jsx'), 'utf8');
assert.match(
    bootEntry,
    /nativeShellIsBroken\(\)/,
    'main.jsx must check for a native shell with no vault plugin before it mounts anything',
);
const brokenAt = bootEntry.indexOf('nativeShellIsBroken()');
const mountAt = bootEntry.indexOf('createRoot(');
assert.ok(
    brokenAt !== -1 && mountAt !== -1 && brokenAt < mountAt,
    'the check must come BEFORE React mounts: after it, the app has already offered to make a wallet',
);

const backends = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'storage', 'backends.js'),
    'utf8',
);
assert.match(
    backends,
    /if \(nativeShellIsBroken\(\)\) throw/,
    'the backend factory must refuse a broken native shell rather than downgrade it to IndexedDB',
);

// --- 5. The native QR scanner (qrScanStart / qrScanStop) --------------------
//
// WKWebView has no BarcodeDetector, so on iOS the only camera path is this
// plugin pair. These checks hold the strings the SPA matches on, the Apple-only
// detector, the threading rules, and the rule that a scanned value is never logged.

const qrScan = codeOnly(readFileSync(join(iosApp, 'vault', 'VaultQrScan.swift'), 'utf8'));
const qrView = codeOnly(readFileSync(join(iosApp, 'vault', 'VaultQrScannerViewController.swift'), 'utf8'));

// Both methods are exposed to the bridge; the loop above proves each has an @objc func.
for (const method of ['qrScanStart', 'qrScanStop']) {
    assert.ok(declared.has(method), `${method} is not declared to the bridge, so the SPA cannot open the scanner`);
}

// The event names, close reasons and reject messages are strings the SPA matches on.
const qrEvents = new Set([...qrScan.matchAll(/emit\?\("([A-Za-z]+)"/g)].map((m) => m[1]));
assert.deepEqual([...qrEvents].sort(), ['qrFrame', 'qrScanClosed'], 'the scanner sends exactly qrFrame and qrScanClosed');
const enumBody = (name) => new RegExp(`enum ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(qrScan)?.[1] ?? '';
for (const reason of ['cancelled', 'interrupted', 'error']) {
    assert.match(enumBody('QrScanCloseReason'), new RegExp(`case ${reason}\\b`), `qrScanClosed can say ${reason}`);
}
for (const refusal of ['denied', 'unavailable', 'busy']) {
    assert.match(enumBody('QrScanRefusal'), new RegExp(`case ${refusal}\\b`), `qrScanStart can reject ${refusal}`);
}

// Apple's own QR detector, asked for QR only, and no third-party scanner module.
assert.match(qrView, /AVCaptureMetadataOutput\(\)/, 'the scanner reads codes with AVCaptureMetadataOutput');
assert.match(qrView, /metadataObjectTypes = \[\.qr\]/, 'QR is the only code type the detector is asked for');
for (const [name, text] of [['VaultQrScan.swift', qrScan], ['VaultQrScannerViewController.swift', qrView]]) {
    for (const [, mod] of text.matchAll(/^import (\w+)/gm)) {
        assert.ok(
            ['AVFoundation', 'UIKit', 'Foundation'].includes(mod),
            `${name} imports ${mod}; the scanner uses only AVFoundation and UIKit`,
        );
    }
    // A scanned value can be an address, a payment request or a signed transaction, so nothing is logged.
    assert.ok(
        !/\b(print|NSLog|os_log|debugPrint|dump)\(|\bCAPLog\b|\bLogger\(/.test(text),
        `${name} must not log; a scanned value could end up in the device log`,
    );
}

// The camera starts and stops on its own queue, never on the main thread.
for (const op of ['startRunning', 'stopRunning']) {
    const uses = [...qrView.matchAll(new RegExp(`\\.${op}\\(\\)`, 'g'))];
    assert.ok(uses.length >= 1, `the scanner calls ${op}`);
    for (const use of uses) {
        const before = qrView.slice(Math.max(0, use.index - 120), use.index);
        assert.match(before, /sessionQueue\.async \{/, `${op} runs on the session queue; on the main thread it blocks the UI`);
    }
}

// Each way the scanner closes on its own is wired: backgrounding, a camera error, the Cancel button.
assert.match(
    qrScan, /UIApplication\.didEnterBackgroundNotification[\s\S]{0,200}?\.interrupted/,
    'backgrounding closes the scan as interrupted',
);
assert.match(
    qrView, /\.AVCaptureSessionRuntimeError[\s\S]{0,200}?onClose\?\(\.error\)/,
    'a camera session error closes the scan as error',
);
assert.match(qrView, /cancelTapped\(\) \{\s*onClose\?\(\.cancelled\)/, 'the Cancel button closes the scan as cancelled');
assert.match(
    qrView, /modalPresentationStyle = \.fullScreen/,
    'full screen, so no swipe can dismiss the scanner without the plugin knowing',
);

// Wherever the SPA names a QR method or event, the plugin answers to that exact string.
function sourcesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourcesUnder(path);
        return /\.(js|jsx)$/.test(entry.name) ? [path] : [];
    });
}
const spaQrNames = new Set();
for (const dir of [join(wsRoot, 'packages', 'core', 'src'), join(wsRoot, 'packages', 'web', 'src')]) {
    for (const file of sourcesUnder(dir)) {
        for (const m of readFileSync(file, 'utf8').matchAll(/['"](qr(?:Scan[A-Z][A-Za-z]*|Frame))['"]/g)) {
            spaQrNames.add(m[1]);
        }
    }
}
for (const name of spaQrNames) {
    assert.ok(
        declared.has(name) || qrEvents.has(name),
        `the SPA uses "${name}", which the iOS plugin neither declares nor emits`,
    );
}

console.log(
    'OK: iOS vault smoke (S2: jsName XChainVault matches nativeVault.js PLUGIN_NAME;'
    + ` all ${calledByJs.size} SPA-called methods are both declared to the bridge and @objc-implemented;`
    + ' the detection probe exists; MainViewController registers the plugin from capacitorDidLoad and the'
    + ' storyboard instantiates it, without which the app silently falls back to WebView storage;'
    + ' vault key pinned WhenUnlockedThisDeviceOnly + non-synchronizable with no weaker class present;'
    + ' biometric wrap uses biometryCurrentSet, no biometryAny, no reuse window, no evaluatePolicy gate.'
    + ' the shared SPA refuses to boot a native shell whose plugin never registered, checked'
    + ' before React mounts, and the backend factory throws rather than downgrading to IndexedDB.'
    + ' QR: qrScanStart/qrScanStop declared, events qrFrame and qrScanClosed with reasons cancelled,'
    + ' interrupted and error, rejects denied/unavailable/busy, AVCaptureMetadataOutput for .qr only, no'
    + ' third-party import, no logging, camera start/stop on the session queue, full-screen presentation,'
    + ` and ${spaQrNames.size} QR name(s) the SPA uses all answered by the plugin)`,
);
