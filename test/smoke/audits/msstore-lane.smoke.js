// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §15: the Microsoft Store (MSIX/AppX) lane.
//
// WHAT THIS IS DEFENDING, and it is the same shape as the Mac App Store
// smoke next door: a second store channel whose wrong settings do not fail
// the build. They fail at ingestion, at certification, or on a user's
// machine. Three of them are silent by construction, verified against
// app-builder-lib 26.15.7 rather than assumed:
//
//   1. AppxTarget computes its options as `deepAssign({}, win, appx)`, so
//      `win.artifactName` would name the store package
//      `XChain Wallet-<v>-x64-win.appx` - our direct-download convention,
//      on the one artifact that must never be mistaken for a hosted file.
//   2. `appx.publisher` left unset does not error. With no code-signing
//      certificate `computePublisherName` returns the literal `CN=ms`;
//      with one, it returns that CERTIFICATE's subject, which is the
//      Authenticode identity and not necessarily the Partner Center one.
//      Either way the package builds and is rejected at ingestion.
//   3. Any of the four Store tile PNGs that is missing is replaced by
//      electron-builder's own `SampleAppx.*.png` vendor artwork, with no
//      warning. That is how the app icon went missing for months
//      , and how the mobile shells shipped the Capacitor
//      template logo .
//
// And the runtime half: an MSIX install is updated by the Store, so the
// app must not run its own updater. Electron says which case it is in via
// `process.windowsStore`, the exact analogue of `process.mas`.

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
    try {
        delete requireCjs.cache[requireCjs.resolve(configPath)];
        return requireCjs(configPath);
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

const targets = (cfg) => cfg.win.target.map((t) => (typeof t === 'string' ? t : t.target));

// --- 1. The lane is opt-in ---------------------------------------------
//
// Unconditional would break every macOS and Linux build: AppxTarget
// refuses to run anywhere but Windows 10+ or a macOS host driving a
// Parallels VM, which no runner of ours is.
{
    const off = loadConfig({ XCHAIN_BUILD_APPX: undefined, XCHAIN_STAGING_FEED_URL: undefined });
    assert.ok(!targets(off).includes('appx'),
        'the appx target must not appear without XCHAIN_BUILD_APPX=1');
    assert.deepEqual(targets(off), ['nsis', 'zip'],
        'and the direct-download Windows lane is untouched when the store lane is off');

    const on = loadConfig({ XCHAIN_BUILD_APPX: '1', XCHAIN_STAGING_FEED_URL: undefined });
    assert.ok(targets(on).includes('appx'), 'XCHAIN_BUILD_APPX=1 adds the store target');
    assert.ok(targets(on).includes('nsis') && targets(on).includes('zip'),
        'without removing the direct-download artifacts: BOTH channels ship (operator, 2026-08-01)');
}

// --- 2. A rehearsal build never carries it -----------------------------
//
// §7.5 rehearses the update path. The Store owns updates for this
// channel, so a staging appx would exercise nothing and would put a
// store-identity package in the staging tree.
{
    const staging = loadConfig({
        XCHAIN_BUILD_APPX: '1',
        XCHAIN_STAGING_FEED_URL: 'https://staging.invalid/feed/',
    });
    assert.ok(!targets(staging).includes('appx'),
        'a staging build must never emit a store package');
}

// --- 3. The inheritance trap -------------------------------------------
{
    const cfg = loadConfig({ XCHAIN_BUILD_APPX: '1' });
    assert.ok(cfg.appx, 'the appx block must exist even when the target is off');
    assert.notEqual(cfg.appx.artifactName, cfg.win.artifactName,
        'appx must override win.artifactName rather than inherit it');
    assert.match(cfg.appx.artifactName, /-appx\.\$\{ext\}$/,
        'and the store package is named -appx, never -win');
    assert.match(cfg.appx.artifactName, /\$\{arch\}/,
        'and carries its architecture: the Store serves a per-arch package');
}

// --- 4. Identity is pinned, not defaulted ------------------------------
{
    const cfg = loadConfig({
        XCHAIN_BUILD_APPX: '1',
        APPX_IDENTITY_NAME: undefined,
        APPX_PUBLISHER: undefined,
    });
    // The package.json name is scoped (`@xchain-wallet/desktop`), and AppX
    // identity allows only alphanumerics, periods and dashes. Inheriting
    // the default fails the manifest write - a good failure, but only if
    // nobody "fixes" it by removing the pin.
    assert.ok(cfg.appx.identityName, 'identityName must be pinned, not left to the package name');
    assert.match(cfg.appx.identityName, /^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/,
        'and must satisfy the AppX identity character set and length');
    assert.equal(cfg.appx.publisherDisplayName, 'Dankest, LLC',
        'the friendly publisher name is the company name users see in the Store');
    assert.match(cfg.appx.applicationId, /^[A-Za-z]/,
        'applicationId must begin with an alphabetic character');

    const withEnv = loadConfig({
        XCHAIN_BUILD_APPX: '1',
        APPX_IDENTITY_NAME: 'A0000DankestLLC.XChainWallet',
        APPX_PUBLISHER: 'CN=00000000-1111-2222-3333-444444444444',
    });
    assert.equal(withEnv.appx.identityName, 'A0000DankestLLC.XChainWallet',
        'Partner Center assigns the identity, so it must be env-driven');
    assert.equal(withEnv.appx.publisher, 'CN=00000000-1111-2222-3333-444444444444',
        'and so must the publisher, or the package is rejected at ingestion');
}

// --- 5. Capabilities: full trust, and nothing else ----------------------
//
// `runFullTrust` is what makes this NOT the sandbox that decides whether
// the Mac App Store channel ships at all (§13). It is also the only
// capability a wallet has any business requesting; broadFileSystemAccess
// in particular is a certification flag.
{
    const cfg = loadConfig({ XCHAIN_BUILD_APPX: '1' });
    assert.deepEqual(cfg.appx.capabilities, ['runFullTrust'],
        'exactly one capability, declared explicitly rather than auto-added');
    assert.equal(cfg.appx.setBuildNumber, false,
        'Store submissions require the fourth version part to be 0');
}

// --- 6. The Store tiles are ours, not electron-builder's samples -------
{
    const tiles = [
        ['StoreLogo.png', 50, 50],
        ['Square150x150Logo.png', 150, 150],
        ['Square44x44Logo.png', 44, 44],
        ['Wide310x150Logo.png', 310, 150],
    ];
    for (const [name, w, h] of tiles) {
        const file = join(buildDir, 'appx', name);
        assert.ok(existsSync(file),
            `build/appx/${name} is missing; electron-builder would substitute its own`
            + ' SampleAppx artwork silently ( §15)');
        // Read the dimensions out of the PNG header rather than trusting
        // the filename: a placeholder of the wrong size is exactly the
        // kind of asset that survives review.
        const buf = readFileSync(file);
        assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${name} must be a PNG`);
        assert.equal(buf.readUInt32BE(16), w, `${name} must be ${w}px wide`);
        assert.equal(buf.readUInt32BE(20), h, `${name} must be ${h}px tall`);
        // Colour type 6 is RGBA. The tile background is a config value
        // (appx.backgroundColor), so the artwork has to be transparent.
        assert.equal(buf.readUInt8(25), 6, `${name} must carry an alpha channel`);
    }
}

// --- 7. A store build must not self-update ------------------------------
//
// The runtime half, driven rather than read. `process.windowsStore` is
// set when the app is RUNNING from an MSIX package.
{
    const saved = Object.getOwnPropertyDescriptor(process, 'windowsStore');
    Object.defineProperty(process, 'windowsStore', { value: true, configurable: true });
    try {
        let loaded = false;
        const updater = await attachUpdater({
            onEvent() {},
            loader: async () => { loaded = true; return {}; },
        });
        assert.equal(updater.isActive, false, 'the updater must be inert in a store build');
        assert.equal(loaded, false,
            'and electron-updater must not even be LOADED: the short-circuit is before the import');
        await updater.checkForUpdates();
    } finally {
        if (saved) Object.defineProperty(process, 'windowsStore', saved);
        else delete process.windowsStore;
    }

    // ...and the direct-download build still updates, which is the half
    // that would break silently if the guard were written too broadly.
    let loadedNormal = false;
    await attachUpdater({
        onEvent() {},
        loader: async () => {
            loadedNormal = true;
            return { autoUpdater: { checkForUpdates() {}, on() {}, once() {} } };
        },
    }).catch(() => {});
    assert.equal(loadedNormal, true,
        'a non-store build must still load electron-updater: both channels ship');
}

// --- 8. The release gate knows about the artifact ----------------------
{
    const list = readFileSync(join(here, '..', '..', '..', 'tools', 'release',
        'expected-artifacts.txt'), 'utf8');
    const row = list.split('\n').find((l) => /^\s*optional\s+\*-appx\.appx/.test(l));
    assert.ok(row, 'expected-artifacts.txt must declare the store package');
    const cols = row.trim().split(/\s+/);
    assert.equal(cols[3], 'x64,arm64',
        'and require both architectures: the Store serves a per-arch package');
}

// --- 9. A release can actually PRODUCE it -----------------------------
// The lane was opt-in behind XCHAIN_BUILD_APPX=1 and no workflow ever set
// it, so every gate above passed while a release could not emit the artifact
// at all. That is the same shape as the `optional` row above: a gate cannot
// fail on an artifact nothing builds.
{
    const wf = readFileSync(join(here, '..', '..', '..', '.github', 'workflows',
        'release.yml'), 'utf8');
    assert.ok(/XCHAIN_BUILD_APPX:\s*'1'/.test(wf),
        'release.yml must have a step that sets XCHAIN_BUILD_APPX=1, or the '
        + 'Store channel is a goal no release can ship');
    assert.ok(/if:\s*env\.APPX_IDENTITY_NAME\s*!=\s*''/.test(wf),
        'and it must be gated on the Partner Center identity being present: '
        + 'AppxTarget accepts a missing publisher and builds a package that is '
        + 'rejected at ingestion, which is worse than not building one');
}

console.log(
    'OK: Microsoft Store lane smoke ( §15: the appx target is opt-in behind'
    + ' XCHAIN_BUILD_APPX=1 and never present on a staging build, without removing'
    + ' the direct-download nsis/zip lane; appx overrides the inherited win'
    + ' artifactName so a store package can never be mistaken for a hosted file;'
    + ' identity and publisher are pinned and env-driven rather than defaulting to'
    + ' the scoped package name and CN=ms; capabilities are exactly runFullTrust;'
    + ' all four Store tiles exist at the right size with alpha, so'
    + " electron-builder's SampleAppx artwork can never be substituted; a build"
    + ' running from an MSIX package short-circuits attachUpdater before'
    + ' electron-updater is loaded, while a direct-download build still updates)',
);
