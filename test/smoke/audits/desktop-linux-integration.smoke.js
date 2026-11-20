// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the Linux packages integrate with the desktop: the launcher
// finds an icon at every size a menu or dock asks for, the running window
// is matched to its launcher, and the .desktop file validates clean.
//
// WHAT THIS IS DEFENDING. Measured on the v0.343.0 arm64 .deb:
//
//   - linux.icon was the single 1024x1024 master, so the package installed
//     only hicolor/1024x1024. GTK's lookup of `xchain-wallet` at 48, 64,
//     128 and 256 returned NOT FOUND while has_icon said true: docks and
//     menus drew a generic icon.
//   - With no `desktopName` in package.json, Electron set the Wayland
//     app_id and X11 WM_CLASS to `xchain-wallet-desktop` while the launcher
//     said StartupWMClass=XChain Wallet, so a running window was never
//     paired with its launcher (no icon, a second dock entry).
//   - Categories=Finance; drew two desktop-file-validate hints: Finance is
//     an additional category and needs a registered main one (Office).
//
// Coverage:
//
//   1. linux.icon is build/icons, which holds a square RGBA PNG at every
//      hicolor size from 16 to 512, each named NxN.png.
//   2. package.json desktopName is `xchain-wallet.desktop`, the launcher's
//      own file name (linux.executableName + .desktop), so app_id,
//      WM_CLASS and StartupWMClass all read `xchain-wallet`.
//   3. linux.category is Office;Finance: a registered main category first.
//   4. When app-builder-lib is installed, it still derives StartupWMClass
//      from desktopName and writes Categories from linux.category.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const require = createRequire(import.meta.url);
const config = require(join(desktop, 'electron-builder.config.cjs'));
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

// --- 1. Icon set ---------------------------------------------------------

const HICOLOR_SIZES = [16, 32, 48, 64, 128, 256, 512];
assert.equal(config.linux.icon, 'build/icons',
    'linux.icon is the build/icons size set, not the single 1024 master');
for (const size of HICOLOR_SIZES) {
    const file = join(desktop, 'build', 'icons', `${size}x${size}.png`);
    assert.ok(existsSync(file), `build/icons/${size}x${size}.png exists`);
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(0), 0x89504e47, `${size}x${size}.png is a PNG`);
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR', `${size}x${size}.png starts with IHDR`);
    assert.equal(buf.readUInt32BE(16), size, `${size}x${size}.png is ${size} wide`);
    assert.equal(buf.readUInt32BE(20), size, `${size}x${size}.png is ${size} high`);
    assert.equal(buf[24], 8, `${size}x${size}.png is 8 bits per channel`);
    assert.equal(buf[25], 6, `${size}x${size}.png is RGBA, so its corners stay transparent`);
}

// --- 2. Window id --------------------------------------------------------

assert.equal(config.linux.executableName, 'xchain-wallet',
    'the launcher is named after linux.executableName');
assert.equal(pkg.desktopName, 'xchain-wallet.desktop',
    'package.json desktopName is the launcher file, so Electron sets app_id and WM_CLASS '
    + 'to xchain-wallet and StartupWMClass follows it');

// --- 3. Category ---------------------------------------------------------

assert.equal(config.linux.category, 'Office;Finance',
    'linux.category leads with the registered main category Office, then Finance');

// --- 4. The library still wires both -----------------------------------

let libDir = null;
try {
    const requireFromDesktop = createRequire(join(desktop, 'package.json'));
    const builderPkg = requireFromDesktop.resolve('electron-builder/package.json');
    libDir = dirname(createRequire(builderPkg).resolve('app-builder-lib/package.json'));
} catch {
    libDir = null;
}
const helperPath = libDir && join(libDir, 'out', 'targets', 'LinuxTargetHelper.js');
if (helperPath && existsSync(helperPath)) {
    const helper = readFileSync(helperPath, 'utf8');
    assert.match(helper,
        /const wmClass = !\(0, builder_util_1\.isEmptyOrSpaces\)\(trimmedDesktopName\) \? trimmedDesktopName\.replace\(\/\\\.desktop\$\/, ""\) : appInfo\.productName;/,
        'computeDesktopEntry still derives StartupWMClass from desktopName');
    assert.match(helper, /StartupWMClass: desktopStringEscape\(wmClass\)/,
        'computeDesktopEntry still writes StartupWMClass from that value');
    assert.match(helper, /desktopMeta\.Categories = `\$\{category\}\$\{category\.endsWith\(";"\) \? "" : ";"\}`/,
        'computeDesktopEntry still writes Categories from linux.category');
    console.log(`OK: desktop linux integration smoke (icons ${HICOLOR_SIZES.join('/')}, `
        + `desktopName, Office;Finance; upstream wiring checked in ${libDir})`);
} else {
    console.log(`OK: desktop linux integration smoke (icons ${HICOLOR_SIZES.join('/')}, `
        + 'desktopName, Office;Finance; app-builder-lib not installed, upstream wiring not checked)');
}
