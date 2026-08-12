// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-4 clipboard hygiene, held to its two native halves.
//
// Neither the Swift nor the Java below is compiled by this repo's CI, and the
// contract between them and the SPA is a set of STRINGS: a plugin name or a
// method name that does not match is not a compile error on either side. It is
// a sensitive copy that quietly does not happen, or - before the JS side
// learned to refuse - one that quietly goes to the ordinary system pasteboard,
// which on iOS means Universal Clipboard carrying a seed phrase to every nearby
// signed-in device.
//
// So this reads all three sides as text and holds them to each other, the same
// way `mobile-ios-vault.smoke.js` does for the vault, and additionally checks
// the two native halves against EACH OTHER: they implement one contract for one
// wallet, and a method present on one shell only is a shell-specific bug that
// no amount of testing the other shell would find  .

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const read = (...p) => readFileSync(join(repo, ...p), 'utf8');

const js = read('packages', 'core', 'src', 'shared', 'clipboard.js');
const swift = read('packages', 'mobile', 'ios', 'App', 'App', 'clipboard', 'XChainClipboardPlugin.swift');
const java = read(
    'packages', 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'xchain',
    'wallet', 'android', 'clipboard', 'XChainClipboardPlugin.java',
);
const iosRegistration = read('packages', 'mobile', 'ios', 'App', 'App', 'MainViewController.swift');
const androidRegistration = read(
    'packages', 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'xchain',
    'wallet', 'android', 'MainActivity.java',
);
const pbxproj = read('packages', 'mobile', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

// ---- 1. One plugin name, spelled the same in three languages --------------

const nameMatch = js.match(/CLIPBOARD_PLUGIN_NAME = '([^']+)'/);
assert.ok(nameMatch, 'clipboard.js declares the plugin name');
const PLUGIN = nameMatch[1];

assert.match(swift, new RegExp(`jsName = "${PLUGIN}"`), `iOS plugin jsName is ${PLUGIN}`);
assert.match(java, new RegExp(`@CapacitorPlugin\\(name = "${PLUGIN}"\\)`), `Android plugin name is ${PLUGIN}`);

// ---- 2. Every method the SPA calls exists on BOTH shells ------------------

// What the JS actually invokes, read from the source rather than listed here,
// so adding a call without a native half fails this smoke instead of failing
// on a device.
const called = [...js.matchAll(/plugin\.(\w+)\s*\(/g)].map((m) => m[1])
    .filter((m) => m !== 'then' && m !== 'catch');
assert.ok(called.includes('write'), 'the SPA calls write()');
assert.ok(called.includes('clear'), 'the SPA calls clear()');

for (const method of new Set(called)) {
    // Capacitor iOS needs BOTH: the declared list is what the bridge exposes to
    // JS, the @objc func is what runs, and one without the other fails only at
    // run time.
    assert.match(
        swift,
        new RegExp(`CAPPluginMethod\\(name: "${method}"`),
        `iOS declares ${method} in pluginMethods`,
    );
    assert.match(swift, new RegExp(`@objc func ${method}\\(`), `iOS implements ${method}`);
    assert.match(
        java,
        new RegExp(`@PluginMethod\\s+public void ${method}\\(`),
        `Android implements ${method}`,
    );
}

// ---- 3. Registration, on both shells -------------------------------------

// The failure this guards is silent by construction: an unregistered plugin
// makes the SPA refuse sensitive copies, which looks like a copy button that
// stopped working rather than like a broken build.
assert.match(
    iosRegistration,
    /registerPluginInstance\(XChainClipboardPlugin\(\)\)/,
    'MainViewController registers the clipboard plugin',
);
assert.match(
    androidRegistration,
    /registerPlugin\(XChainClipboardPlugin\.class\)/,
    'MainActivity registers the clipboard plugin',
);
// Android registers BEFORE super.onCreate or the Bridge never sees it.
// The CALL, not the phrase: the comment above it says "BEFORE super.onCreate",
// and matching that comment made this assertion pass for the wrong reason.
const registerIdx = androidRegistration.indexOf('registerPlugin(XChainClipboardPlugin.class)');
const superIdx = androidRegistration.indexOf('super.onCreate(savedInstanceState);');
assert.ok(superIdx > 0, 'MainActivity calls super.onCreate(savedInstanceState)');
assert.ok(registerIdx < superIdx, 'Android registers the plugin before super.onCreate');

// The iOS project lists its sources explicitly (no synchronized folder group),
// so a new Swift file that is not in the pbxproj is simply not compiled - and
// the app still builds, still runs, and still has no plugin.
assert.match(pbxproj, /XChainClipboardPlugin\.swift in Sources/, 'the plugin is in the App target');

// ---- 4. The mechanics SSC-4 actually asks for ----------------------------

// iOS: local-only is the Universal Clipboard opt-out, and expirationDate is
// the half a JS timer cannot promise because it dies with the WebView.
assert.match(swift, /\.localOnly: true/, 'iOS marks a sensitive clip local-only');
assert.match(swift, /\.expirationDate/, 'iOS gives a sensitive clip an expiry');
assert.match(swift, /setItems\(/, 'iOS writes via setItems, the only form that carries options');
assert.ok(
    !/board\.string = value\s*\n\s*call\.resolve\(\["ok": true, "sensitive": true/.test(swift),
    'iOS never writes a SENSITIVE value through the plain .string setter',
);

// Android: EXTRA_IS_SENSITIVE is what keeps the seed out of the system's own
// paste preview and clipboard history.
assert.match(java, /ClipDescription\.EXTRA_IS_SENSITIVE/, 'Android marks the clip sensitive');
assert.match(java, /VERSION_CODES\.TIRAMISU/, 'Android guards the 13+ sensitivity API');
assert.match(java, /clearPrimaryClip\(\)/, 'Android can clear its own clip');

// ---- 5. The refusal, which is the property that matters ------------------

// A sensitive copy must never reach the web clipboard API on a native shell.
assert.match(js, /NO_NATIVE_CLIPBOARD/, 'the JS side has a refusal reason for a missing plugin');
assert.match(
    js,
    /sensitive && isNativeShell\(env\)/,
    'the JS side refuses a sensitive copy on a native shell with no plugin',
);
assert.ok(
    !/navigator\.clipboard/.test(read('packages', 'core', 'src', 'ui', 'CopyButton.jsx')),
    'CopyButton no longer writes the clipboard itself: one path, or the two drift',
);

console.log(
    'OK: mobile clipboard smoke (SSC-4: one plugin name across JS + Swift + Java,'
    + ' write/clear implemented and declared on both shells, registered on both'
    + ' (iOS also in the pbxproj Sources phase), iOS localOnly + expirationDate,'
    + ' Android EXTRA_IS_SENSITIVE + clearPrimaryClip, and the JS refusal that keeps a'
    + ' sensitive copy off the web API on a native shell)',
);
