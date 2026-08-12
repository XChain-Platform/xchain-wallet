#!/usr/bin/env node
//*********************************************************************
//
// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
//*********************************************************************

// A drop-in `mksquashfs` that makes the AppImage reproducible.
//
// WHY THIS EXISTS (DD7). Two packaged builds of one commit with one
// SOURCE_DATE_EPOCH produced byte-DIFFERENT AppImages while the .deb files
// from the same runs were byte-identical. The cause is the squashfs
// superblock's `mkfs_time`, which mksquashfs writes from the wall clock.
//
// There is no flag for it. electron-builder pins squashfs-tools
// **4.3-git (2017/07/18)**, and `-mkfs-time` / `-all-time` did not land
// until 4.4 (2019); the pinned binary's own `-help` lists neither, and it
// ignores SOURCE_DATE_EPOCH. So the fix is to write the field ourselves.
//
// THERE ARE TWO CLOCKS HERE, AND FIXING ONLY THE FIRST IS NOT ENOUGH.
// That was measured the hard way: with `mkfs_time` pinned in both runs,
// two full builds still produced different AppImages. Diffing them showed
// the 131 MB of file data was byte-identical and the differences were 55
// bytes of superblock table offsets, ~14 KB of metadata tables near the
// end, and the trailing block map (which is derived, so it differs
// whenever the image does). That signature is per-file INODE mtimes: the
// stage tree is assembled by copying the packed app, so its files carry
// whatever wall-clock times the copy gave them.
//
// squashfs-tools 4.4 added `-all-time` for exactly this. The pinned 4.3
// has neither it nor `-mkfs-time`, so both clocks are normalised here:
// every entry under the source tree is stamped with SOURCE_DATE_EPOCH
// before the real tool scans it, and the superblock field is written
// after. The synthetic probe that preceded this - the pinned mksquashfs
// run twice over a FIXED-mtime tree, three seconds apart - differed in
// `mkfs_time` alone, which is what says these two are the whole set.
//
// WHY IT PATCHES HERE, RATHER THAN THE FINISHED .AppImage. app-builder-lib
// runs mksquashfs, then writes the AppImage runtime over the front of the
// file, then appends a block map whose chunk hashes cover the whole image,
// and finally records that image's sha512 in the channel pointer yml.
// Patching after any of that desyncs the block map and the pointer. This
// wrapper IS the mksquashfs step, so everything downstream is computed over
// the corrected bytes and stays consistent by construction.
//
// FAILS CLOSED. Every unexpected condition exits non-zero and fails the
// build. The alternative - skipping the patch and carrying on - reproduces
// the original defect silently, which is how it survived unnoticed in the
// first place.

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SQUASHFS_MAGIC = 0x73717368; // 'hsqs', little-endian
const SUPERBLOCK_BYTES = 32;
const MKFS_TIME_OFFSET = 8; // squashfs 4.0 superblock: u32 at byte 8
const MAX_U32 = 0xffffffff;

const TAG = '[mksquashfs-deterministic]';

function fail(message) {
    process.stderr.write(`${TAG} FATAL: ${message}\n`);
    process.exit(1);
}

// The real binary is installed beside this wrapper by
// scripts/appimage-toolset.cjs, which builds the shimmed toolset tree.
const realBinary = path.join(__dirname, 'mksquashfs.real');
const args = process.argv.slice(2);

if (!fs.existsSync(realBinary)) {
    fail(`no mksquashfs.real beside the wrapper at ${realBinary}`);
}

// app-builder-lib always calls `mksquashfs <sourceDir> <output> -offset N ...`.
// Read both positionally rather than guessing, and refuse anything else: an
// argument shape we do not recognise means the upstream call changed, and
// then neither the tree we stamp nor the offset we patch can be trusted.
const source = args[0];
const output = args[1];
if (!source || source.startsWith('-') || !output || output.startsWith('-')) {
    fail(`unexpected argument shape; expected <source> <output> first: ${JSON.stringify(args)}`);
}

// THE DEB LANE'S LEFTOVERS, REMOVED BEFORE THE IMAGE IS SEALED (
// §5, added 2026-08-02).
//
// electron-builder builds the AppImage and the .deb CONCURRENTLY out of one
// directory. Both Linux targets report `isAsyncSupported`, `AsyncTaskManager`
// has no concurrency control, and `FpmTarget.build()` writes two files into
// `dist/linux*-unpacked/resources` - `package-type` and `apparmor-profile` -
// while `AppImageTarget.build()` is copying that same directory into its
// stage tree.
//
// `package-type` is not inert. It is the file electron-updater reads to
// decide WHICH updater a Linux build gets: `deb` selects `DebUpdater`,
// whose install step is `dpkg -i` under `pkexec`, a root-privileged package
// install. An AppImage that captured it would offer its users the `.deb`
// from the same channel pointer, pass the sha512, pass the K1-signed
// manifest that legitimately covers it, ask for the administrator password,
// install a system package nobody chose - and leave the AppImage they are
// actually running untouched. Every layer of the trust chain reports
// success, because every layer is doing its job on the wrong artifact.
//
// Measured on four artifacts from two independent container builds
// (2026-08-02): the AppImage copy wins that race every time, so no shipped
// AppImage carries either file. But nothing ORDERS those two targets. The
// property was observed, not guaranteed, and it is decided by which
// filesystem call lands first on a build machine we do not control.
//
// This wrapper is the last thing that runs before the image is sealed - the
// same argument that put the mkfs_time patch here - so it is where the
// guarantee can be made instead of hoped for. Removing them also removes a
// second source of AppImage non-determinism, since a race that can go
// either way is a build that can produce either image.
const DEB_LANE_LEFTOVERS = ['package-type', 'apparmor-profile'];
for (const name of DEB_LANE_LEFTOVERS) {
    const stray = path.join(source, 'resources', name);
    let present;
    try {
        present = fs.existsSync(stray);
    } catch (error) {
        fail(`cannot check ${stray}: ${error.message}`);
    }
    if (!present) continue;
    try {
        fs.rmSync(stray, { force: true });
    } catch (error) {
        fail(`cannot remove the deb lane's ${name} from the AppImage stage: ${error.message}`);
    }
    process.stderr.write(`${TAG} removed ${name} left in the stage tree by the deb lane\n`);
}

const rawEpoch = process.env.SOURCE_DATE_EPOCH;
const epoch = rawEpoch === undefined ? undefined : Number(rawEpoch);
if (rawEpoch !== undefined && (!Number.isInteger(epoch) || epoch < 0 || epoch > MAX_U32)) {
    fail(`SOURCE_DATE_EPOCH=${rawEpoch} is not a u32 seconds value`);
}

// Clock one: the per-file mtimes the real tool is about to read into the
// inode table. Stamped depth-first so a directory is set after the entries
// inside it, and via lutimes for symlinks so the link's own timestamp is
// pinned rather than its target's.
function stampTree(entryPath) {
    let stats;
    try {
        stats = fs.lstatSync(entryPath);
    } catch (error) {
        fail(`cannot stat ${entryPath}: ${error.message}`);
    }
    if (stats.isDirectory()) {
        for (const child of fs.readdirSync(entryPath)) {
            stampTree(path.join(entryPath, child));
        }
    }
    try {
        if (stats.isSymbolicLink()) {
            fs.lutimesSync(entryPath, epoch, epoch);
        } else {
            fs.utimesSync(entryPath, epoch, epoch);
        }
    } catch (error) {
        fail(`cannot set mtime on ${entryPath}: ${error.message}`);
    }
}

if (epoch !== undefined) {
    stampTree(source);
}

const result = spawnSync(realBinary, args, { stdio: 'inherit' });
if (result.error) {
    fail(`could not run ${realBinary}: ${result.error.message}`);
}
if (result.status !== 0) {
    // Pass the real tool's failure through unchanged; it has already
    // printed its own diagnostics to the inherited stderr.
    process.exit(result.status === null ? 1 : result.status);
}

// Clock two: the superblock's own `mkfs_time`. A dev build with no pinned
// clock has nothing to make deterministic, and stamping "now" over "now"
// would be a no-op with extra failure modes. The wrapper still ran, so the
// shim itself is exercised in dev rather than only on release day.
if (epoch === undefined) {
    process.exit(0);
}

const offsetFlag = args.indexOf('-offset');
const offset = offsetFlag === -1 ? 0 : Number(args[offsetFlag + 1]);
if (!Number.isInteger(offset) || offset < 0) {
    fail(`unreadable -offset value: ${JSON.stringify(args[offsetFlag + 1])}`);
}

const fd = fs.openSync(output, 'r+');
try {
    const superblock = Buffer.alloc(SUPERBLOCK_BYTES);
    const read = fs.readSync(fd, superblock, 0, SUPERBLOCK_BYTES, offset);
    if (read !== SUPERBLOCK_BYTES) {
        fail(`short read of the superblock at offset ${offset} in ${output}`);
    }

    // Validate structurally, not on the magic alone. The AppImage runtime
    // that gets written over the front of this file contains a coincidental
    // `hsqs` byte match, so "found the magic" is not evidence of anything by
    // itself - the previous session hit exactly that false positive.
    if (superblock.readUInt32LE(0) !== SQUASHFS_MAGIC) {
        fail(`no squashfs magic at offset ${offset} in ${output}`);
    }
    const major = superblock.readUInt16LE(28);
    const minor = superblock.readUInt16LE(30);
    if (major !== 4) {
        fail(`squashfs v${major}.${minor} at offset ${offset}; this wrapper knows only v4.x`);
    }
    const blockSize = superblock.readUInt32LE(12);
    const blockLog = superblock.readUInt16LE(22);
    if (blockSize !== 2 ** blockLog) {
        fail(`superblock self-check failed: block_size ${blockSize} != 1 << ${blockLog}`);
    }

    const before = superblock.readUInt32LE(MKFS_TIME_OFFSET);
    const stamp = Buffer.alloc(4);
    stamp.writeUInt32LE(epoch);
    const written = fs.writeSync(fd, stamp, 0, 4, offset + MKFS_TIME_OFFSET);
    if (written !== 4) {
        fail(`short write of mkfs_time at offset ${offset + MKFS_TIME_OFFSET}`);
    }

    process.stderr.write(
        `${TAG} ${path.basename(output)}: mkfs_time ${before} -> ${epoch} `
            + `(superblock v${major}.${minor} at ${offset}, block_size ${blockSize})\n`,
    );
} finally {
    fs.closeSync(fd);
}
