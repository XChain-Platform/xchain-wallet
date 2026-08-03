// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §16 : the Snap Store lane.
//
// WHAT THIS IS DEFENDING, same family as the mas/msstore smokes next
// door: a third store channel whose wrong settings do not fail the build.
// The lane-specific ones, verified against the installed app-builder-lib
// 26.15.7 rather than assumed:
//
//   1. SnapTarget's default artifactName is `${name}_${version}_${arch}`
//      and `${name}` is the scoped `@xchain-wallet/desktop` - a SLASH in
//      the filename, so the artifact lands in a subdirectory nothing
//      looks in. The exact defect the deb lane already hit.
//   2. Supplying ANY explicit plugs list turns off the automatic
//      `browser-support (allow-sandbox: true)` injection, and without
//      that plug the generated launcher appends `--no-sandbox`: the
//      wallet would ship with Chromium's sandbox OFF, silently.
//   3. snapd owns updates for a snap install, and Electron has NO process
//      flag for it (no `process.snap` beside `process.mas` and
//      `process.windowsStore`), so the updater guard rides snapd's own
//      env vars - and a stray `package-type: deb` staged out of the
//      shared linux-unpacked tree (§5's race, one packaging over) would
//      otherwise hand a confined snap the DebUpdater and a root
//      `pkexec dpkg -i`.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUpdater, selectUpdater } from '../../../packages/desktop/main/updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
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

const targets = (cfg) => cfg.linux.target.map((t) => (typeof t === 'string' ? t : t.target));

// --- 1. The lane is opt-in ---------------------------------------------
//
// Unconditional would break every build on a host without the snapcraft
// CLI, which is every dev box and every default runner image.
{
    const off = loadConfig({ XCHAIN_BUILD_SNAP: undefined, XCHAIN_STAGING_FEED_URL: undefined });
    assert.ok(!targets(off).includes('snap'),
        'the snap target must not appear without XCHAIN_BUILD_SNAP=1');
    assert.deepEqual(targets(off), ['AppImage', 'deb'],
        'and the direct-download Linux lane is untouched when the store lane is off');

    const on = loadConfig({ XCHAIN_BUILD_SNAP: '1', XCHAIN_STAGING_FEED_URL: undefined });
    assert.ok(targets(on).includes('snap'), 'XCHAIN_BUILD_SNAP=1 adds the store target');
    assert.ok(targets(on).includes('AppImage') && targets(on).includes('deb'),
        'without removing the direct-download artifacts: all three Linux channels ship');
}

// --- 2. A rehearsal build never carries it -----------------------------
//
// §7.5 rehearses OUR update path. snapd owns updates for this channel, so
// a staging snap would exercise nothing and would put a store artifact in
// the staging tree.
{
    const staging = loadConfig({
        XCHAIN_BUILD_SNAP: '1',
        XCHAIN_STAGING_FEED_URL: 'https://staging.invalid/feed/',
    });
    assert.ok(!targets(staging).includes('snap'),
        'a staging build must never emit a store package');
}

// --- 3. The artifact name is pinned, with its arch ----------------------
{
    const cfg = loadConfig({ XCHAIN_BUILD_SNAP: '1' });
    assert.ok(cfg.snapcraft, 'the snapcraft block must exist even when the target is off');
    assert.equal(cfg.snapcraft.artifactName, 'xchain-wallet_${version}_${arch}.${ext}',
        'the default derives from the SCOPED package name and contains a slash;'
        + ' the pin is what keeps the artifact out of a subdirectory (same defect'
        + ' as the deb default, §5)');
    assert.match(cfg.snapcraft.artifactName, /\$\{arch\}/,
        'and carries its architecture: the Store serves a per-arch snap');
}

// --- 4. Base, confinement and grade are pinned --------------------------
//
// `base: core24` selects the maintained strategy (the legacy flat `snap`
// key's template fast path covers x64 only, which cannot serve a two-arch
// matrix). Strict confinement is what passes automated store review;
// `classic` requires manual approval and forfeits the isolation story, so
// flipping it is a decision, not a tweak. `grade: stable` is what may be
// released to the stable/candidate channels.
{
    const cfg = loadConfig({ XCHAIN_BUILD_SNAP: '1' });
    assert.equal(cfg.snapcraft.base, 'core24', 'base must be pinned to core24');
    assert.ok(cfg.snapcraft.core24, 'the core24 options block must exist');
    assert.equal(cfg.snapcraft.core24.confinement, 'strict',
        'strict confinement: automated review, real sandbox (§16; classic is a'
        + ' recorded decision, never a default)');
    assert.equal(cfg.snapcraft.core24.grade, 'stable',
        'grade devel cannot be promoted to the stable channel');
    assert.ok(cfg.snapcraft.core24.summary
        && cfg.snapcraft.core24.summary.length <= 78,
        'the store summary must exist and fit the 78-char limit');
}

// --- 5. The plugs keep Chromium's sandbox ON, and declare the signer
//        interfaces ------------------------------------------------------
//
// Supplying an explicit plugs list disables app-builder-lib's automatic
// browser-support injection. Without `browser-support (allow-sandbox:
// true)` the generated launcher appends `--no-sandbox` and the wallet
// ships with Chromium's own sandbox OFF - no build error, no warning.
// `raw-usb` + `u2f-devices` are the interfaces the §16 hardware-signer
// test needs; declaring them is free, only AUTO-connect needs Store
// approval.
{
    const { plugs } = loadConfig({ XCHAIN_BUILD_SNAP: '1' }).snapcraft.core24;
    assert.ok(Array.isArray(plugs), 'plugs must be an explicit pinned list');
    assert.ok(plugs.includes('default'),
        'the standard Electron plug set stays (desktop, x11, wayland, network, ...)');
    const browserSupport = plugs.find(
        (p) => typeof p === 'object' && p !== null && p['browser-support'],
    );
    assert.ok(browserSupport,
        'browser-support must be restated: an explicit plugs list turns off the'
        + ' automatic injection');
    assert.equal(browserSupport['browser-support']['allow-sandbox'], true,
        "and must carry allow-sandbox: true, or the launcher appends --no-sandbox"
        + " and Chromium's sandbox is silently OFF");
    assert.ok(plugs.includes('raw-usb') && plugs.includes('u2f-devices'),
        'the hardware-signer interfaces must be declared (§16: the WebHID-under-'
        + 'confinement test is the ship/no-ship risk)');
}

// --- 6. A snap build must not self-update -------------------------------
//
// The runtime half, driven rather than read. snapd sets SNAP + SNAP_NAME
// for every process it launches; there is no Electron process flag.
{
    const savedSnap = process.env.SNAP;
    const savedName = process.env.SNAP_NAME;
    process.env.SNAP = '/snap/xchain-wallet/42';
    process.env.SNAP_NAME = 'xchain-wallet';
    try {
        let loaded = false;
        const updater = await attachUpdater({
            onEvent() {},
            loader: async () => { loaded = true; return {}; },
        });
        assert.equal(updater.isActive, false, 'the updater must be inert in a snap');
        assert.equal(loaded, false,
            'and electron-updater must not even be LOADED: the short-circuit is before the import');
        await updater.checkForUpdates();
    } finally {
        if (savedSnap === undefined) delete process.env.SNAP;
        else process.env.SNAP = savedSnap;
        if (savedName === undefined) delete process.env.SNAP_NAME;
        else process.env.SNAP_NAME = savedName;
    }

    // One stray variable is NOT a snap: a shell that happens to export
    // SNAP alone must not silently disable updates on a direct-download
    // install (a missed update on a wallet is a security regression).
    const savedLoneSnap = process.env.SNAP;
    process.env.SNAP = '/some/leftover';
    delete process.env.SNAP_NAME;
    try {
        let loadedLone = false;
        await attachUpdater({
            onEvent() {},
            loader: async () => {
                loadedLone = true;
                return { autoUpdater: { checkForUpdates() {}, on() {}, once() {} } };
            },
        }).catch(() => {});
        assert.equal(loadedLone, true,
            'SNAP without SNAP_NAME is not a snap: the direct-download build still updates');
    } finally {
        if (savedLoneSnap === undefined) delete process.env.SNAP;
        else process.env.SNAP = savedLoneSnap;
    }
}

// --- 7. selectUpdater's third answer: a snap gets NO updater class ------
//
// The §5 package-type race, one packaging over: snapcraft stages the same
// linux-unpacked tree the deb target writes `package-type` into, and the
// mksquashfs wrapper that strips it protects only the AppImage's own
// image. A snap carrying `package-type: deb` would be handed DebUpdater
// and a root `pkexec dpkg -i` - every hash and signature check passing.
{
    let debConstructed = false;
    let appImageConstructed = false;
    const mod = {
        autoUpdater: { checkForUpdates() {} },
        DebUpdater: class { constructor() { debConstructed = true; } },
        AppImageUpdater: class { constructor() { appImageConstructed = true; } },
    };
    const snapEnv = { SNAP: '/snap/xchain-wallet/42', SNAP_NAME: 'xchain-wallet' };
    const withPackageType = (type) => ({
        resourcesPath: '/snap/xchain-wallet/42/resources',
        readFile: (p) => {
            if (String(p).endsWith('package-type')) return type;
            throw new Error(`unexpected read: ${p}`);
        },
    });

    const picked = selectUpdater(mod, {
        platform: 'linux', env: snapEnv, ...withPackageType('deb'),
    });
    assert.equal(picked.updater, null,
        'a snap gets NO electron-updater class, whatever the bundle claims');
    assert.equal(picked.snapManaged, true, 'and says why');
    assert.equal(debConstructed, false,
        'DebUpdater must never be constructed for a snap: its install step is a'
        + ' root dpkg -i');
    assert.equal(appImageConstructed, false, 'nor the AppImage one');

    // And attachUpdater honours that answer even when the env arrives via
    // the injectable `select` override rather than process.env: the
    // defense-in-depth half of the guard.
    let loaded = false;
    const updater = await attachUpdater({
        onEvent() {},
        loader: async () => { loaded = true; return mod; },
        select: { platform: 'linux', env: snapEnv, ...withPackageType('deb') },
    });
    assert.equal(loaded, true, '(this path is past the pre-load short-circuit by design)');
    assert.equal(updater.isActive, false,
        'attachUpdater returns the inert surface when selectUpdater says snapManaged');

    // The AppImage forcing from §5 is untouched by the new branch: same
    // mislabelled bundle, APPIMAGE env instead of SNAP.
    const appimage = selectUpdater(mod, {
        platform: 'linux',
        env: { APPIMAGE: '/tmp/x.AppImage' },
        ...withPackageType('deb'),
    });
    assert.ok(appimage.updater instanceof mod.AppImageUpdater,
        'a running AppImage still gets the AppImage updater forced (§5)');
}

// --- 8. The release gate knows about the artifact ----------------------
{
    const list = readFileSync(join(here, '..', '..', '..', 'tools', 'release',
        'expected-artifacts.txt'), 'utf8');
    const row = list.split('\n').find((l) => /^\s*optional\s+\*\.snap\s/.test(l));
    assert.ok(row, 'expected-artifacts.txt must declare the store package');
    const cols = row.trim().split(/\s+/);
    assert.equal(cols[3], 'x64,arm64',
        'and require both architectures: the Store serves a per-arch snap');
}

// --- 9. A release can actually PRODUCE it ------------------------------
//
// Same shape as the mas/appx findings: an opt-in flag nothing sets is a
// goal no release can ship.
{
    const wf = readFileSync(join(here, '..', '..', '..', '.github', 'workflows',
        'release.yml'), 'utf8');
    assert.ok(/XCHAIN_BUILD_SNAP:\s*'1'/.test(wf),
        'release.yml must have a step that sets XCHAIN_BUILD_SNAP=1, or the '
        + 'Store channel is a goal no release can ship');
    assert.ok(/if:\s*env\.SNAP_CSC_LINK\s*!=\s*''/.test(wf),
        'and it must be gated on the Snapcraft store credential being present: '
        + 'snapcraft is not on the runner image, and a store artifact nothing '
        + 'can upload would ride every release');
}

console.log(
    'OK: Snap Store lane smoke ( §16: the snap target is opt-in behind'
    + ' XCHAIN_BUILD_SNAP=1 and never present on a staging build, without removing'
    + ' the AppImage/deb lane; the artifact name is pinned past the scoped-package'
    + ' default and carries its arch; base core24, strict confinement, stable'
    + ' grade; the explicit plugs list restates browser-support with allow-sandbox'
    + " so Chromium's sandbox stays ON, and declares raw-usb + u2f-devices for the"
    + ' hardware-signer test; a process launched by snapd short-circuits'
    + ' attachUpdater before electron-updater is loaded, one stray SNAP variable'
    + ' does not, and selectUpdater hands a snap NO updater class even when the'
    + ' bundle carries a stray package-type; the release gate declares the'
    + ' artifact and release.yml can produce it behind the store credential)',
);
