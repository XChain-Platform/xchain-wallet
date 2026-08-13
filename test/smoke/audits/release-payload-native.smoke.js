// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The §7.5 staging rehearsal did not rehearse a release's bytes. (
//
// Measured on real artifacts: the rehearsal `.deb` built on the release Mac
// parses to 93 payload entries with zero `.node` files, while's CI
// artifact carries 188 and includes
// `resources/app.asar.unpacked/node_modules/tiny-secp256k1/build/Release/secp256k1.node`.
// tiny-secp256k1@1.1.7's index.js is `try { require('./native') } catch
// { require('./js') }`, so the payload with no addon silently ran that
// package's JS fallback and every gate stayed green. A rehearsal of a bundle
// no release publishes is the one thing a rehearsal must not be.
//
// What this file asserts about `xr_check_payload_native`:
//
//   - a `.deb` carrying a compiled addon under resources/app.asar.unpacked/
//     passes;
//   - one carrying none is REFUSED, by name, with the reason;
//   - the reader is `tar`, not `dpkg-deb`, because signing happens on a Mac
//     that has no dpkg and a check enforceable only elsewhere is not a check;
//   - a `.deb` whose bytes are not a Debian package at all is refused rather
//     than waved through;
//   - an `.AppImage` on a host with no unsquashfs is reported UNCHECKED, out
//     loud and by name, and does NOT fail the release;
// - every non-Linux format is silently out of scope, because
//     measured the Linux lane and nothing else;
//   - the directory gate exits non-zero and says which gate refused;
//   - `xr_check_payload_arches` actually calls it, uncommented.
//
// The fixtures are hand-built ar archives rather than `dpkg-deb -b` output,
// for the same reason the sibling release-tools smoke builds its own: neither
// dpkg-deb nor GNU ar is on a developer Mac, and the fixture has to be
// identical on both hosts.

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const lib = join(repo, 'tools', 'release', 'lib.sh');

const work = mkdtempSync(join(tmpdir(), 'xc1343-'));
let failures = 0;

function check(label, cond, detail) {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
}

/** A gzipped ustar archive of [path, body] pairs, deterministic (mtime 0). */
function tarGz(entries) {
    const blocks = [];
    for (const [path, body] of entries) {
        // Paths stay under 100 bytes: the ustar name field is 100 and a
        // longer one needs a PAX header, which would make the fixture a test
        // of the harness rather than of the gate.
        if (path.length >= 100) throw new Error(`fixture path too long for ustar: ${path}`);
        const h = Buffer.alloc(512);
        h.write(path, 0, 100, 'utf8');
        h.write('0000644\0', 100, 8, 'utf8');       // mode
        h.write('0000000\0', 108, 8, 'utf8');       // uid
        h.write('0000000\0', 116, 8, 'utf8');       // gid
        h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
        h.write('00000000000\0', 136, 12, 'utf8');  // mtime 0, deterministic
        h.write('        ', 148, 8, 'utf8');         // checksum field, spaces while summing
        h.write('0', 156, 1, 'utf8');                // typeflag: regular file
        h.write(`ustar\0${'00'}`, 257, 8, 'utf8');
        let sum = 0;
        for (const b of h) sum += b;
        h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
        blocks.push(h);
        const data = Buffer.from(body);
        blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));                 // two zero blocks: end of archive
    return gzipSync(Buffer.concat(blocks), { mtime: 0 });
}

/**
 * A real `.deb`: an ar archive of debian-binary + control.tar.gz +
 * data.tar.gz. `withAddon` decides the one thing under test, so the two
 * fixtures differ by exactly the entry the release lane's artifact carries
 * and the rehearsal's did not.
 */
function deb({ withAddon }) {
    const control = tarGz([['./control',
        'Package: xchain-wallet\nVersion: 9.9.9\n'
        + 'Architecture: amd64\nMaintainer: XChain <releases@dankest.llc>\n'
        + 'Description: fixture\n']]);
    const payload = [['./opt/xw/resources/app.asar', '{"files":{}}\n']];
    if (withAddon) {
        payload.push([
            './opt/xw/resources/app.asar.unpacked/node_modules/tiny-secp256k1/build/Release/secp256k1.node',
            'ELF-ish fixture addon\n',
        ]);
    }
    const data = tarGz(payload);
    const member = (memberName, body) => {
        const h = Buffer.alloc(60, 0x20);
        h.write(memberName, 0, 16, 'utf8');
        h.write('0', 16, 12, 'utf8');                // mtime
        h.write('0', 28, 6, 'utf8');                 // uid
        h.write('0', 34, 6, 'utf8');                 // gid
        h.write('100644', 40, 8, 'utf8');
        h.write(String(body.length), 48, 10, 'utf8');
        h.write('`\n', 58, 2, 'utf8');
        const pad = body.length % 2 ? Buffer.from('\n') : Buffer.alloc(0);
        return Buffer.concat([h, body, pad]);
    };
    return Buffer.concat([
        Buffer.from('!<arch>\n'),
        member('debian-binary', Buffer.from('2.0\n')),
        member('control.tar.gz', control),
        member('data.tar.gz', data),
    ]);
}

/**
 * Ask lib.sh's native check about one file. Returns { problems, out }.
 *
 * `2>&1`: the count comes back on stdout and every problem on stderr, and a
 * check that read only one of the two would be judging messages it never saw.
 * The count is the last all-digits line.
 *
 * `binDir` narrows PATH INSIDE the script rather than through the child's
 * env, because env-replacement also decides how `bash` itself is resolved and
 * the case would then fail before it ran.
 */
function native(dir, name, binDir) {
    const script = `${binDir ? `PATH=${JSON.stringify(binDir)}; ` : ''}`
        + `source ${JSON.stringify(lib)}; `
        + `xr_check_payload_native ${JSON.stringify(dir)} ${JSON.stringify(name)} 2>&1`;
    const out = execFileSync('bash', ['-c', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const digits = out.trim().split('\n').filter((l) => /^\s*\d+\s*$/.test(l));
    return { problems: Number(digits[digits.length - 1]), out };
}

/** Stage one artifact in a fresh directory and return that directory. */
function stage(name, bytes) {
    const dir = mkdtempSync(join(work, 'set-'));
    writeFileSync(join(dir, name), bytes);
    return dir;
}

try {
    // --- 1. The release lane's shape passes ----------------------------
    {
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const dir = stage(name, deb({ withAddon: true }));
        const r = native(dir, name);
        check('a .deb carrying a compiled addon passes', r.problems === 0, r.out);
        check('and it says nothing about the artifact when it is fine',
            !/PAYLOAD-NATIVE/.test(r.out), r.out);
    }

    // --- 2. The rehearsal's shape is refused ---------------------------
    //
    // This is the measured defect itself  : same app, same version,
    // same filename, and a payload with no compiled addon in it.
    {
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const dir = stage(name, deb({ withAddon: false }));
        const r = native(dir, name);
        check('a .deb with no addon under app.asar.unpacked is refused',
            r.problems === 1 && /PAYLOAD-NATIVE/.test(r.out), r.out);
        check('and the message names the artifact', r.out.includes(name), r.out);
        check('and names what it looked for rather than only that it failed',
            /resources\/app\.asar\.unpacked\/ ends in \.node/.test(r.out.replace(/\n\s+/g, ' ')),
            r.out);
    }

    // --- 2b. The reader is tar, not dpkg-deb ---------------------------
    //
    // The whole point of the seam: sign.sh runs on the RELEASE MACHINE (§8),
    // a Mac with no dpkg at all, and libarchive tar reads a .deb's ar
    // container directly. Driven with dpkg-deb removed from PATH so the case
    // reads the same on the Linux venue, where dpkg-deb exists and would
    // otherwise be the branch that answered.
    {
        const bare = mkdtempSync(join(work, 'nodpkg-'));
        for (const tool of ['tar', 'mktemp', 'grep', 'rm', 'head', 'cut']) {
            const found = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
            symlinkSync(found, join(bare, tool));
        }
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const ok = native(stage(name, deb({ withAddon: true })), name, bare);
        check('with no dpkg-deb on PATH, a good .deb still passes', ok.problems === 0, ok.out);
        const bad = native(stage(name, deb({ withAddon: false })), name, bare);
        check('with no dpkg-deb on PATH, a payload with no addon is still refused',
            bad.problems === 1 && /PAYLOAD-NATIVE/.test(bad.out), bad.out);
    }

    // --- 3. Bytes that are not a package at all are refused ------------
    //
    // "I could not look inside" is not "I looked inside and it was fine",
    // which is the posture the sibling arch gate already takes.
    {
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const dir = stage(name, Buffer.from('this is not a package\n'));
        const r = native(dir, name);
        check('a .deb that cannot be unpacked is refused',
            r.problems === 1 && /could not be unpacked/.test(r.out), r.out);
    }

    // --- 4. No extractor: say so by name, do not fail the release ------
    //
    // An AppImage's payload is squashfs and reading it needs unsquashfs,
    // which the release Mac does not have. Failing here would block the
    // signing path itself to enforce a check one brew command away, so the
    // rule is the one the *.snap branch of the arch gate already follows:
    // name the artifact, name the tool, let the release proceed. What must
    // NOT happen is silence, which is what this case pins.
    //
    // PATH is emptied rather than the tool assumed absent, so this reads the
    // same on a Mac and on a venue with squashfs-tools installed.
    {
        const bare = mkdtempSync(join(work, 'nobin-'));
        const name = 'xchain-wallet-9.9.9-x86_64.AppImage';
        const dir = stage(name, Buffer.from('\x7fELF fixture\n'));
        const r = native(dir, name, bare);
        check('an .AppImage with no unsquashfs is reported UNCHECKED, by name',
            /PAYLOAD-NATIVE-UNCHECKED/.test(r.out) && r.out.includes(name), r.out);
        check('and it names the tool that would let it be checked',
            /unsquashfs/.test(r.out) && /squashfs-tools/.test(r.out), r.out);
        check('and it does not fail the release on its own', r.problems === 0, r.out);
    }

    // --- 4b. The extractor EXISTS: the branch is driven anyway ---------
    //
    // The other half of case 4, and the half no host here can drive for
    // real: the release Mac has no squashfs-tools, so without a stub this
    // branch would ship untested and read exactly like a working check. The
    // stub answers with a listing, which is all the branch consumes; what is
    // under test is the offset scan finding the image's own 'hsqs' magic and
    // the verdict drawn from what came back.
    {
        const listing = (withAddon) => 'squashfs-root/resources/app.asar\n'
            + (withAddon
                ? 'squashfs-root/resources/app.asar.unpacked/node_modules/'
                  + 'tiny-secp256k1/build/Release/secp256k1.node\n'
                : '');
        const name = 'xchain-wallet-9.9.9-x86_64.AppImage';
        // Real ELF magic, then the squashfs magic the scan looks for, so the
        // offset the stub is called with is one the fixture really carries.
        const image = Buffer.concat([Buffer.from('\x7fELF', 'binary'), Buffer.alloc(60),
            Buffer.from('hsqs'), Buffer.from('payload\n')]);

        for (const withAddon of [true, false]) {
            const bin = mkdtempSync(join(work, withAddon ? 'sqfs-ok-' : 'sqfs-bad-'));
            for (const tool of ['grep', 'head', 'cut']) {
                const found = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
                symlinkSync(found, join(bin, tool));
            }
            const stub = join(bin, 'unsquashfs');
            writeFileSync(stub, `#!/bin/sh\nprintf '%s' ${JSON.stringify(listing(withAddon))}\n`, { mode: 0o755 });
            const r = native(stage(name, image), name, bin);
            check(`an .AppImage listing ${withAddon ? 'with' : 'without'} an addon `
                + `is ${withAddon ? 'passed' : 'refused'}`,
                r.problems === (withAddon ? 0 : 1), r.out);
            check('and the extractor branch was reached, not the UNCHECKED one',
                !/PAYLOAD-NATIVE-UNCHECKED/.test(r.out), r.out);
        }
    }

    // --- 5. Every other format is out of scope, silently ---------------
    //
    // measured the Linux lane. What a.dmg or an.exe ought to
    // carry is a rule nobody has driven, and a gate that guessed would refuse
    // a release on an assumption.
    {
        for (const name of ['XChain Wallet-9.9.9-arm64.dmg', 'XChain Wallet Setup 9.9.9.exe',
            'xchain-wallet-9.9.9-mac.zip']) {
            const dir = stage(name, Buffer.from('bytes\n'));
            const r = native(dir, name);
            check(`${name.split('.').pop()} is out of scope and says nothing`,
                r.problems === 0 && !/PAYLOAD-NATIVE/.test(r.out), r.out);
        }
    }

    // --- 5b. A .snap is in scope, and it is squashfs at byte 0 ---------
    //
    // It used to be in case 5's list above, which was scope by accident
    // rather than by measurement: the snap carries the same
    // `resources/app.asar.unpacked/` tree the .deb does, and it is built
    // where this gate's whole defect happens - snapcraft cannot run in the
    // pinned container, so the snap lane builds on the runner. Out of scope,
    // it was the one Linux artifact built outside the container that nothing
    // opened.
    //
    // Driven on stubs FIRST so the branch is exercised on every host,
    // including the ones with no squashfs-tools, and then on real squashfs
    // bytes wherever mksquashfs exists - a stub proves the plumbing, only
    // real bytes prove the format is read.
    {
        const snapName = 'xchain-wallet_9.9.9_amd64.snap';
        const snapListing = (withAddon) => 'squashfs-root/resources/app.asar\n'
            + (withAddon
                ? 'squashfs-root/resources/app.asar.unpacked/node_modules/'
                  + 'tiny-secp256k1/build/Release/secp256k1.node\n'
                : '');
        const binWith = (name, body) => {
            const bin = mkdtempSync(join(work, name));
            for (const tool of ['grep', 'head', 'cut']) {
                const found = execFileSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
                symlinkSync(found, join(bin, tool));
            }
            if (body !== null) writeFileSync(join(bin, 'unsquashfs'), body, { mode: 0o755 });
            return bin;
        };

        // (i) No extractor: named, not silent, and not a release failure.
        {
            const r = native(stage(snapName, Buffer.from('hsqs fixture\n')), snapName,
                binWith('snap-nobin-', null));
            check('a .snap with no unsquashfs is reported UNCHECKED, by name',
                /PAYLOAD-NATIVE-UNCHECKED/.test(r.out) && r.out.includes(snapName), r.out);
            check('and the .snap UNCHECKED line names the tool that would check it',
                /unsquashfs/.test(r.out) && /squashfs-tools/.test(r.out), r.out);
            check('and a .snap nothing could read does not fail the release on its own',
                r.problems === 0, r.out);
        }

        // (ii) Extractor present: the verdict comes from the listing, and no
        //      offset is searched for, because a snap has none to search.
        for (const withAddon of [true, false]) {
            const bin = binWith(withAddon ? 'snap-ok-' : 'snap-bad-',
                `#!/bin/sh\nprintf '%s' ${JSON.stringify(snapListing(withAddon))}\n`);
            const r = native(stage(snapName, Buffer.from('hsqs fixture\n')), snapName, bin);
            check(`a .snap listing ${withAddon ? 'with' : 'without'} an addon `
                + `is ${withAddon ? 'passed' : 'refused'}`,
                r.problems === (withAddon ? 0 : 1), r.out);
            check(`and the .snap extractor branch was reached (${withAddon ? 'with' : 'without'})`,
                !/PAYLOAD-NATIVE-UNCHECKED/.test(r.out), r.out);
        }

        // (iii) Extractor present and the bytes will not list: REFUSED.
        //
        // Deliberately the .deb branch's posture rather than the AppImage
        // branch's. There, the offset is a search that can legitimately come
        // up empty on a file that is fine, so declining to judge is honest;
        // here the image starts at byte 0 and there is nothing to search
        // for, so "unreadable" is a fact about the artifact.
        {
            const bin = binWith('snap-unreadable-', '#!/bin/sh\nexit 1\n');
            const r = native(stage(snapName, Buffer.from('not a snap\n')), snapName, bin);
            check('a .snap the installed extractor cannot list is refused, not passed',
                r.problems === 1 && /could not be read as a squashfs image/.test(r.out), r.out);
            check('and that refusal is not filed as UNCHECKED',
                !/UNCHECKED/.test(r.out), r.out);
        }

        // (iv) REAL squashfs bytes, wherever the tools exist. The stubs above
        //      answer with a listing; only this leg proves the branch reads a
        //      genuine squashfs image, which is the mistake the AppImage leg
        //      shipped for months.
        let mks = '';
        try {
            mks = execFileSync('bash', ['-c', 'command -v mksquashfs'], { encoding: 'utf8' }).trim();
        } catch { mks = ''; }
        if (mks) {
            for (const withAddon of [true, false]) {
                const src = mkdtempSync(join(work, 'snapsrc-'));
                const addonDir = join(src, 'resources', 'app.asar.unpacked', 'node_modules',
                    'tiny-secp256k1', 'build', 'Release');
                const mkdirp = (d) => execFileSync('mkdir', ['-p', d], { stdio: 'ignore' });
                mkdirp(join(src, 'meta'));
                mkdirp(join(src, 'resources'));
                writeFileSync(join(src, 'meta', 'snap.yaml'), 'name: xchain-wallet\n');
                writeFileSync(join(src, 'resources', 'app.asar'), '{"files":{}}');
                if (withAddon) {
                    mkdirp(addonDir);
                    writeFileSync(join(addonDir, 'secp256k1.node'), 'ELF-ish fixture addon\n');
                }
                const built = join(work, `real-${withAddon ? 'with' : 'without'}.snap`);
                execFileSync(mks, [src, built, '-noappend', '-quiet', '-no-progress'],
                    { stdio: ['ignore', 'ignore', 'pipe'] });
                const r = native(stage(snapName, readFileSync(built)), snapName);
                check(`a REAL squashfs .snap ${withAddon ? 'with' : 'without'} an addon `
                    + `is ${withAddon ? 'passed' : 'refused'}`,
                    r.problems === (withAddon ? 0 : 1), r.out);
                check(`and the real .snap was actually read (${withAddon ? 'with' : 'without'})`,
                    !/UNCHECKED/.test(r.out), r.out);
            }
        } else {
            console.log('     (real-bytes .snap leg skipped: no mksquashfs on this host)');
        }
    }

    // --- 6. The directory gate refuses, and says which gate refused ----
    //
    // Two tallies on purpose: an arch defect and a native one are different
    // findings, and one summary reporting both under the arch heading would
    // send whoever reads it to the wrong file.
    {
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const dir = mkdtempSync(join(work, 'gate-'));
        writeFileSync(join(dir, name), deb({ withAddon: false }));
        const script = `source ${JSON.stringify(lib)}; xr_check_payload_arches ${JSON.stringify(dir)} 2>&1`;
        let code = 0;
        let out = '';
        try {
            out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            code = err.status;
            out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        }
        check('the directory gate exits non-zero on a payload with no addon', code === 1, out);
        check('and names the native gate rather than the architecture one',
            /payload-native gate FAILED/.test(out), out);
    }

    // --- 6b. And it passes the release lane's shape --------------------
    {
        const name = 'xchain-wallet_9.9.9_amd64.deb';
        const dir = mkdtempSync(join(work, 'gate-ok-'));
        writeFileSync(join(dir, name), deb({ withAddon: true }));
        const script = `source ${JSON.stringify(lib)}; xr_check_payload_arches ${JSON.stringify(dir)} 2>&1`;
        let code = 0;
        let out = '';
        try {
            out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            code = err.status;
            out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        }
        check('the directory gate passes a .deb built the way the lane builds it',
            code === 0 && /payload-native gate ok/.test(out), `exit ${code}\n${out}`);
    }

    // --- 7. The gate is wired, uncommented -----------------------------
    //
    // Anchored to line start with no `#`, because a substring search accepts
    // a commented-out call and reads as a wired gate. sign.sh's own call to
    // xr_check_payload_arches is pinned by the sibling arch smoke; what is
    // new here is the call INSIDE it, which is what makes this run for a
    // production set and a --staging one alike.
    {
        const src = readFileSync(lib, 'utf8');
        const live = /^[ \t]*n="\$\(xr_check_payload_native "\$dir" "\$name"\)"/m.test(src);
        check('xr_check_payload_arches calls the native check, uncommented', live,
            src.slice(Math.max(0, src.indexOf('xr_check_payload_arches()') - 40),
                src.indexOf('xr_check_payload_arches()') + 1200));
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\nrelease-payload-native smoke: ${failures} failure(s)`);
    process.exit(1);
}

console.log(
    'OK: release payload-native smoke (: a Linux.deb is judged by whether its'
    + ' payload carries the compiled addon a Linux install produces, read with tar so the'
    + ' check is real on the Mac that signs, an AppImage with no unsquashfs is reported'
    + ' UNCHECKED rather than refused, every other format is out of scope, and the'
    + ' directory gate exits 1 naming the native gate)',
);
