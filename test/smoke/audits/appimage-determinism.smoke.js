// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for DD7: the AppImage reproduces byte-for-byte.
//
// WHAT THIS IS DEFENDING. The AppImage was the one shipped artifact that
// did not reproduce, and the reason was a single u32 in the squashfs
// superblock: mksquashfs writes `mkfs_time` from the wall clock, and the
// build electron-builder pins (4.3-git, 2017) predates every flag that
// would say otherwise. The fix is a wrapper installed over that binary by
// a `beforePack` hook. Every part of that chain is silent when it breaks -
// a hook that stops firing, a wrapper that stops patching, an upstream
// rename that makes the shim materialize nothing - and the only visible
// symptom is a hash mismatch months later, which the verification protocol
// tells third parties to read as supply-chain tampering.
//
// So this drives the REAL chain (config hook -> toolset materializer ->
// installed wrapper -> patched image) against a FAKE mksquashfs. No
// network, no 30-minute container build, and every failure path exercised.
//
// Coverage:
//
//   1. Both scripts exist; the wrapper is a shebang script.
//   2. The config declares beforePack, and it is a no-op off Linux (the
//      mac and win lanes must not reach for a Linux toolset).
//   3. On Linux the hook materializes a shim and exports
//      APPIMAGE_TOOLS_PATH; an operator-supplied toolset gets shimmed
//      rather than discarded; a shim is never shimmed twice.
//   4. The installed wrapper pins BOTH clocks - the per-file mtimes the
//      real tool reads into the inode table, and the superblock's own
//      mkfs_time - so two runs at different wall clocks are byte-identical.
//      Pinning only the second one was measured NOT to be enough.
//   5. Without SOURCE_DATE_EPOCH it is a pass-through (dev builds).
//   6. It FAILS CLOSED on every unexpected condition: the real tool
//      failing, no squashfs magic, an unknown squashfs major, a
//      superblock that fails its own block_size/block_log self-check, and
//      an argument shape it does not recognise. Silently skipping the
//      patch would reproduce the original defect invisibly.
//   7. FILE MODES ARE PINNED TOO, for the AppImage AND the .deb. The
//      v0.341.3 reproduce check failed on all four Linux packages because
//      build/icon.png, copied verbatim (mode included) as the 1024x1024
//      icon, was 0644 in the CI checkout and 0664 in one made under umask
//      002. The mode rule (group/other = owner's r+x, never w; special
//      bits kept) is checked directly, then through the config's linux
//      beforePack (build resources) and afterPack (packed app), and the
//      installed mksquashfs wrapper is checked to apply the same rule to
//      its stage tree. Trees here are built under umask 002 on purpose:
//      that is the host the defect came from.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
    chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
    symlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const requireCjs = createRequire(import.meta.url);

const WRAPPER = join(desktop, 'scripts', 'mksquashfs-deterministic.cjs');
const TOOLSET = join(desktop, 'scripts', 'appimage-toolset.cjs');
const MODES = join(desktop, 'scripts', 'deterministic-modes.cjs');

const ARCH_X64 = 1; // builder-util Arch.x64
const EPOCH = 1785601315;
const BLOCK_LOG = 17;
const BLOCK_SIZE = 2 ** BLOCK_LOG;

const work = mkdtempSync(join(tmpdir(), 'xc998-appimage-'));
const cleanup = [];

try {
    // --- 1. Layout ----------------------------------------------------

    assert.ok(existsSync(WRAPPER), 'scripts/mksquashfs-deterministic.cjs exists');
    assert.ok(existsSync(TOOLSET), 'scripts/appimage-toolset.cjs exists');
    assert.ok(
        readFileSync(WRAPPER, 'utf8').startsWith('#!'),
        'the wrapper is a shebang script: electron-builder execs it as a binary, not via node',
    );

    // --- 2. The hook exists and is Linux-only -------------------------

    const config = requireCjs(join(desktop, 'electron-builder.config.cjs'));
    assert.equal(
        typeof config.beforePack,
        'function',
        'electron-builder config declares a beforePack hook (this is what installs the shim)',
    );

    for (const platform of ['darwin', 'win32']) {
        const before = process.env.APPIMAGE_TOOLS_PATH;
        await config.beforePack({ electronPlatformName: platform, arch: ARCH_X64 });
        assert.equal(
            process.env.APPIMAGE_TOOLS_PATH,
            before,
            `beforePack is inert for ${platform}: no Linux toolset is fetched on that lane`,
        );
    }

    assert.equal(
        typeof config.afterPack,
        'function',
        'electron-builder config declares an afterPack hook (it pins the packed app\'s modes)',
    );
    for (const platform of ['darwin', 'win32']) {
        // A path that does not exist: walking it would throw, so returning
        // cleanly is the proof the hook did not touch the mac/win app.
        await config.afterPack({
            electronPlatformName: platform,
            appOutDir: join(work, 'no-such-app-out-dir'),
        });
    }

    // --- 3. Materializing a shim over a fixture toolset ----------------

    // A fixture stands in for the downloaded toolset, so this never
    // touches the network. It carries every subdirectory app-builder-lib
    // might pick as the host tool root, so the test is host-agnostic.
    function makeFixtureToolset(name, fakeMode) {
        const root = join(work, name);
        for (const toolDir of ['darwin', 'linux-x64', 'linux-arm64']) {
            mkdirSync(join(root, toolDir), { recursive: true });
            writeFakeMksquashfs(join(root, toolDir, 'mksquashfs'), fakeMode);
            writeFileSync(join(root, toolDir, 'desktop-file-validate'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        }
        for (const runtime of ['runtime-x64', 'runtime-arm64', 'runtime-ia32', 'runtime-armv7l']) {
            writeFileSync(join(root, runtime), 'fake-runtime');
        }
        for (const lib of ['x64', 'ia32', 'arm64']) {
            mkdirSync(join(root, 'lib', lib), { recursive: true });
        }
        return root;
    }

    // Stands in for mksquashfs: writes a file whose superblock sits at
    // -offset, with mkfs_time taken from the clock, exactly like the real
    // tool. `mode` lets the test bend one field at a time.
    function writeFakeMksquashfs(path, mode) {
        const body = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const mode = ${JSON.stringify(mode)};
if (mode === 'fail') { process.stderr.write('fake mksquashfs failed\\n'); process.exit(3); }
const args = process.argv.slice(2);
const output = args[1];
const offset = Number(args[args.indexOf('-offset') + 1]) || 0;
const sb = Buffer.alloc(96);
sb.writeUInt32LE(mode === 'badmagic' ? 0x11223344 : 0x73717368, 0);
sb.writeUInt32LE(7, 4);
sb.writeUInt32LE(Math.floor(Date.now() / 1000), 8);
sb.writeUInt32LE(${BLOCK_SIZE}, 12);
sb.writeUInt32LE(0, 16);
sb.writeUInt16LE(1, 20);
sb.writeUInt16LE(mode === 'badblock' ? 9 : ${BLOCK_LOG}, 22);
sb.writeUInt16LE(0, 24);
sb.writeUInt16LE(1, 26);
sb.writeUInt16LE(mode === 'badversion' ? 3 : 4, 28);
sb.writeUInt16LE(0, 30);
// Deterministic filler standing in for the compressed payload, so any
// byte difference between two runs is the timestamp and nothing else.
const payload = Buffer.alloc(4096, 0x5a);
fs.writeFileSync(output, Buffer.concat([Buffer.alloc(offset, 0), sb, payload]));
`;
        writeFileSync(path, body, { mode: 0o755 });
        chmodSync(path, 0o755);
    }

    // Each materialization is a fresh module instance: the real one caches
    // its work for the process, which is right in a build and wrong here.
    function freshToolsetModule() {
        delete requireCjs.cache[requireCjs.resolve(TOOLSET)];
        return requireCjs(TOOLSET);
    }

    async function shimFor(fixture) {
        const saved = process.env.APPIMAGE_TOOLS_PATH;
        process.env.APPIMAGE_TOOLS_PATH = fixture;
        const { prepareDeterministicAppImageToolset } = freshToolsetModule();
        const shim = await prepareDeterministicAppImageToolset(ARCH_X64, () => {});
        cleanup.push(shim);
        if (saved === undefined) delete process.env.APPIMAGE_TOOLS_PATH;
        else process.env.APPIMAGE_TOOLS_PATH = saved;
        return shim;
    }

    const goodFixture = makeFixtureToolset('toolset-good', 'good');
    const shim = await shimFor(goodFixture);

    assert.notEqual(shim, goodFixture, 'the shim is a separate tree, not an edit of the toolset');
    for (const toolDir of ['darwin', 'linux-x64', 'linux-arm64']) {
        assert.ok(
            existsSync(join(shim, toolDir, 'mksquashfs.real')),
            `${toolDir}: the pinned binary is preserved as mksquashfs.real`,
        );
        assert.ok(
            readFileSync(join(shim, toolDir, 'mksquashfs'), 'utf8').includes('mkfs_time'),
            `${toolDir}: mksquashfs is now the wrapper`,
        );
    }
    assert.ok(
        existsSync(join(shim, 'runtime-x64')),
        'the rest of the toolset is carried across (the runtime the AppImage is built around)',
    );

    // A toolset the operator supplied is a SOURCE and gets shimmed. Our
    // OWN shim is not: pointed back at itself it resolves through the
    // recorded source, so it rebuilds the same directory instead of
    // stacking a wrapper on a wrapper. Nothing here may reach the network,
    // which an unwind that merely dropped the variable would.
    const reshimmed = await shimFor(shim);
    assert.equal(reshimmed, shim, 'a shim re-resolves to itself rather than stacking a second layer');
    assert.ok(
        !readFileSync(join(reshimmed, 'linux-x64', 'mksquashfs.real'), 'utf8').includes('mkfs_time'),
        'unwinding is real: the preserved binary is the pinned tool, not another wrapper',
    );
    assert.equal(
        readFileSync(join(shim, '.xchain-shim-source'), 'utf8').trim(),
        goodFixture,
        'the shim records the toolset it was built from, so the source survives a re-entry',
    );

    // --- 4/5/6. The installed wrapper ---------------------------------

    // A stage tree standing in for the packed app, with mtimes deliberately
    // set to "now" the way a fresh copy would carry them. Rebuilt per run so
    // each run starts from wall-clock timestamps again.
    const stage = join(work, 'stage');
    function makeStageTree() {
        rmSync(stage, { recursive: true, force: true });
        mkdirSync(join(stage, 'resources'), { recursive: true });
        writeFileSync(join(stage, 'AppRun'), '#!/bin/sh\nexec ./app\n', { mode: 0o755 });
        writeFileSync(join(stage, 'resources', 'app.asar'), 'asar');
        symlinkSync('resources/app.asar', join(stage, 'app.asar.link'));
        // What a umask-002 checkout hands the stage: the icon copied with
        // group write (the v0.341.3 defect), and a group-writable exec.
        mkdirSync(join(stage, 'usr', 'share', 'icons'), { recursive: true });
        writeFileSync(join(stage, 'usr', 'share', 'icons', 'xchain-wallet.png'), 'png');
        chmodSync(join(stage, 'usr', 'share', 'icons', 'xchain-wallet.png'), 0o664);
        writeFileSync(join(stage, 'helper'), '#!/bin/sh\n');
        chmodSync(join(stage, 'helper'), 0o775);
        chmodSync(join(stage, 'usr'), 0o775);
    }

    function runWrapper(shimRoot, { epoch, output, args }) {
        makeStageTree();
        const env = { ...process.env };
        delete env.SOURCE_DATE_EPOCH;
        if (epoch !== undefined) env.SOURCE_DATE_EPOCH = String(epoch);
        const toolDir = process.platform === 'linux'
            ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64')
            : 'darwin';
        return spawnSync(
            join(shimRoot, toolDir, 'mksquashfs'),
            args ?? [stage, output, '-offset', '188392', '-all-root', '-noappend'],
            { env, encoding: 'utf8' },
        );
    }

    const mkfsTimeOf = (file, offset = 188392) => readFileSync(file).readUInt32LE(offset + 8);
    const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

    // 4. Patched, and patched to the epoch.
    const outA = join(work, 'a.img');
    const okA = runWrapper(shim, { epoch: EPOCH, output: outA });
    assert.equal(okA.status, 0, `wrapper succeeds on a well-formed image (stderr: ${okA.stderr})`);
    assert.equal(mkfsTimeOf(outA), EPOCH, 'mkfs_time is pinned to SOURCE_DATE_EPOCH');

    // The SECOND clock. Pinning only the superblock left two real builds
    // still differing, in the metadata tables that carry per-file mtimes.
    for (const rel of ['AppRun', 'resources', join('resources', 'app.asar'), 'app.asar.link', '.']) {
        const entry = join(stage, rel);
        const stats = lstatSync(entry);
        assert.equal(
            Math.floor(stats.mtimeMs / 1000),
            EPOCH,
            `stage entry ${rel} is stamped with the epoch before mksquashfs reads it`,
        );
    }

    // The wrapper's copy of the mode rule, on the stage it was handed.
    const modeOf = (entry) => lstatSync(entry).mode & 0o7777;
    for (const [rel, wanted] of [
        [join('usr', 'share', 'icons', 'xchain-wallet.png'), 0o644],
        ['helper', 0o755],
        ['usr', 0o755],
        ['AppRun', 0o755],
        [join('resources', 'app.asar'), 0o644],
    ]) {
        assert.equal(
            modeOf(join(stage, rel)).toString(8),
            wanted.toString(8),
            `the wrapper pins stage entry ${rel} to ${wanted.toString(8)} whatever the host umask gave it`,
        );
    }

    // Two runs at different wall clocks: the whole point.
    const outB = join(work, 'b.img');
    const started = Date.now();
    while (Date.now() - started < 1100) { /* let the fake tool see a different second */ }
    runWrapper(shim, { epoch: EPOCH, output: outB });
    assert.equal(
        sha256(outA),
        sha256(outB),
        'two builds one second apart are byte-identical (this is the defect DD7 opened on)',
    );

    // 5. Dev builds: pass-through, and demonstrably NOT patched.
    const outDev = join(work, 'dev.img');
    const dev = runWrapper(shim, { epoch: undefined, output: outDev });
    assert.equal(dev.status, 0, 'no SOURCE_DATE_EPOCH is not an error: dev builds still package');
    assert.notEqual(
        mkfsTimeOf(outDev),
        EPOCH,
        'without a pinned clock the timestamp is left as the tool wrote it',
    );
    assert.notEqual(
        Math.floor(lstatSync(join(stage, 'AppRun')).mtimeMs / 1000),
        EPOCH,
        'and the source tree is left alone too: a dev build has nothing to pin it to',
    );

    // 6. Fail closed, every way.
    const failClosed = [
        ['fail', 'the real mksquashfs failing is propagated, not swallowed'],
        ['badmagic', 'no squashfs magic at the offset fails the build'],
        ['badversion', 'an unknown squashfs major fails the build rather than guessing a layout'],
        ['badblock', 'a superblock failing its own block_size/block_log self-check fails the build'],
    ];
    for (const [mode, description] of failClosed) {
        const brokenShim = await shimFor(makeFixtureToolset(`toolset-${mode}`, mode));
        const result = runWrapper(brokenShim, { epoch: EPOCH, output: join(work, `${mode}.img`) });
        assert.notEqual(result.status, 0, description);
    }

    // An argument shape the wrapper does not recognise means upstream
    // changed the call and the patch could land anywhere.
    const badArgs = runWrapper(shim, {
        epoch: EPOCH,
        output: join(work, 'unused.img'),
        args: ['-only', '-flags'],
    });
    assert.notEqual(badArgs.status, 0, 'an unrecognised argument shape fails the build');

    // --- 7. File modes, for both Linux packages -----------------------

    const { canonicalMode, normalizeTreeModes } = requireCjs(MODES);
    for (const [from, to] of [
        [0o664, 0o644], // the v0.341.3 icon
        [0o644, 0o644],
        [0o775, 0o755],
        [0o755, 0o755],
        [0o600, 0o644], // a umask-077 checkout
        [0o700, 0o755],
        [0o444, 0o444], // deliberately read-only stays read-only
        [0o4755, 0o4755], // chrome-sandbox: setuid is kept, the deb postinst relies on it
        [0o100664, 0o644], // a full st_mode, file-type bits included
    ]) {
        assert.equal(
            canonicalMode(from).toString(8),
            to.toString(8),
            `canonicalMode(${from.toString(8)}) is ${to.toString(8)}`,
        );
    }

    // The wrapper cannot require the helper (it is installed alone into the
    // shim), so it carries its own copy of the rule. Prove the two agree on
    // every permission value rather than trusting a reviewer to diff them.
    const wrapperSource = readFileSync(WRAPPER, 'utf8');
    const ruleMatch = /function canonicalMode\(mode\) \{[\s\S]*?\n\}/.exec(wrapperSource);
    assert.ok(ruleMatch, 'the mksquashfs wrapper carries canonicalMode');
    // eslint-disable-next-line no-new-func
    const wrapperRule = new Function(`${ruleMatch[0]}; return canonicalMode;`)();
    for (let mode = 0; mode <= 0o7777; mode += 1) {
        if (wrapperRule(mode) !== canonicalMode(mode)) {
            assert.fail(`wrapper and helper disagree on mode ${mode.toString(8)}`);
        }
    }

    // A tree built the way a umask-002 host builds one.
    function makeUmask002Tree(root) {
        const saved = process.umask(0o002);
        try {
            mkdirSync(join(root, 'icons'), { recursive: true });
            writeFileSync(join(root, 'icon.png'), 'png');
            writeFileSync(join(root, 'icons', '512x512.png'), 'png');
            writeFileSync(join(root, 'run.sh'), '#!/bin/sh\n', { mode: 0o777 });
            writeFileSync(join(root, 'chrome-sandbox'), 'elf');
            chmodSync(join(root, 'chrome-sandbox'), 0o4755);
            symlinkSync('does-not-exist', join(root, 'dangling'));
        } finally {
            process.umask(saved);
        }
        assert.equal(
            (lstatSync(join(root, 'icon.png')).mode & 0o777).toString(8),
            '664',
            'fixture sanity: the tree really carries the umask-002 mode',
        );
    }
    function assertCanonical(root, label) {
        for (const [rel, wanted] of [
            ['.', 0o755],
            ['icons', 0o755],
            ['icon.png', 0o644],
            [join('icons', '512x512.png'), 0o644],
            ['run.sh', 0o755],
            ['chrome-sandbox', 0o4755],
        ]) {
            assert.equal(
                (lstatSync(join(root, rel)).mode & 0o7777).toString(8),
                wanted.toString(8),
                `${label}: ${rel} is ${wanted.toString(8)}`,
            );
        }
        assert.ok(lstatSync(join(root, 'dangling')).isSymbolicLink(), `${label}: symlinks are left alone`);
    }

    const direct = join(work, 'modes-direct');
    makeUmask002Tree(direct);
    assert.ok(normalizeTreeModes(direct) > 0, 'normalizeTreeModes reports what it changed');
    assertCanonical(direct, 'normalizeTreeModes');
    assert.equal(normalizeTreeModes(direct), 0, 'a second pass changes nothing (idempotent)');

    // The config's linux afterPack over a stand-in packed app.
    const appOut = join(work, 'linux-unpacked');
    makeUmask002Tree(appOut);
    await config.afterPack({ electronPlatformName: 'linux', appOutDir: appOut });
    assertCanonical(appOut, 'afterPack (linux)');

    // The config's linux beforePack over stand-in build resources. It also
    // materializes the AppImage shim, so it is pointed at the fixture
    // toolset: nothing here may reach the network.
    const resources = join(work, 'build-resources');
    makeUmask002Tree(resources);
    const savedTools = process.env.APPIMAGE_TOOLS_PATH;
    process.env.APPIMAGE_TOOLS_PATH = goodFixture;
    try {
        await config.beforePack({
            electronPlatformName: 'linux',
            arch: ARCH_X64,
            packager: { buildResourcesDir: resources },
        });
    } finally {
        if (savedTools === undefined) delete process.env.APPIMAGE_TOOLS_PATH;
        else process.env.APPIMAGE_TOOLS_PATH = savedTools;
    }
    assertCanonical(resources, 'beforePack (linux) build resources');

    console.log(
        'OK: AppImage determinism smoke (DD7: electron-builder config declares a linux-only'
            + 'beforePack hook; the hook materializes a shimmed AppImage toolset and exports '
            + 'APPIMAGE_TOOLS_PATH; an operator-supplied toolset is shimmed rather than discarded and a '
            + 'shim is never double-shimmed; the installed mksquashfs wrapper pins BOTH clocks - the '
            + 'stage tree mtimes that become inode timestamps, and the squashfs superblock mkfs_time - '
            + 'to SOURCE_DATE_EPOCH, so two builds at different wall clocks are byte-identical; dev '
            + 'builds without the epoch pass through unpatched and unstamped; and the wrapper '
            + 'fails closed on a failing tool, missing magic, unknown squashfs major, a failed '
            + 'superblock self-check, and an unrecognised argument shape; file modes are pinned for '
            + 'the AppImage and the .deb alike - group/other take the owner\'s read+execute and never '
            + 'write, special bits kept - by the config\'s linux beforePack over the build resources, '
            + 'its linux afterPack over the packed app, and the wrapper over the AppImage stage, so a '
            + 'checkout made under umask 002 packages the same bytes as one made under 022)',
    );
} finally {
    rmSync(work, { recursive: true, force: true });
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
}
