// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the wrong-arch native addon guard.
//
// WHAT THIS IS DEFENDING. v0.343.1's arm64 .deb and AppImage carried the
// x86-64 secp256k1.node the amd64 install compiled, because npmRebuild is
// off and one node_modules feeds every target arch. The app started, the
// addon failed to load and its JS fallback ran, so nothing anywhere failed.
// The config's linux afterPack now refuses any `.node` whose ELF machine is
// not the packed tree's arch; this drives that hook and the module's CLI
// over stand-in trees whose addons are bare ELF headers.
//
// Coverage:
//
//   1. The local Arch table matches the installed builder-util enum, so the
//      number a hook receives names the arch the table says it does.
//   2. The ELF reader: x64, arm64, a big-endian header, a short file and a
//      non-ELF file.
//   3. The config's linux afterPack passes a tree with no addon and a tree
//      whose addon matches, for both arches, and refuses each direction of
//      mismatch, a Mach-O `.node` and an unknown machine, naming the file.
//      The same holds for an addon packed inside app.asar or unpacked
//      beside it, in archives made by @electron/asar, and an app.asar that
//      cannot be read fails instead of passing unchecked.
//   4. A linux afterPack with no arch throws rather than skipping the check.
//   5. darwin and win32 afterPack never read the tree.
//   6. The CLI exits 0 on a good tree and 1 on a mismatch.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const requireCjs = createRequire(import.meta.url);

const GUARD = join(desktop, 'scripts', 'linux-native-arch.cjs');
const ARCH = { x64: 1, arm64: 3 }; // builder-util Arch values

const {
    ARCH_BY_ENUM, archName, assertLinuxNativeAddonsMatchArch, elfArch,
} = requireCjs(GUARD);
const config = requireCjs(join(desktop, 'electron-builder.config.cjs'));

// --- 1. The Arch table is builder-util's ------------------------------
{
    const desktopRequire = createRequire(join(desktop, 'package.json'));
    const builderRequire = createRequire(desktopRequire.resolve('app-builder-lib'));
    const { Arch } = builderRequire('builder-util');
    for (const [value, name] of Object.entries(ARCH_BY_ENUM)) {
        assert.equal(Arch[name], Number(value), `builder-util Arch.${name} is ${value}`);
    }
}

// An ELF64 header with the given e_machine; only the first 20 bytes matter.
function elfHeader(machine, { bigEndian = false } = {}) {
    const b = Buffer.alloc(64);
    b.set([0x7f, 0x45, 0x4c, 0x46, 2, bigEndian ? 2 : 1, 1], 0);
    if (bigEndian) b.writeUInt16BE(machine, 18);
    else b.writeUInt16LE(machine, 18);
    return b;
}
const X64 = elfHeader(0x3e);
const ARM64 = elfHeader(0xb7);
const MACHO_ARM64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01,
    ...new Array(24).fill(0)]);

// --- 2. The ELF reader -----------------------------------------------
assert.deepEqual(elfArch(X64), { elf: true, arch: 'x64', machine: 0x3e });
assert.deepEqual(elfArch(ARM64), { elf: true, arch: 'arm64', machine: 0xb7 });
assert.deepEqual(elfArch(elfHeader(0xb7, { bigEndian: true })), { elf: true, arch: 'arm64', machine: 0xb7 },
    'e_machine is read in the file\'s own byte order');
assert.equal(elfArch(X64.subarray(0, 10)).elf, false, 'a short file is not an ELF');
assert.equal(elfArch(MACHO_ARM64).elf, false, 'a Mach-O is not an ELF');
assert.equal(archName(ARCH.arm64), 'arm64');
assert.equal(archName('x64'), 'x64');

const work = mkdtempSync(join(tmpdir(), 'xchain-linux-native-arch-'));
try {
    // A stand-in packed Linux app: the electron binary plus, optionally, one
    // addon at the path tiny-secp256k1 shipped from.
    const ADDON = join('resources', 'app.asar.unpacked', 'node_modules', 'tiny-secp256k1',
        'build', 'Release', 'secp256k1.node');
    function tree(name, exe, addon) {
        const root = join(work, name);
        mkdirSync(join(root, 'resources'), { recursive: true });
        writeFileSync(join(root, 'xchain-wallet'), exe);
        if (addon) {
            mkdirSync(dirname(join(root, ADDON)), { recursive: true });
            writeFileSync(join(root, ADDON), addon);
        }
        return root;
    }
    const afterPack = (appOutDir, arch, platform = 'linux') => config.afterPack({
        electronPlatformName: platform, arch, appOutDir,
    });
    async function refused(appOutDir, arch, pattern, label, fileName = 'secp256k1.node') {
        await assert.rejects(afterPack(appOutDir, arch), (err) => {
            assert.equal(err.name, 'LinuxNativeArchMismatch', `${label}: error name`);
            assert.match(err.message, pattern, `${label}: the message names the problem`);
            assert.ok(err.message.includes(fileName), `${label}: the message names the file`);
            return true;
        }, label);
    }

    // --- 3. afterPack over stand-in trees -----------------------------
    await afterPack(tree('x64-none', X64), ARCH.x64);
    await afterPack(tree('arm64-none', ARM64), ARCH.arm64);
    await afterPack(tree('x64-own', X64, X64), ARCH.x64);
    await afterPack(tree('arm64-own', ARM64, ARM64), ARCH.arm64);
    assert.deepEqual(
        assertLinuxNativeAddonsMatchArch(join(work, 'arm64-own'), ARCH.arm64).addons,
        [{ file: ADDON, arch: 'arm64' }],
        'a right-arch addon is reported, not just tolerated',
    );

    // The v0.343.1 shape: the host's x86-64 addon in the arm64 tree.
    await refused(tree('arm64-host-addon', ARM64, X64), ARCH.arm64,
        /ELF machine is x64, the tree is arm64/, 'x64 addon in the arm64 tree');
    await refused(tree('x64-foreign-addon', X64, ARM64), ARCH.x64,
        /ELF machine is arm64, the tree is x64/, 'arm64 addon in the x64 tree');
    await refused(tree('arm64-macho-addon', ARM64, MACHO_ARM64), ARCH.arm64,
        /not an ELF object/, 'Mach-O addon in a linux tree');
    await refused(tree('arm64-riscv-addon', ARM64, elfHeader(0xf3)), ARCH.arm64,
        /unknown e_machine 0xf3/, 'unknown-machine addon');

    // An addon packed INSIDE app.asar: electron-builder leaves a `.node` it
    // does not recognise as a package's native module in the archive, and
    // Electron still loads it from there. Archives are made by the
    // @electron/asar electron-builder itself uses, so the reader is held to
    // the real format, unpacked entries included.
    const asar = createRequire(createRequire(join(desktop, 'package.json'))
        .resolve('app-builder-lib'))('@electron/asar');
    async function asarTree(name, addon, options = {}) {
        const root = tree(name, ARM64);
        const src = join(work, `${name}-src`);
        mkdirSync(join(src, 'main'), { recursive: true });
        writeFileSync(join(src, 'main', 'index.js'), '// stand-in\n');
        writeFileSync(join(src, 'main', 'probe.node'), addon);
        await asar.createPackageWithOptions(src, join(root, 'resources', 'app.asar'), options);
        return root;
    }
    await refused(await asarTree('arm64-asar-x64', X64), ARCH.arm64,
        /resources\/app\.asar\/main\/probe\.node: ELF machine is x64, the tree is arm64/,
        'x64 addon inside the arm64 app.asar', 'probe.node');
    await afterPack(await asarTree('arm64-asar-own', ARM64), ARCH.arm64);
    await refused(await asarTree('arm64-asar-unpacked-x64', X64, { unpack: '*.node' }), ARCH.arm64,
        /resources\/app\.asar\.unpacked\/main\/probe\.node: ELF machine is x64/,
        'x64 addon asar-unpacked beside the arm64 app.asar', 'probe.node');
    assert.deepEqual(
        assertLinuxNativeAddonsMatchArch(join(work, 'arm64-asar-own'), ARCH.arm64).addons,
        [{ file: 'resources/app.asar/main/probe.node', arch: 'arm64' }],
        'an addon inside the archive is found once',
    );
    const notAsar = tree('arm64-bad-asar', ARM64);
    writeFileSync(join(notAsar, 'resources', 'app.asar'), 'not an archive');
    await assert.rejects(afterPack(notAsar, ARCH.arm64),
        (err) => err.name === 'LinuxNativeArchUnreadable',
        'an unreadable app.asar fails rather than passing unchecked');

    // A link out of the tree is not followed.
    const linked = tree('arm64-link', ARM64);
    symlinkSync(join(work, 'arm64-host-addon', ADDON), join(linked, 'resources', 'outside.node'));
    await afterPack(linked, ARCH.arm64);

    // --- 4. No arch is an error, not a pass ---------------------------
    await assert.rejects(afterPack(join(work, 'arm64-host-addon'), undefined),
        (err) => err.name === 'LinuxNativeArchUnknown',
        'a linux afterPack without an arch throws');
    await assert.rejects(afterPack(join(work, 'arm64-host-addon'), 4),
        (err) => err.name === 'LinuxNativeArchUnknown',
        'universal is not a Linux target arch');

    // --- 5. Other platforms never read the tree -----------------------
    for (const platform of ['darwin', 'win32']) {
        await afterPack(join(work, 'no-such-dir'), ARCH.arm64, platform);
    }

    // --- 6. The CLI ---------------------------------------------------
    const cli = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
    const good = cli(join(work, 'x64-own'), 'x64', join(work, 'arm64-none'), 'arm64');
    assert.equal(good.status, 0, `CLI passes good trees: ${good.stderr}`);
    assert.match(good.stdout, /\[x64\]: .*secp256k1\.node \(x64\)/);
    assert.match(good.stdout, /\[arm64\]: no native addon/);
    const bad = cli(join(work, 'arm64-host-addon'), 'arm64');
    assert.equal(bad.status, 1, 'CLI fails a wrong-arch addon');
    assert.match(bad.stderr, /LinuxNativeArchMismatch/);
    assert.equal(cli(join(work, 'x64-own')).status, 2, 'CLI rejects an odd argument count');
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log('linux-native-arch.smoke.js: ok');
