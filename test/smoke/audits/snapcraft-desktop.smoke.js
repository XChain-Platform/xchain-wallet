// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Exercise electron-builder's Core 24 generator without invoking snapcraft.
// Assert the project-root path that Snapcraft 9 validates before building.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const require = createRequire(import.meta.url);
const requireFromDesktop = createRequire(join(desktop, 'package.json'));
const builderPackage = requireFromDesktop.resolve('app-builder-lib/package.json');
const builderRoot = dirname(builderPackage);
const { SnapCore24 } = require(join(builderRoot, 'out', 'targets', 'snap', 'core24.js'));
const { Arch } = requireFromDesktop('builder-util');

const configPath = join(desktop, 'electron-builder.config.cjs');
const config = require(configPath);
const fixture = mkdtempSync(join(tmpdir(), 'xchain-snapcraft-desktop-'));
const outDir = join(fixture, 'dist');
const ARCHES = [
    { arch: Arch.x64, name: 'x64' },
    { arch: Arch.arm64, name: 'arm64' },
];

const packagerOptions = {
    // Stop after generation so the smoke needs neither snapcraft nor a browser.
    effectiveOptionComputed: async () => true,
};
const packager = {
    appInfo: {
        productName: 'XChain Wallet',
        version: '0.0.0-fixture',
    },
    buildResourcesDir: join(desktop, 'build'),
    config: { snapcraft: config.snapcraft },
    executableName: 'xchain-wallet',
    info: {
        stageDirPathCustomizer: (_target, _packager, arch) => {
            const entry = ARCHES.find((candidate) => candidate.arch === arch);
            return join(outDir, `__snap-${entry.name}`);
        },
    },
    packagerOptions,
};
const helper = {
    get icons() { return Promise.resolve([]); },
    get maxIconPath() { return null; },
    getDescription: () => 'Snapcraft desktop fixture',
    getDesktopFileName: () => 'xchain-wallet',
    isElectronVersionGreaterOrEqualThan: () => true,
    writeDesktopEntry: async (_options, command, destination) => {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, `[Desktop Entry]\nExec=${command}\nName=XChain Wallet\n`);
    },
};

for (const { arch, name } of ARCHES) {
    const appOutDir = join(fixture, `linux-${name}-unpacked`);
    const stageDir = join(outDir, `__snap-${name}`);
    mkdirSync(appOutDir, { recursive: true });
    writeFileSync(join(appOutDir, 'xchain-wallet'), 'fixture executable\n', { mode: 0o755 });

    await config.afterPack({
        appOutDir,
        arch,
        electronPlatformName: 'linux',
        outDir,
        packager,
        targets: [{ name: 'snap', outDir }],
    });

    const core = new SnapCore24(packager, helper, config.snapcraft.core24);
    const snap = await core.createDescriptor(arch);
    await core.buildSnap({
        appOutDir,
        artifactPath: join(outDir, `fixture-${name}.snap`),
        snap,
        snapArch: arch,
        stageDir,
    });

    const yamlPath = join(stageDir, 'snap', 'snapcraft.yaml');
    const sourceDesktop = join(stageDir, 'snap', 'gui', 'xchain-wallet.desktop');
    const expectedDesktop = join(stageDir, 'meta', 'gui', 'xchain-wallet.desktop');

    assert.ok(existsSync(yamlPath), `${name}: electron-builder generated snap/snapcraft.yaml`);
    assert.equal(snap.apps['xchain-wallet'].desktop, 'meta/gui/xchain-wallet.desktop',
        `${name}: the generated descriptor points to the path Snapcraft validates`);
    assert.match(readFileSync(yamlPath, 'utf8'),
        /desktop:\s+meta\/gui\/xchain-wallet\.desktop/,
        `${name}: the serialized snapcraft.yaml keeps the same desktop path`);
    assert.ok(existsSync(sourceDesktop),
        `${name}: the snap/gui source remains for Snapcraft 8 automatic desktop integration`);
    assert.ok(existsSync(expectedDesktop),
        `${name}: the desktop file exists at the project-relative path required by Snapcraft 9`);
    assert.equal(readFileSync(expectedDesktop, 'utf8'), readFileSync(sourceDesktop, 'utf8'),
        `${name}: both Snapcraft versions consume the same generated desktop entry`);
}

console.log('OK: x64 and arm64 Core 24 desktops staged for Snapcraft 8 and 9');
