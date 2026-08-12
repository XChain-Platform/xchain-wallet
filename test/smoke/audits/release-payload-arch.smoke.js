// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The release gate reads artifact NAMES; this is the check that opens the
// bytes. (§16,.)
//
// On 2026-08-06 snapcraft was measured packing x86-64 libraries into a snap
// whose own meta/snap.yaml declared `architectures: [arm64]` - exit 0, no
// warning anywhere in the build log. Every existing gate passed it:
// `xr_artifact_arch` attributes by filename substring, the arch-coverage row
// saw one artifact per arch, and the manifest would have signed and published
// a download that installs, verifies, and cannot start.
//
// So name, metadata and contents all have to agree, and this file holds the
// function that says so. What it asserts:
//
//   - an AppImage's own ELF header decides its architecture, because that
//     file IS the executable a user runs;
//   - a mislabelled one is REFUSED, in both directions;
//   - an artifact whose payload cannot be read is refused rather than
//     waved through, because a check that silently becomes a no-op on the
//     one host where it mattered is the failure this lane keeps finding;
//   - sign.sh actually calls it, after the artifact-set gate and before it
//     signs anything.
//
// The fixtures here are synthetic 64-byte ELF headers rather than real
// packages: the real ones were driven against this function on the build
// host (a genuine arm64 snap, a genuine amd64 snap, both real AppImages, a
// real deb: 0 problems; the wrong-arch snap: refused, naming 180 foreign
// paths). This file exists so that result cannot quietly stop being true.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const lib = join(repo, 'tools', 'release', 'lib.sh');

// e_machine values, from the ELF spec: the two bytes at 0x12.
const E_MACHINE = { x64: 0x3e, arm64: 0xb7, armv7l: 0x28, ia32: 0x03 };

/** A 64-byte ELF header, valid enough for a header read to answer. */
function elf(machine) {
    const b = Buffer.alloc(64);
    b.write('\x7fELF', 0, 'binary');
    b[4] = 2;                  // 64-bit
    b[5] = 1;                  // little-endian
    b[6] = 1;                  // version
    b[16] = 2;                 // e_type: executable
    b.writeUInt16LE(E_MACHINE[machine], 18);
    return b;
}

const work = mkdtempSync(join(tmpdir(), 'xc1240-'));
let failures = 0;

function check(label, cond, detail) {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
}

/**
 * Ask lib.sh's payload check about one file. Returns { problems, out }.
 * `binDir`, when given, is prepended to PATH so a case can decide whether
 * unsquashfs/dpkg-deb are present and what they do.
 */
function payload(dir, name, arch, binDir) {
    // `2>&1`: the count comes back on stdout and every problem on stderr,
    // and a check that reads only one of the two would be judging the
    // messages it never saw. The count is the last all-digits line.
    const script = `source ${JSON.stringify(lib)}; `
        + `xr_check_payload_arch ${JSON.stringify(dir)} ${JSON.stringify(name)} ${JSON.stringify(arch)} 2>&1`;
    const out = execFileSync('bash', ['-c', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: binDir ? { ...process.env, PATH: `${binDir}:${process.env.PATH}` } : process.env,
    });
    const digits = out.trim().split('\n').filter((l) => /^\s*\d+\s*$/.test(l));
    return { problems: Number(digits[digits.length - 1]), out };
}

/** A directory holding stub extractors that exist and fail. */
function failingExtractors() {
    const bin = mkdtempSync(join(work, 'bin-'));
    for (const tool of ['unsquashfs', 'dpkg-deb']) {
        const p = join(bin, tool);
        writeFileSync(p, '#!/bin/sh\nexit 1\n');
        chmodSync(p, 0o755);
    }
    return bin;
}

try {
    // --- 1. An honest AppImage passes, on both arches ------------------
    {
        for (const arch of ['x64', 'arm64']) {
            const dir = mkdtempSync(join(work, 'ok-'));
            const name = `xchain-wallet-0.0.0-${arch === 'x64' ? 'x86_64' : 'arm64'}.AppImage`;
            writeFileSync(join(dir, name), elf(arch));
            const r = payload(dir, name, arch);
            check(`a genuine ${arch} AppImage passes`, r.problems === 0, r.out);
        }
    }

    // --- 2. A mislabelled one is refused, in both directions -----------
    //
    // Both directions on purpose: the demonstrated defect was an
    // arm64-labelled x86-64 artifact, and the mirror image is exactly as
    // shippable and exactly as broken.
    {
        const cases = [
            ['arm64', 'x64', 'xchain-wallet-0.0.0-arm64.AppImage'],
            ['x64', 'arm64', 'xchain-wallet-0.0.0-x86_64.AppImage'],
        ];
        for (const [claimed, actual, name] of cases) {
            const dir = mkdtempSync(join(work, 'bad-'));
            writeFileSync(join(dir, name), elf(actual));
            const r = payload(dir, name, claimed);
            check(`an AppImage named ${claimed} holding ${actual} code is refused`,
                r.problems === 1 && /PAYLOAD-ARCH/.test(r.out), r.out);
            check(`and the message names the arch the header actually says (${actual})`,
                new RegExp(`header says\\s+${actual}`).test(r.out.replace(/\n\s+/g, ' ')), r.out);
        }
    }

    // --- 3. An AppImage that is not an ELF at all is refused -----------
    //
    // A self-executing image that does not start with ELF magic is not the
    // thing the format promises, whatever its name says.
    {
        const dir = mkdtempSync(join(work, 'notelf-'));
        const name = 'xchain-wallet-0.0.0-arm64.AppImage';
        writeFileSync(join(dir, name), 'not an executable\n');
        const r = payload(dir, name, 'arm64');
        check('an AppImage with no ELF magic is refused', r.problems === 1, r.out);
    }

    // --- 4. No extractor: say so by name, do not fail the release ------
    //
    // sign.sh runs on the RELEASE MACHINE and never in CI (§8), and that
    // machine is a Mac with no squashfs-tools. Failing here would block the
    // signing path itself to enforce a check one brew command away, so the
    // rule is: name the artifact that went unchecked, name the tool, and let
    // the release proceed. What must NOT happen is silence, which is what
    // this case pins.
    //
    // The tools are removed from PATH rather than assumed absent, so this
    // reads the same on a developer's Mac and on the Linux venue.
    {
        const bare = mkdtempSync(join(work, 'nobin-'));
        for (const tool of ['od', 'grep']) {
            const found = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
            symlinkSync(found, join(bare, tool));
        }
        for (const name of ['xchain-wallet_0.0.0_arm64.snap', 'xchain-wallet_0.0.0_arm64.deb']) {
            const dir = mkdtempSync(join(work, 'unreadable-'));
            writeFileSync(join(dir, name), 'this is not a package\n');
            const script = `PATH=${JSON.stringify(bare)}; source ${JSON.stringify(lib)}; `
                + `xr_check_payload_arch ${JSON.stringify(dir)} ${JSON.stringify(name)} "arm64" 2>&1`;
            const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const digits = out.trim().split('\n').filter((l) => /^\s*\d+\s*$/.test(l));
            check(`a ${name.split('.').pop()} with no extractor is reported UNCHECKED, by name`,
                /PAYLOAD-ARCH-UNCHECKED/.test(out) && out.includes(name), out);
            check('and it does not fail the release on its own',
                Number(digits[digits.length - 1]) === 0, out);
        }
    }

    // --- 4b. The foreign-library-directory scan, which is the one that
    // actually caught ------------------------------------------
    //
    // Driven on a synthetic listing rather than a real package, so it runs
    // on a host with no unsquashfs and no dpkg-deb. The real thing was
    // measured against snapcraft's own output on the build host: 180 paths.
    {
        // The listing is passed as a real ARGUMENT rather than interpolated
        // into the script text: bash does not expand escapes inside double
        // quotes, so a JSON-stringified multi-line listing arrives as one
        // line full of literal backslash-n and every per-line count comes
        // back as 1. That is a harness bug that reads exactly like a working
        // check, which is the class of thing this file exists to refuse.
        const scan = (listing, arch) => {
            const script = `source ${JSON.stringify(lib)}; `
                + 'xr_check_foreign_triplets "$1" "$2" "$3" 2>&1';
            const out = execFileSync('bash', ['-c', script, 'bash', listing, arch, 'artifact.snap'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            const digits = out.trim().split('\n').filter((l) => /^\s*\d+\s*$/.test(l));
            return { problems: Number(digits[digits.length - 1]), out };
        };

        const honest = 'squashfs-root/app/xchain-wallet\nsquashfs-root/usr/lib/aarch64-linux-gnu/libnspr4.so\n';
        const lying = 'squashfs-root/app/xchain-wallet\nsquashfs-root/usr/lib/x86_64-linux-gnu/libnspr4.so\n'
            + 'squashfs-root/usr/lib/x86_64-linux-gnu/libnss3.so\n';

        let r = scan(honest, 'arm64');
        check('an arm64 payload holding only aarch64 libraries passes', r.problems === 0, r.out);

        r = scan(lying, 'arm64');
        check('an arm64 payload holding x86_64 libraries is refused', r.problems === 1, r.out);
        check('and the message counts them rather than just naming the fault',
            /carries 2 path\(s\) under/.test(r.out.replace(/\n\s+/g, ' ')), r.out);

        // The mirror: this must not be an arm64-only rule.
        r = scan('squashfs-root/usr/lib/aarch64-linux-gnu/libnss3.so\n', 'x64');
        check('an x64 payload holding aarch64 libraries is refused', r.problems === 1, r.out);
    }

    // --- 4c. The extractor EXISTS and cannot read the file -------------
    //
    // Case 4 covers a host with no extractor. This one covers the other
    // half, with stubs that exist and exit 1, so the branch is driven on
    // every host rather than only on the ones that happen to have
    // squashfs-tools installed. Both halves have to refuse: "I could not
    // look inside" is not "I looked inside and it was fine".
    {
        const bin = failingExtractors();
        for (const name of ['xchain-wallet_0.0.0_arm64.snap', 'xchain-wallet_0.0.0_arm64.deb']) {
            const dir = mkdtempSync(join(work, 'unreadable2-'));
            writeFileSync(join(dir, name), 'this is not a package\n');
            const r = payload(dir, name, 'arm64', bin);
            check(`a ${name.split('.').pop()} the extractor cannot read is refused`,
                r.problems >= 1 && /could not be read/.test(r.out), r.out);
        }
    }

    // --- 5. The whole-directory gate fails the release, with a real exit
    {
        const dir = mkdtempSync(join(work, 'dir-'));
        writeFileSync(join(dir, 'xchain-wallet-0.0.0-arm64.AppImage'), elf('x64'));
        const script = `source ${JSON.stringify(lib)}; xr_check_payload_arches ${JSON.stringify(dir)}`;
        let code = 0;
        let out = '';
        try {
            out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            code = err.status;
            out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        }
        check('the directory gate exits non-zero on a lying artifact', code === 1, out);
        check('and says the release is what it refused',
            /payload-architecture gate FAILED/.test(out), out);
    }

    // --- 6. sign.sh calls it, in the right order -----------------------
    //
    // A gate nothing invokes is the family this spec has caught repeatedly.
    // Order matters too: the set gate answers "is this release complete",
    // and there is no point opening bytes of a set that is already wrong.
    {
        const sign = readFileSync(join(repo, 'tools', 'release', 'sign.sh'), 'utf8');
        const setGate = sign.indexOf('xr_check_expected "$INPUT_DIR"');
        // Anchored to line start with no `#`, because a substring search
        // accepts a COMMENTED-OUT call and reads as a wired gate. Found by
        // falsifying this very assertion: commenting the line out left it
        // green.
        const live = /^[ \t]*xr_check_payload_arches "\$INPUT_DIR"/m.exec(sign);
        const payloadGate = live ? live.index : -1;
        check('sign.sh runs the payload-architecture gate, uncommented', payloadGate > -1,
            sign.slice(Math.max(0, sign.indexOf('xr_check_payload_arches') - 80), sign.indexOf('xr_check_payload_arches') + 80));
        check('and runs it after the artifact-set gate', setGate > -1 && payloadGate > setGate);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\nrelease-payload-arch smoke: ${failures} failure(s)`);
    process.exit(1);
}

console.log(
    'OK: release payload-architecture smoke (: an AppImage is judged by its own'
    + ' ELF header rather than its filename, a mislabelled one is refused in both'
    + ' directions, a snap or deb whose contents cannot be read is refused rather than'
    + ' skipped, the directory gate exits 1 and says so, and sign.sh runs it after the'
    + ' artifact-set gate and before it signs anything)',
);
