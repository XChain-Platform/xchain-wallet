// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §13: the Mac App Store lane.
//
// WHAT THIS IS DEFENDING. The App Store channel differs from the
// direct-download one in ways that DO NOT FAIL THE BUILD - they fail at
// upload, at App Review, or at runtime on a user's machine. app-builder-lib
// computes the mas config as `deepAssign({}, mac, config.mas)`, so every
// macOS setting silently becomes the App Store default unless overridden,
// and two of those defaults are actively wrong:
//
//   - inheriting `mac.entitlements` signs a store build with the Developer
//     ID entitlements, which contain no app-sandbox key at all;
//   - inheriting `mac.hardenedRuntime: true` applies the hardened runtime
//     to a store build, which MacTargetHelper honours for mas via
//     `isMas ? config.hardenedRuntime === true : ...`.
//
// Neither produces an error locally. Both are expensive to discover.
//
// Coverage:
//
//   1. Both entitlement files exist and are well-formed plists.
//   2. The MAS entitlements declare the sandbox and exactly the
//      capabilities the wallet uses, and none of the hardened-runtime
//      keys that are meaningless (and a review flag) under it.
//   3. The inherit file inherits rather than re-declaring.
//   4. The config's mas block overrides entitlements + hardenedRuntime
//      rather than inheriting them from mac.
//   5. The mas target is opt-in, and never present on a staging build.
//   6. The direct-download lane is untouched when MAS is off.
//   7. attachUpdater refuses to run on a store build (process.mas).

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUpdater } from '../../../packages/desktop/main/updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const buildDir = join(desktop, 'build');
const requireCjs = createRequire(import.meta.url);
const configPath = join(desktop, 'electron-builder.config.cjs');

// Reload the config under a chosen environment: the target list is
// computed at module load, so requiring a cached copy would test nothing.
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

// Tiny plist reader: returns the set of <key> names mapped to true.
function plistTrueKeys(file) {
    const xml = readFileSync(file, 'utf8');
    assert.ok(xml.includes('<plist'), `${file} is a plist`);
    const keys = new Map();
    const re = /<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) keys.set(m[1], m[2] === 'true');
    return keys;
}

// --- 1/2. MAS entitlements --------------------------------------------

const masPlist = join(buildDir, 'entitlements.mas.plist');
const inheritPlist = join(buildDir, 'entitlements.mas.inherit.plist');
assert.ok(existsSync(masPlist), 'build/entitlements.mas.plist exists');
assert.ok(existsSync(inheritPlist), 'build/entitlements.mas.inherit.plist exists');

const mas = plistTrueKeys(masPlist);
assert.equal(
    mas.get('com.apple.security.app-sandbox'),
    true,
    'the App Store build declares the sandbox: this is the one key the store requires',
);
for (const key of [
    'com.apple.security.network.client',
    'com.apple.security.device.usb',
    'com.apple.security.files.user-selected.read-write',
]) {
    assert.equal(mas.get(key), true, `MAS entitlements grant ${key}`);
}
// USB is load-bearing: without it a store build cannot reach Ledger or
// Trezor, which both ride WebHID.
assert.equal(
    mas.get('com.apple.security.device.usb'),
    true,
    'hardware signers (Ledger/Trezor over WebHID) keep USB access under the sandbox',
);
for (const forbidden of [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.network.server',
]) {
    assert.ok(
        !mas.has(forbidden),
        `MAS entitlements do not carry ${forbidden} (hardened-runtime/server keys have no place under the sandbox)`,
    );
}

// --- 3. Inherit file ---------------------------------------------------

const inherit = plistTrueKeys(inheritPlist);
assert.equal(inherit.get('com.apple.security.app-sandbox'), true, 'child processes are sandboxed');
assert.equal(
    inherit.get('com.apple.security.inherit'),
    true,
    'child processes INHERIT the parent sandbox rather than declaring their own grants',
);
assert.ok(
    !inherit.has('com.apple.security.device.usb'),
    'the inherit file does not re-declare parent capabilities',
);

// --- 4. The overrides that stop mac config leaking into mas -----------

const config = loadConfig();
assert.ok(config.mas, 'the config declares a mas block');
assert.equal(
    config.mas.entitlements,
    'build/entitlements.mas.plist',
    'mas.entitlements is overridden; inheriting mac.entitlements would sign a store build with no sandbox key',
);
assert.equal(
    config.mas.entitlementsInherit,
    'build/entitlements.mas.inherit.plist',
    'mas.entitlementsInherit is set for the Electron helper bundles',
);
assert.equal(
    config.mas.hardenedRuntime,
    false,
    'mas.hardenedRuntime is explicitly false; the inherited mac value would be honoured for mas',
);
assert.notEqual(
    config.mas.entitlements,
    config.mac.entitlements,
    'the two macOS channels do NOT share an entitlements file',
);
assert.ok(
    config.mas.artifactName && config.mas.artifactName.includes('-mas.'),
    'store artifacts are named -mas so they are never mistaken for direct-download ones',
);
assert.notEqual(
    config.mas.artifactName,
    config.mac.artifactName,
    'the store .pkg does not inherit the -mac artifact name',
);
assert.equal(config.mac.hardenedRuntime, true, 'the direct-download channel keeps the hardened runtime');

// --- 5/6. The target is opt-in and never on staging -------------------

const names = (cfg) => (cfg.mac.target || []).map((t) => t.target);
assert.ok(!names(config).includes('mas'), 'mas is NOT built by default: it needs certs a dev machine lacks');
assert.deepEqual(
    names(config),
    ['dmg', 'zip'],
    'with MAS off the direct-download lane is exactly what it was',
);

const masOn = loadConfig({ XCHAIN_BUILD_MAS: '1' });
assert.ok(names(masOn).includes('mas'), 'XCHAIN_BUILD_MAS=1 adds the store target');
assert.ok(names(masOn).includes('dmg'), 'and does not displace the direct-download targets');

const masStaging = loadConfig({
    XCHAIN_BUILD_MAS: '1',
    XCHAIN_STAGING_FEED_URL: 'https://staging.example.invalid/feed/',
});
assert.ok(
    !names(masStaging).includes('mas'),
    'a staging/rehearsal build never carries mas: the App Store owns updates, so there is no feed to rehearse',
);

// --- 7. A store build must not self-update ----------------------------

const savedMas = process.mas;
try {
    process.mas = true;
    let loaderCalled = false;
    const result = await attachUpdater({
        onEvent() {},
        loader: async () => { loaderCalled = true; return {}; },
    });
    assert.equal(result.isActive, false, 'attachUpdater is inert on a Mac App Store build');
    assert.equal(
        loaderCalled,
        false,
        'and short-circuits BEFORE loading electron-updater, so a store build never registers listeners',
    );
    await result.checkForUpdates();
    await result.downloadAndInstall();
} finally {
    if (savedMas === undefined) delete process.mas;
    else process.mas = savedMas;
}

// A release can actually PRODUCE it. The lane was opt-in behind
// XCHAIN_BUILD_MAS=1 and no workflow ever set it, so every gate above passed
// while a release could not emit the `.pkg` the channel ships.
{
    const wf = readFileSync(join(here, '..', '..', '..', '.github', 'workflows',
        'release.yml'), 'utf8');
    assert.ok(/XCHAIN_BUILD_MAS:\s*'1'/.test(wf),
        'release.yml must have a step that sets XCHAIN_BUILD_MAS=1, or the App '
        + 'Store channel is a goal no release can ship');
    assert.ok(/if:\s*env\.MAS_CSC_LINK\s*!=\s*''/.test(wf),
        'and it must be gated on the Apple Distribution cert being present: it '
        + 'is a different certificate from the Developer ID one, so the lane '
        + 'must not ride the direct-download credentials');
}

console.log(
    'OK: MAS lane smoke ( §13: build/entitlements.mas{,.inherit}.plist exist and are well-formed; the '
        + 'store build declares com.apple.security.app-sandbox plus exactly network.client, device.usb (Ledger/'
        + 'Trezor over WebHID) and files.user-selected, and carries no hardened-runtime or network.server keys; '
        + 'child bundles inherit the sandbox rather than re-declaring it; the mas config block explicitly '
        + 'overrides entitlements + hardenedRuntime, which app-builder-lib would otherwise deepAssign in from '
        + 'mac and silently produce an unsandboxed, hardened store build; the mas target is opt-in via '
        + 'XCHAIN_BUILD_MAS and never present on a staging build, leaving the direct-download lane byte-identical '
        + 'when off; and attachUpdater short-circuits on process.mas before loading electron-updater, because an '
        + 'App Store build must never ship its own updater)',
);
