// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Refuse a packed Linux app that carries a native addon built for another
// architecture.
//
// WHY THIS EXISTS. electron-builder runs with `npmRebuild: false`, so a
// `.node` file reaches the packed app exactly as `pnpm install` compiled it,
// for the HOST arch, and the same node_modules feeds every target arch.
// v0.343.1 shipped that shape: its arm64 .deb and AppImage carried
// tiny-secp256k1's x86-64 `secp256k1.node`, byte-identical (sha256
// 82e06bac...) to the one in the amd64 package. Nothing failed. An arm64
// process cannot dlopen an x86-64 object, tiny-secp256k1's
// `try { native } catch { js }` swallowed the error, and the app ran the
// slower JS implementation without a word.
//
// The packaged wallet now carries no native addon at all (tiny-secp256k1
// left with bitcoinjs-lib 7, and secp256k1@3.8.1's build script is denied in
// pnpm-workspace.yaml), so the expected result on every Linux arch is "no
// .node file". That outcome is only safe while it is checked: a dependency
// that brings a compiled addon back gets it built for the host and packed
// into every arch again. So each packed tree is held to one rule: every
// `.node` in it, on disk or packed inside its app.asar, is an ELF object
// whose machine is the tree's own arch. A
// right-arch addon passes, no addon passes, and anything else stops the
// build before fpm or mksquashfs wraps it.
//
// A `.node` that is not ELF at all (a Mach-O from a Linux target packed on
// a Mac, say) is refused too: a Linux process cannot load it either.
//
// The header read is the same two bytes tools/release/lib.sh's
// `xr_elf_machine` reads (e_machine at 0x12), so no `file` dependency and no
// host-dependent wording.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// builder-util's `Arch` enum, by value. Hooks receive the number; the CLI
// below takes the name. test/smoke/audits/linux-native-arch.smoke.js holds
// this table to the installed builder-util.
const ARCH_BY_ENUM = Object.freeze({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' });

// ELF e_machine values for the arches above.
const MACHINE_ARCH = Object.freeze({
    0x03: 'ia32',
    0x28: 'armv7l',
    0x3e: 'x64',
    0xb7: 'arm64',
});

const ADDON_SUFFIX = '.node';

/**
 * The arch name for a builder-util Arch enum value or an arch name; throws
 * on anything else, so a hook called without an arch cannot pass by default.
 *
 * @param {number | string | undefined} arch
 * @returns {string}
 */
function archName(arch) {
    if (typeof arch === 'number' && Object.hasOwn(ARCH_BY_ENUM, arch)) {
        return ARCH_BY_ENUM[arch];
    }
    if (typeof arch === 'string' && Object.values(ARCH_BY_ENUM).includes(arch)) {
        return arch;
    }
    const err = new Error(
        `linux-native-arch: '${String(arch)}' is not a Linux target arch `
        + `(${Object.values(ARCH_BY_ENUM).join(', ')}); the native-addon check cannot `
        + 'run without one, and skipping it is the defect it exists to stop.',
    );
    err.name = 'LinuxNativeArchUnknown';
    throw err;
}

/**
 * Read an ELF header's machine as an arch name.
 *
 * @param {Buffer} header at least the first 20 bytes of the file
 * @returns {{ elf: boolean, arch: string | null, machine: number | null }}
 *   elf false when the magic is absent or the header is short; arch null
 *   when the machine is one this table does not name.
 */
function elfArch(header) {
    if (header.length < 20
        || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
        return { elf: false, arch: null, machine: null };
    }
    // EI_DATA: 1 little-endian, 2 big-endian. e_machine follows the file's
    // own byte order, not the host's.
    const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
    return { elf: true, arch: MACHINE_ARCH[machine] ?? null, machine };
}

function readAt(file, position, length) {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(length);
        const read = fs.readSync(fd, buf, 0, length, position);
        return buf.subarray(0, read);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * The `.node` entries packed INSIDE an asar archive, with the byte offset of
 * each one's data. electron-builder unpacks the addons of node_modules
 * packages it recognises as native, but a `.node` it does not recognise
 * stays in the archive, and Electron still loads it from there (process.dlopen
 * extracts it to a temporary file). So the archive is read too. Entries
 * marked `unpacked` live in `<archive>.unpacked/` and the tree walk sees them.
 *
 * Layout (@electron/asar): UInt32LE 4, UInt32LE header size, then the header
 * pickle (UInt32LE payload size, UInt32LE JSON length, JSON); file data
 * starts at 8 + header size, each entry's `offset` relative to that.
 *
 * @param {string} archive
 * @returns {{ entry: string, position: number }[]}
 */
function asarNativeAddons(archive) {
    const fail = (why) => {
        const err = new Error(`${archive}: ${why}; its native addons cannot be checked`);
        err.name = 'LinuxNativeArchUnreadable';
        return err;
    };
    const sizePickle = readAt(archive, 0, 8);
    if (sizePickle.length < 8 || sizePickle.readUInt32LE(0) !== 4) {
        throw fail('not an asar archive');
    }
    const headerSize = sizePickle.readUInt32LE(4);
    const headerPickle = readAt(archive, 8, headerSize);
    if (headerPickle.length !== headerSize || headerSize < 8) throw fail('truncated asar header');
    const jsonLength = headerPickle.readUInt32LE(4);
    let header;
    try {
        header = JSON.parse(headerPickle.toString('utf8', 8, 8 + jsonLength));
    } catch {
        throw fail('asar header is not JSON');
    }
    const base = 8 + headerSize;
    const found = [];
    const walk = (node, prefix) => {
        for (const [name, entry] of Object.entries(node.files || {})) {
            const rel = prefix ? `${prefix}/${name}` : name;
            if (entry.files) {
                walk(entry, rel);
            } else if (name.endsWith(ADDON_SUFFIX) && !entry.unpacked && !entry.link) {
                found.push({ entry: rel, position: base + Number(entry.offset) });
            }
        }
    };
    walk(header, '');
    return found;
}

/**
 * Every native addon in a packed tree: each `.node` file on disk, and each
 * `.node` packed inside an `.asar` archive in it, with the first bytes of
 * its contents. Symlinks are not followed: a link out of the tree is not
 * part of what gets packed.
 *
 * @param {string} root
 * @returns {{ file: string, header: Buffer }[]} sorted by file
 */
function findNativeAddons(root) {
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(ADDON_SUFFIX)) {
                found.push({ file: path.relative(root, full), header: readAt(full, 0, 20) });
            } else if (entry.isFile() && entry.name.endsWith('.asar')) {
                for (const { entry: inner, position } of asarNativeAddons(full)) {
                    found.push({
                        file: `${path.relative(root, full)}/${inner}`,
                        header: readAt(full, position, 20),
                    });
                }
            }
        }
    };
    walk(root);
    return found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * Check one packed Linux tree. Returns what it found; throws
 * `LinuxNativeArchMismatch` naming every offending file.
 *
 * @param {string} root the packed app (electron-builder's appOutDir)
 * @param {number | string} arch builder-util Arch value or arch name
 * @returns {{ arch: string, addons: { file: string, arch: string }[] }}
 */
function assertLinuxNativeAddonsMatchArch(root, arch) {
    const want = archName(arch);
    const addons = [];
    const problems = [];
    for (const { file: rel, header } of findNativeAddons(root)) {
        const got = elfArch(header);
        if (!got.elf) {
            problems.push(`${rel}: not an ELF object, so no Linux process can load it`);
        } else if (got.arch !== want) {
            const what = got.arch ?? `unknown e_machine 0x${got.machine.toString(16)}`;
            problems.push(`${rel}: ELF machine is ${what}, the tree is ${want}`);
        } else {
            addons.push({ file: rel, arch: got.arch });
        }
    }
    if (problems.length > 0) {
        const err = new Error(
            `${root} is the linux ${want} app and carries ${problems.length} native addon(s) `
            + `it cannot load:\n  ${problems.join('\n  ')}\n`
            + 'A native addon is compiled once, for the install host, and npmRebuild is off, '
            + 'so every target arch receives the host build. Ship each arch an addon built '
            + 'for it, or keep the addon out of the packed app so its JS fallback runs by '
            + 'decision; never pack the host build into another arch.',
        );
        err.name = 'LinuxNativeArchMismatch';
        throw err;
    }
    return { arch: want, addons };
}

module.exports = {
    ARCH_BY_ENUM,
    archName,
    assertLinuxNativeAddonsMatchArch,
    elfArch,
    findNativeAddons,
};

// CLI: node linux-native-arch.cjs <packed-tree> <arch> [<packed-tree> <arch> ...]
// Prints one line per tree and exits 1 on the first mismatch, so an unpacked
// tree or an extracted package can be checked outside a build.
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.length % 2 !== 0) {
        process.stderr.write('usage: linux-native-arch.cjs <packed-tree> <arch> [...]\n');
        process.exit(2);
    }
    for (let i = 0; i < args.length; i += 2) {
        try {
            const { arch, addons } = assertLinuxNativeAddonsMatchArch(args[i], args[i + 1]);
            const list = addons.length === 0
                ? 'no native addon'
                : addons.map((a) => `${a.file} (${a.arch})`).join(', ');
            process.stdout.write(`ok  ${args[i]} [${arch}]: ${list}\n`);
        } catch (err) {
            process.stderr.write(`${err.name}: ${err.message}\n`);
            process.exit(1);
        }
    }
}
