// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the text the desktop installers write into shortcuts stays
// short enough for the OS to keep the shortcut intact.
//
// WHAT THIS IS DEFENDING. Through v0.343.0 packages/desktop/package.json
// carried a 318-character developer note as its `description`. The NSIS
// installer passes that string, as APP_DESCRIPTION, to every
// CreateShortCut call, and Windows caps a shortcut's comment at 260
// characters. The overflow corrupted the rest of each .lnk: the installed
// shortcut's icon location decoded as `rogram Files (x86)\XChain
// Wallet\XChain Wallet.exe...`, so the desktop and Start-menu shortcuts,
// and the taskbar button that borrows the Start-menu icon, all showed a
// blank page. The exe's own icon was fine, the build was green, and
// nothing in the build log mentioned it.
//
// The Linux side reads the same family of strings: the .desktop entry's
// Comment is `<target>.description || linux.description ||
// package.json description` (LinuxTargetHelper.getDescription), shown as
// the menu tooltip, so it is held to a tooltip-sized limit here.
//
// Coverage:
//
//   1. The Windows shortcut description, resolved the way app-builder-lib
//      resolves it, is under 260 characters.
//   2. The Linux .desktop Comment for every Linux target this config can
//      build is at most 120 characters.
//   3. No `linux.desktop.entry.Comment` override: computeDesktopEntry
//      assigns Comment from the description AFTER merging desktop.entry,
//      so such an override is silently discarded and reads as a fix
//      while doing nothing.
//   4. When app-builder-lib is installed, its source still routes the
//      strings this way, so an upstream change cannot make checks 1 and 2
//      measure the wrong field.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const CONFIG = join(desktop, 'electron-builder.config.cjs');
const require = createRequire(import.meta.url);

// The shortcut-comment ceiling: the 318-character v0.343.0 description
// corrupted the installed .lnk files, and 260 is the limit held here.
const WIN_SHORTCUT_MAX = 260;
// A .desktop Comment is a one-line tooltip; the freedesktop spec gives no
// hard cap, so this is a readability ceiling, not an OS limit.
const LINUX_COMMENT_MAX = 120;

// Ambient lane flags change which targets the config emits; scrub them so
// this file tests the config, not the caller's shell.
const OWNED_VARS = ['XCHAIN_REQUIRE_WIN_SIGNING', 'XCHAIN_REQUIRE_MAC_SIGNING',
    'XCHAIN_BUILD_MAS', 'XCHAIN_BUILD_APPX', 'XCHAIN_BUILD_SNAP',
    'XCHAIN_STAGING_FEED_URL', 'AZURE_CODE_SIGNING_ENDPOINT', 'AZURE_CODE_SIGNING_NAME',
    'AZURE_CERT_PROFILE_NAME', 'WIN_CSC_SUBJECT_NAME', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID'];

function loadConfig() {
    const saved = {};
    for (const k of OWNED_VARS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    try {
        delete require.cache[require.resolve(CONFIG)];
        return require(CONFIG);
    } finally {
        for (const k of OWNED_VARS) {
            if (saved[k] !== undefined) process.env[k] = saved[k];
        }
        delete require.cache[require.resolve(CONFIG)];
    }
}

const config = loadConfig();
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

// appInfo.description: package.json metadata with extraMetadata merged
// over it (Packager.readProjectMetadataIfTwoPackageStructureOrPrepare).
const appDescription = String(config.extraMetadata?.description ?? pkg.description ?? '');

// --- 1. Windows shortcut description ----------------------------------

assert.ok(appDescription.trim().length > 0,
    'the desktop package has a description (an empty one falls back to nothing useful)');
assert.ok(!/[\r\n]/.test(appDescription),
    'the shortcut description is one line');
assert.ok(appDescription.length < WIN_SHORTCUT_MAX,
    `the Windows shortcut description is under ${WIN_SHORTCUT_MAX} characters `
    + `(${appDescription.length}); longer corrupts the .lnk and blanks its icon`);

// --- 2. Linux .desktop Comment, per target ----------------------------

const linux = config.linux ?? {};
const snapCore = config.snapcraft ? (config.snapcraft[config.snapcraft.base] ?? {}) : {};
const linuxTargets = {
    deb: config.deb ?? {},
    appImage: config.appImage ?? {},
    rpm: config.rpm ?? {},
    pacman: config.pacman ?? {},
    snap: snapCore,
};
for (const [target, options] of Object.entries(linuxTargets)) {
    const comment = String(options.description || linux.description || appDescription);
    assert.ok(!/[\r\n]/.test(comment), `${target}: the .desktop Comment is one line`);
    assert.ok(comment.length <= LINUX_COMMENT_MAX,
        `${target}: the .desktop Comment is at most ${LINUX_COMMENT_MAX} characters `
        + `(${comment.length}): "${comment}"`);
}

// --- 3. No dead Comment override --------------------------------------

for (const [where, options] of [['linux', linux], ...Object.entries(linuxTargets)]) {
    assert.equal(options.desktop?.entry?.Comment, undefined,
        `${where}.desktop.entry.Comment is unset: computeDesktopEntry overwrites it `
        + 'with the description, so set the description instead');
}

// --- 4. The library still routes the strings this way -----------------

let libDir = null;
try {
    const requireFromDesktop = createRequire(join(desktop, 'package.json'));
    const builderPkg = requireFromDesktop.resolve('electron-builder/package.json');
    const requireFromBuilder = createRequire(builderPkg);
    libDir = dirname(requireFromBuilder.resolve('app-builder-lib/package.json'));
} catch {
    libDir = null;
}

if (libDir && existsSync(join(libDir, 'templates', 'nsis', 'include', 'installer.nsh'))) {
    const nsisTarget = readFileSync(join(libDir, 'out', 'targets', 'nsis', 'NsisTarget.js'), 'utf8');
    assert.match(nsisTarget, /APP_DESCRIPTION:\s*appInfo\.description\b/,
        'NsisTarget still defines APP_DESCRIPTION from appInfo.description');
    const installer = readFileSync(join(libDir, 'templates', 'nsis', 'include', 'installer.nsh'), 'utf8');
    const shortcutLines = installer.split('\n').filter((l) => /CreateShortCut\b/.test(l));
    assert.ok(shortcutLines.length > 0, 'installer.nsh still creates shortcuts');
    for (const line of shortcutLines) {
        assert.match(line, /\$\{APP_DESCRIPTION\}/,
            `installer.nsh shortcut still carries APP_DESCRIPTION: ${line.trim()}`);
    }
    const helper = readFileSync(join(libDir, 'out', 'targets', 'LinuxTargetHelper.js'), 'utf8');
    assert.match(helper,
        /return options\.description \|\| this\.packager\.appInfo\.description/,
        'LinuxTargetHelper.getDescription still falls back target -> linux -> package.json');
    assert.match(helper, /desktopMeta\.Comment = desktopStringEscape\(description\)/,
        'computeDesktopEntry still writes Comment from the description');
    console.log(`OK: desktop-shortcut-text smoke (windows ${appDescription.length} chars, `
        + `upstream wiring checked in ${libDir})`);
} else {
    console.log(`OK: desktop-shortcut-text smoke (windows ${appDescription.length} chars; `
        + 'app-builder-lib not installed, upstream wiring not checked)');
}
