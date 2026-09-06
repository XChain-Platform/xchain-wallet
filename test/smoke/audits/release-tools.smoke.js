// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §51 / G003 §6: `tools/release/` signing pipeline.
//
// Two halves. The first pins the scaffolding shape so a future edit cannot
// silently drop a piece. The second RUNS the pipeline against a throwaway git
// repo and a staged artifact set: every gate here exists to refuse something,
// and each negative case asserts the DIAGNOSTIC as well as the exit code,
// because a gate that fails for the wrong reason still "fails".

import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
// One implementation of "do the listing assets still match their pin", shared
// with the ceremony tool rather than reimplemented here.
import { verifyPin, ASSETS } from '../../../tools/release/verify-listing-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Shape: every piece of the pipeline exists and is executable.

const files = [
    'tools/release/README.md',
    'tools/release/lib.sh',
    'tools/release/sign.sh',
    'tools/release/verify.sh',
    'tools/release/expected-artifacts.txt',
    'tools/release/shipped-lanes.txt',
    'tools/release/publish.sh',
    'tools/release/deploy-web.sh',
    'tools/release/verify-listing-assets.mjs',
];
for (const p of files) {
    assert.ok(existsSync(join(root, p)), `${p} exists`);
}

for (const p of ['tools/release/sign.sh', 'tools/release/verify.sh',
    'tools/release/publish.sh', 'tools/release/deploy-web.sh']) {
    const st = statSync(join(root, p));
    assert.ok((st.mode & 0o111) !== 0,
        `${p} has the executable bit set`);
}

// S6. These two encode ordering rules whose violation is
// invisible in testing and obvious to users: a yml uploaded before the
// binary it names, and a web release unpacked over the running site.
const publishSrc = read('tools/release/publish.sh');
assert.ok(/channel pointer, last|LAST/.test(publishSrc),
    'publish.sh uploads the channel pointers last');
assert.ok(/already published/.test(publishSrc),
    'publish.sh refuses to overwrite a published version');
assert.ok(/verify\.sh/.test(publishSrc),
    'publish.sh verifies the signed release before uploading it');
assert.ok(/RELEASE_HASHES\/\$TAG\.txt/.test(publishSrc),
    'publish.sh publishes the manifest under its versioned name');

const deploySrc = read('tools/release/deploy-web.sh');
assert.ok(/mv -Tf/.test(deploySrc),
    'deploy-web.sh flips the symlink atomically rather than unpacking in place');
assert.ok(/index\.html/.test(deploySrc),
    'deploy-web.sh refuses to flip to a release with no entry point');
assert.ok(/no-cache|no-store/.test(deploySrc),
    'deploy-web.sh states the caching contract the server must hold up');

const readme = read('tools/release/README.md');
for (const heading of [
    '# Release-signing pipeline',
    '## Inputs',
    '## Scripts',
    '## Environment variables',
    '## Per-release procedure',
    '## Status today',
]) {
    assert.ok(readme.includes(heading), `README has heading: ${heading}`);
}
assert.ok(/XCHAIN_RELEASE_GPG_KEY/.test(readme),
    'README documents the canonical env var');
assert.ok(/G180/.test(readme), 'README cites G180 (release-key publication gate)');
assert.ok(/§51/.test(readme), 'README cites §51');
// The README is the only place the mobile artifact names are pinned, so a
// convention change that skips it silently renames a shipped artifact.
assert.ok(/xchain-wallet-android-vX\.Y\.Z\.aab/.test(readme),
    'README pins the Android artifact name');
assert.ok(/xchain-wallet-ios-vX\.Y\.Z\.ipa/.test(readme),
    'README pins the iOS artifact name');

// A documented cron line must not arm a lane into a directory it cannot write.
// The invariant sits on the LINE rather than on prose around it, because the
// operator copies the line. Both homes are checked: the README's inventory row
// defers to `--help` for the cron line, so a README-only check would go green
// on a fixed document while the pasted line stayed broken. The failure itself
// is spelled out in the assertion message.
const cronSources = [['tools/release/README.md', readme]];
{
    const help = spawnSync(process.execPath,
        [join(root, 'tools/release/store-version-monitor.mjs'), '--help'],
        { encoding: 'utf8' });
    assert.equal(help.status, 0, `store-version-monitor.mjs --help exits 0 (got ${help.status})`);
    cronSources.push(['store-version-monitor.mjs --help', `${help.stdout}${help.stderr}`]);
}

const monitorCronLines = cronSources.flatMap(([origin, text]) => text
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((l) => /store-version-monitor\.mjs/.test(l))
    // a crontab entry, not prose or an scp: five schedule fields first
    .filter((l) => /^\s*[\d*][^ ]*( +[^ ]+){4} /.test(l))
    .map((l) => ({ origin, line: l })));
assert.ok(monitorCronLines.length >= 4,
    'FAIL: expected the Play-only and combined monitor cron lines in BOTH the README and '
    + `--help; found ${monitorCronLines.length} across ${cronSources.length} sources. If a `
    + 'recipe moved, move this check with it rather than deleting it.');
for (const { origin, line } of monitorCronLines) {
    if (/--no-play\b/.test(line)) continue;   // Play disabled: no latch, no state file
    assert.ok(/PLAY_STATE_PATH=|--state[ =]/.test(line),
        'FAIL: a documented monitor cron line runs the Play lane without giving its latch a '
        + 'writable home, so it inherits the default beside the script in root-owned '
        + '/opt/xchain. It exits 0 while the listing is absent and dies EACCES exit 2 on the '
        + 'first sighting of a live one, then mails that error every six hours. Add '
        + 'PLAY_STATE_PATH=/opt/xchain/state/store-monitor-state.json (what is actually '
        + `deployed) or --no-play. Offending line, from ${origin}: ${line.trim()}`);
}

// A third home exists that this repo cannot reach: a commented-out crontab
// entry on the host, predating the Play lane and carrying neither variable
// (measured 2026-08-10). Uncommenting it reproduces the fault, so the install
// section must say that arming means REPLACING it. Asserted on the
// instruction, not its wording, so rewriting the paragraph stays free.
{
    const installSection = readme.slice(readme.indexOf('### Installing the store-version monitor'))
        .split(/\n### /)[0];
    assert.ok(installSection.length > 0, 'README carries the monitor install section');
    assert.ok(/replac/i.test(installSection) && /uncomment/i.test(installSection),
        'FAIL: the monitor install section does not tell the operator that arming means '
        + 'REPLACING the staged crontab line rather than uncommenting it. The line already on '
        + 'the host predates the Play lane and carries no PLAY_STATE_PATH, so uncommenting it '
        + 'arms the latch into root-owned /opt/xchain - the exact fault the recipe in this '
        + 'section was fixed to avoid. That copy is a third home and nothing in this repo can '
        + 'see it, so this sentence is the only thing standing between the operator and it.');
}

// The inventory table and the install section describe the same deployment,
// and for nine days they disagreed: the table said "NOT installed anywhere
// yet" while the section 17 lines below it was headed DEPLOYED 2026-08-01.
// A reader checking whether a monitor exists reads the table.
const monitorInventoryRow = readme.split('\n')
    .find((l) => /^\|\s*`store-version-monitor\.mjs`/.test(l));
assert.ok(monitorInventoryRow, 'README inventory has a store-version-monitor.mjs row');
assert.ok(!/NOT installed anywhere/i.test(monitorInventoryRow),
    'FAIL: the inventory row calls the monitor uninstalled while this same file documents '
    + 'its install on the release host, and the host has been running it since 2026-08-01. The '
    + 'inventory is what a reader consults to answer "does this exist yet".');

const signSrc = read('tools/release/sign.sh');
const verifySrc = read('tools/release/verify.sh');
const libSrc = read('tools/release/lib.sh');
for (const [name, src] of [['sign.sh', signSrc], ['verify.sh', verifySrc], ['lib.sh', libSrc]]) {
    assert.ok(/^#!\/usr\/bin\/env bash/.test(src), `${name} has bash shebang`);
}
for (const [name, src] of [['sign.sh', signSrc], ['verify.sh', verifySrc]]) {
    assert.ok(/set -euo pipefail/.test(src), `${name} has strict-mode guard`);
    assert.ok(/source "\$HERE\/lib\.sh"/.test(src),
        `${name} sources the shared manifest library (no second copy of the pipeline)`);
}
assert.ok(/XCHAIN_RELEASE_GPG_KEY/.test(signSrc), 'sign.sh references the GPG key env var');
assert.ok(/G180/.test(signSrc), 'sign.sh cites G180 in its diagnostic');
assert.ok(/RELEASE_HASHES\.txt\.asc/.test(signSrc), 'sign.sh writes the .asc detached signature');
// §7.1. lib.sh no longer decides which files are channel pointers;
// it asks update-info.mjs, so that sign.sh and publish.sh cannot drift into
// two different answers. Pinned because the previous answer - a
// `latest*.yml` name glob - matched nothing at channel `stable` and broke
// signing and publishing at once, silently.
assert.ok(/update-info\.mjs/.test(libSrc),
    'lib.sh delegates the artifact/pointer split to update-info.mjs');
assert.ok(!/-name\s+'latest\*\.yml'/.test(libSrc),
    'lib.sh no longer globs for latest*.yml, which matches nothing at channel stable');
assert.ok(/xr_list_update_info/.test(libSrc),
    'lib.sh exposes the channel-pointer list publish.sh uploads last');

const publishSrcOrder = read('tools/release/publish.sh');
assert.ok(/\. "\$HERE\/lib\.sh"/.test(publishSrcOrder),
    'publish.sh sources lib.sh, so its split is the one sign.sh hashed');
assert.ok(/no channel pointers in/.test(publishSrcOrder),
    'publish.sh refuses a release with no channel pointer (invisible to every install)');
/* Not /gpg --verify/: that string appears in this file's own prose, so the
 * assertion used to pass on a comment saying the opposite of what it asserted.
 * What must be true is that the signature is attributed to an expected
 * fingerprint, a VALIDSIG comparison release-verify-signer.smoke.js drives. */
assert.ok(/--status-fd/.test(verifySrc) && /VALIDSIG/.test(verifySrc),
    'verify.sh reads gpg status output so it can attribute the signature to a key');
assert.ok(/EXPECT_KEY/.test(verifySrc) && /--key/.test(verifySrc),
    'verify.sh binds the signature to an expected fingerprint (S37)');
assert.ok(/--no-sig/.test(verifySrc) && /--recompute/.test(verifySrc),
    'verify.sh accepts --no-sig and --recompute');

// Runtime harness: the pipeline driven against a throwaway repo.

const sh = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', ...opts });
const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

const TAG = 'v9.9.9';
const ARTIFACTS = [
    'xchain-wallet-web-v9.9.9.tar.gz',
    'xchain-wallet-extension-v9.9.9.zip',
    // Both arches of every desktop lane (§8). A one-arch list with an
    // un-suffixed `Setup 9.9.9.exe` once signed without complaint, which is the
    // release shape that strands every arm64 install.
    'xchain-wallet-9.9.9-x64.dmg',
    'xchain-wallet-9.9.9-arm64.dmg',
    'xchain-wallet-9.9.9-x64-mac.zip',
    'xchain-wallet-9.9.9-arm64-mac.zip',
    'xchain-wallet-setup-9.9.9-x64.exe',
    'xchain-wallet-setup-9.9.9-arm64.exe',
    'xchain-wallet-9.9.9-x64-win.zip',
    'xchain-wallet-9.9.9-arm64-win.zip',
    'xchain-wallet-9.9.9-x86_64.AppImage',
    'xchain-wallet-9.9.9-arm64.AppImage',
    'xchain-wallet_9.9.9_amd64.deb',
    'xchain-wallet_9.9.9_arm64.deb',
    // "Complete" is whatever tools/release/shipped-lanes.txt says has users.
    // Android shipped in v0.336.0, so a release without these two is a lane
    // regression and sign.sh refuses it. The next lane to flip adds its rows.
    'xchain-wallet-android-v9.9.9.aab',
    'xchain-wallet-v9.9.9.apk',
];

const work = mkdtempSync(join(tmpdir(), 'xc-rel-'));

// The disk-image assessment is stubbed here and only here. Other fixtures are
// faked at the byte level their checkers read; the dmg checker instead asks the
// OS through `spctl`, and Apple cannot notarize fake bytes, so on macOS these
// fixtures would fail a gate that works correctly.
//
// The stub is a PATH shim rather than a flag in the tool: an env var or
// `--skip` inside verify-signatures would be a way to switch a signing gate off
// in production. The gate runs unstubbed in release-signature-gate.smoke.js.
const shimBin = join(work, 'shim-bin');
mkdirSync(shimBin, { recursive: true });
writeFileSync(join(shimBin, 'spctl'),
    '#!/bin/sh\n'
    + '# smoke stub: these fixtures are not real disk images (row 140)\n'
    + 'echo "stub: accepted"\n'
    + 'echo "source=Notarized Developer ID"\n'
    + 'exit 0\n', { mode: 0o755 });
process.env.PATH = `${shimBin}:${process.env.PATH}`;

let failures = 0;
const check = (label, cond, detail) => {
    if (cond) return;
    failures += 1;
    console.error(`FAIL ${label}${detail ? `\n     ${detail.trim().split('\n').join('\n     ')}` : ''}`);
};

try {
    // A pristine clone: the real pipeline refuses to sign from anything else.
    const repo = join(work, 'repo');
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    mkdirSync(join(repo, 'tools', 'build-reproduce'), { recursive: true });
    // Every file below is a gate input sign.sh reads UNCONDITIONALLY before it
    // writes the manifest, so a pristine clone missing any one of them cannot
    // sign at all. The trap is that each absence reads as a staging problem
    // rather than a missing file: store-profile-status.txt in particular stayed
    // invisible until the Android pair joined ARTIFACTS, since the gate reading
    // it only fires on a store-profile artifact and absent it reads
    // '<unreadable>', which is not permission.
    for (const f of ['lib.sh', 'sign.sh', 'verify.sh', 'expected-artifacts.txt',
        'shipped-lanes.txt', 'update-info.mjs', 'verify-signatures.mjs',
        'launch-probe.mjs', 'store-profile-status.txt']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    cpSync(join(root, 'tools/build-reproduce/check-no-dev-mock.sh'),
        join(repo, 'tools/build-reproduce/check-no-dev-mock.sh'));
    git(repo, ['init', '-q', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        'commit', '-qm', 'init']);
    // The throwaway repo must not inherit the operator's git config, the same
    // reason the commits above pass an identity. A global `tag.gpgsign=true`
    // (set on the dev box) turns a lightweight tag into a signed annotated one
    // and fails it with "no tag message?": red where releases are cut, green in
    // a clean CI container.
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', TAG]);
    const tagCommit = git(repo, ['rev-parse', TAG]).stdout.trim();
    assert.ok(/^[0-9a-f]{40}$/.test(tagCommit), 'throwaway repo has a tagged commit');

    const SIGN = join(repo, 'tools/release/sign.sh');
    const VERIFY = join(repo, 'tools/release/verify.sh');

    // A staged artifact has to LOOK SIGNED: sign.sh refuses a release whose
    // artifacts are not, and plain bytes would make every case in this file
    // fail for that one reason instead of the one under test. The two markers
    // the gate reads are a populated PE certificate table for a Windows
    // installer and a sealed _CodeSignature entry for a macOS zip.
    //
    // The .deb is hand-written as an ar archive because neither dpkg-deb nor
    // GNU ar is guaranteed on a developer machine.
    const tarGz = (entries) => {
        const blocks = [];
        for (const [path, body] of entries) {
            const h = Buffer.alloc(512);
            h.write(path, 0, 100, 'utf8');
            h.write('0000644\0', 100, 8, 'utf8');       // mode
            h.write('0000000\0', 108, 8, 'utf8');       // uid
            h.write('0000000\0', 116, 8, 'utf8');       // gid
            h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
            h.write('00000000000\0', 136, 12, 'utf8');  // mtime 0, deterministic
            h.write('        ', 148, 8, 'utf8');         // checksum field, spaces while summing
            h.write('0', 156, 1, 'utf8');                // typeflag: regular file
            h.write('ustar\0' + '00', 257, 8, 'utf8');
            let sum = 0;
            for (const b of h) sum += b;
            h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
            blocks.push(h);
            const data = Buffer.from(body);
            blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
        }
        blocks.push(Buffer.alloc(1024));                 // two zero blocks: end of archive
        return gzipSync(Buffer.concat(blocks), { mtime: 0 });
    };

    const deb = (arch) => {
        const triplet = arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
        const control = tarGz([['./control',
            'Package: xchain-wallet\nVersion: 9.9.9\n'
            + `Architecture: ${arch}\nMaintainer: XChain <releases@dankest.llc>\n`
            + 'Description: fixture\n']]);
        // One payload file per gate that has learned to read a deb: the
        // multiarch library for the payload-architecture gate,
        // `resources/app.asar` for the pre-sign dev-mock gate, and the unpacked
        // `.node` for the payload-native gate. Keep the last path under 100
        // bytes or tarGz truncates the ustar name field and the entry silently
        // stops ending in `.node`.
        const data = tarGz([
            [`./usr/lib/${triplet}/libfixture.so`, 'fixture\n'],
            ['./opt/XChain Wallet/resources/app.asar',
                '{"files":{}}throw new Error("SDKWalletError");\n'],
            ['./opt/XChain Wallet/resources/app.asar.unpacked/tiny-secp256k1/secp256k1.node',
                'fixture addon\n'],
        ]);
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
    };

    const signedBytes = (name) => {
        if (name.endsWith('.exe')) {
            const b = Buffer.alloc(0x400);
            b.writeUInt16LE(0x5a4d, 0);
            b.writeUInt32LE(0x80, 0x3c);
            b.writeUInt32LE(0x00004550, 0x80);
            const opt = 0x80 + 24;
            b.writeUInt16LE(0x20b, opt);
            b.writeUInt32LE(16, opt + 108);
            b.writeUInt32LE(0x9000, opt + 112 + 32);   // certificate table RVA
            b.writeUInt32LE(2048, opt + 112 + 36);     // and its size
            return b;
        }
        // A real zip: the signature gate reads `_CodeSignature` inside it and
        // the dev-mock gate unzips and greps the bundle, so a file merely NAMED
        // `-mac.zip` reads as a corrupt artifact. Null defers to the caller,
        // which builds it with `zip` from a directory.
        if (/mac.*\.zip$/.test(name)) return null;
        // Likewise a real Debian archive, and this one only shows up on the
        // venue: dpkg-deb is absent on a Mac (artifact reported UNCHECKED) and
        // present on Linux CI, where a text file is an unreadable package.
        if (name.endsWith('.deb')) {
            return deb(/arm64/.test(name) ? 'arm64' : 'amd64');
        }
        // An AppImage IS an ELF and the payload-architecture gate reads its
        // header, not its name: 64 bytes of real header, with the e_machine
        // the filename claims.
        if (name.endsWith('.AppImage')) {
            const b = Buffer.alloc(64);
            b.write('\x7fELF', 0, 'binary');
            b[4] = 2;                                    // 64-bit
            b[5] = 1;                                    // little-endian
            b[6] = 1;                                    // version
            b[16] = 2;                                   // e_type: executable
            b.writeUInt16LE(/arm64/.test(name) ? 0xb7 : 0x3e, 18);
            return b;
        }
        return Buffer.from(`bytes of ${name}\n`);
    };

    // Real archives for the reason signedBytes() writes real bytes: the
    // pre-sign dev-mock gate unpacks and greps them. Each carries the real-SDK
    // literal and none of the mock markers, which is what a healthy shipped
    // bundle looks like to that gate.
    const realArchive = (dir, name) => {
        const src = mkdtempSync(join(work, 'bundle-'));
        writeFileSync(join(src, 'app.js'), 'throw new Error("CONTRACT_LINT_FAILED");\n');
        // The extension zip also carries the manifest.json sign.sh reads since
        // S46, with its version DERIVED FROM THE NAME rather than typed here,
        // so the fixture cannot drift from the tag the cases sign with.
        if (/^xchain-wallet-extension-v.*\.zip$/.test(name)) {
            const v = /(\d+\.\d+\.\d+)/.exec(name)[1];
            writeFileSync(join(src, 'manifest.json'),
                `${JSON.stringify({ manifest_version: 3, name: 'XChain Wallet', version: v }, null, 2)}\n`);
        }
        const r = name.endsWith('.zip')
            ? spawnSync('zip', ['-qr', join(dir, name), '.'], { cwd: src, encoding: 'utf8' })
            : spawnSync('tar', ['czf', join(dir, name), '.'], { cwd: src, encoding: 'utf8' });
        // A missing binary gives status null and undefined stderr, so the bare
        // assertion named neither the tool nor the machine: an hour of that on
        // CI on 2026-08-06 while `zip` was not installed.
        assert.ok(!r.error, `staged a real ${name}: ${r.error?.code === 'ENOENT'
            ? `the '${name.endsWith('.zip') ? 'zip' : 'tar'}' command is not installed on this machine`
            : r.error?.message}`);
        assert.equal(r.status, 0, `staged a real ${name}: ${r.stderr}`);
        rmSync(src, { recursive: true, force: true });
    };

    // A mac zip both gates can read: the `_CodeSignature` entry the signature
    // gate looks for, and an `app.asar` carrying the real-SDK literal for the
    // dev-mock gate, which now opens desktop artifacts.
    const realMacZip = (dir, name) => {
        const src = mkdtempSync(join(work, 'macapp-'));
        const contents = join(src, 'XChain Wallet.app', 'Contents');
        mkdirSync(join(contents, '_CodeSignature'), { recursive: true });
        mkdirSync(join(contents, 'Resources'), { recursive: true });
        writeFileSync(join(contents, '_CodeSignature', 'CodeResources'), '<plist/>\n');
        writeFileSync(join(contents, 'Resources', 'app.asar'),
            '{"files":{}}throw new Error("SDKWalletError");\n');
        const r = spawnSync('zip', ['-qr', join(dir, name), '.'], { cwd: src, encoding: 'utf8' });
        assert.ok(!r.error, `staged a real ${name}: ${r.error?.code === 'ENOENT'
            ? "the 'zip' command is not installed on this machine" : r.error?.message}`);
        assert.equal(r.status, 0, `staged a real ${name}: ${r.stderr}`);
        rmSync(src, { recursive: true, force: true });
    };

    // An android container the dev-mock gate can open. `.aab` and `.apk` are
    // zips, and the Capacitor shell's web bundle sits at `assets/public/` in an
    // APK and `base/assets/public/` in a bundle, so the real-SDK literal goes
    // there. A file merely NAMED `.apk` reads as an artifact the gate could not
    // open: right for a release, wrong as a reason for a test to fail.
    const realAndroid = (dir, name) => {
        const src = mkdtempSync(join(work, 'android-'));
        const payload = join(src, name.endsWith('.aab') ? join('base', 'assets', 'public')
            : join('assets', 'public'));
        mkdirSync(payload, { recursive: true });
        writeFileSync(join(payload, 'index.js'),
            'throw new Error("CONTRACT_LINT_FAILED");\n');
        const r = spawnSync('zip', ['-qr', join(dir, name), '.'], { cwd: src, encoding: 'utf8' });
        assert.ok(!r.error, `staged a real ${name}: ${r.error?.code === 'ENOENT'
            ? "the 'zip' command is not installed on this machine" : r.error?.message}`);
        assert.equal(r.status, 0, `staged a real ${name}: ${r.stderr}`);
        rmSync(src, { recursive: true, force: true });
    };

    const stage = (extra = [], omit = []) => {
        const dir = mkdtempSync(join(work, 'stage-'));
        for (const name of ARTIFACTS) {
            if (omit.includes(name)) continue;
            if (/^xchain-wallet-web-v.*\.tar\.gz$/.test(name)
                || /^xchain-wallet-extension-v.*\.zip$/.test(name)) {
                realArchive(dir, name);
                continue;
            }
            if (/mac.*\.zip$/.test(name)) {
                realMacZip(dir, name);
                continue;
            }
            if (/\.(aab|apk)$/.test(name)) {
                realAndroid(dir, name);
                continue;
            }
            writeFileSync(join(dir, name), signedBytes(name));
        }
        for (const name of extra) writeFileSync(join(dir, name), 'extra\n');
        // Channel pointers: present in a real staging dir, never in the
        // manifest. Real names because our channel is `stable` (§7.1), and real
        // SHAPE because the split is decided on content: a stub of just
        // `version: 9.9.9` classifies as an artifact and fails the gate.
        for (const name of ['stable.yml', 'stable-mac.yml', 'stable-linux.yml',
            'stable-linux-arm64.yml']) {
            writeFileSync(join(dir, name),
                'version: 9.9.9\n'
                + 'files:\n'
                + '  - url: xchain-wallet-9.9.9.dmg\n'
                + '    sha512: ZmFrZQ==\n'
                + 'path: xchain-wallet-9.9.9.dmg\n'
                + 'sha512: ZmFrZQ==\n'
                + "releaseDate: '2026-07-31T00:00:00.000Z'\n");
        }
        return dir;
    };

    // A key is only needed to reach the gpg call at the very bottom of
    // sign.sh; every gate under test runs ahead of it. A placeholder gets
    // the negative cases past the config check without needing GnuPG.
    const gateEnv = { ...process.env, XCHAIN_RELEASE_GPG_KEY: 'smoke-placeholder' };
    delete gateEnv.SIGN_SKIP_DEV_MOCK_CHECK;


    const signArgs = (dir, tag = TAG) =>
        [SIGN, '--tag', tag, '--repo', repo, '--input', dir];

    // 1. Missing --tag: an unanchored manifest can be replayed onto
    //    another release, so the tag is mandatory, not defaulted.
    {
        const env = { ...gateEnv };
        delete env.XCHAIN_RELEASE_TAG;
        const r = sh([SIGN, '--repo', repo, '--input', stage()], { env });
        check('sign.sh without --tag exits 2', r.status === 2, `exit ${r.status}`);
        check('sign.sh without --tag explains the replay risk',
            /float between versions/.test(r.stderr), r.stderr);
    }

    // 2. Unknown tag: signing a tag git has never seen means the bytes
    //    trace back to nothing.
    {
        const r = sh(signArgs(stage(), 'v0.0.1'), { env: gateEnv });
        check('sign.sh with an unknown tag fails', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the missing tag',
            /tag 'v0\.0\.1' does not exist/.test(r.stderr), r.stderr);
    }

    // 3. Dirty worktree. This is the one that has actually happened:
    //    `~/Sites` is shared over NFS and a neighbour's uncommitted edits
    //    have compiled into a wallet build there.
    {
        writeFileSync(join(repo, 'NEIGHBOUR.txt'), 'work in progress\n');
        const r = sh(signArgs(stage()), { env: gateEnv });
        rmSync(join(repo, 'NEIGHBOUR.txt'));
        check('sign.sh refuses a dirty worktree', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the uncommitted file',
            /NEIGHBOUR\.txt/.test(r.stderr), r.stderr);
    }

    // 4. HEAD moved past the tag (the second coder pushed since step 1).
    {
        git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
            'commit', '-q', '--allow-empty', '-m', 'second coder pushed']);
        const r = sh(signArgs(stage()), { env: gateEnv });
        git(repo, ['reset', '-q', '--hard', TAG]);
        check('sign.sh refuses when HEAD is not the tag commit', r.status === 1, `exit ${r.status}`);
        check('sign.sh reports both commits',
            /is not checked out at/.test(r.stderr) && r.stderr.includes(tagCommit), r.stderr);
    }

    // 5. Dev-mock gate script missing: HARD failure, not a warning.
    //    "The gate could not run" and "the gate passed" must never
    //    produce the same release.
    {
        const gate = join(repo, 'tools/build-reproduce/check-no-dev-mock.sh');
        // Park the backup OUTSIDE the clone: left inside, it is an
        // untracked file and the dirty-worktree gate fires first, so
        // this case would pass on the wrong refusal.
        const parked = join(work, 'check-no-dev-mock.sh.bak');
        renameSync(gate, parked);
        git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
            'commit', '-qam', 'drop gate']);
        git(repo, ['-c', 'tag.gpgsign=false', 'tag', 'v9.9.8']);
        const r = sh(signArgs(stage(), 'v9.9.8'), { env: gateEnv });
        git(repo, ['reset', '-q', '--hard', TAG]);
        renameSync(parked, gate);
        check('a missing dev-mock gate is a hard failure', r.status === 1, `exit ${r.status}`);
        check('sign.sh says an unrunnable gate has not passed',
            /A gate that cannot run has not passed/.test(r.stderr), r.stderr);
    }

    // 6. A required artifact is missing: without this gate the manifest
    //    is internally perfect and describes a release that never built.
    {
        const r = sh(signArgs(stage([], [
            'xchain-wallet-setup-9.9.9-x64.exe',
            'xchain-wallet-setup-9.9.9-arm64.exe',
        ])), { env: gateEnv });
        check('sign.sh refuses a partial artifact set', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the unmatched required pattern',
            /MISSING.*\*\.exe/.test(r.stderr), r.stderr);
    }

    // 7. An undeclared artifact is staged. A blockmap is the realistic
    //    case: electron-builder emits them, and differential updates are
    //    a non-goal (§7), so one appearing here means delta metadata
    //    would be served but never verified.
    {
        const r = sh(signArgs(stage(['xchain-wallet-9.9.9-arm64.dmg.blockmap'])), { env: gateEnv });
        check('sign.sh refuses an undeclared artifact', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the undeclared file',
            /UNDECLARED.*blockmap/.test(r.stderr), r.stderr);
    }

    // 7b. The tag names one version and the staged bytes are another. Every
    //     gate above counts artifacts; none asked whether they are the version
    //     the tag names. Reachable by accident: `pnpm release:sign` builds both
    //     --tag and --input from the local package.json, so a checkout behind
    //     the staged release signs the older tag over the newer bytes with
    //     every other gate passing and the signature good.
    {
        git(repo, ['-c', 'tag.gpgsign=false', 'tag', '-f', 'v9.9.8']);
        const r = sh(signArgs(stage(), 'v9.9.8'), { env: gateEnv });
        check('sign.sh refuses a tag that is not the staged version',
            r.status === 1, `exit ${r.status}: ${r.stderr}`);
        check('sign.sh names the artifacts whose version disagrees with the tag',
            /does not match the staged artifacts/.test(r.stderr)
            && /xchain-wallet-web-v9\.9\.9\.tar\.gz/.test(r.stderr), r.stderr);
        // The other direction, or "always refuse" would satisfy the above.
        const ok = sh(signArgs(stage()), { env: gateEnv });
        check('sign.sh does NOT refuse the matching tag on that account',
            !/does not match the staged artifacts/.test(ok.stderr), ok.stderr);
    }

    // 7c. The check above reads the NAME, and a name is a `cp` away from being
    //     anything: the CI-built extension zip for v0.336.0, renamed to
    //     v0.337.0, passed every gate here and was hashed into the manifest.
    //     The extension lane pays most for that, because the Chrome Web Store
    //     reads manifest.json's version and enforces it monotonically, so a
    //     stale zip under a new tag later surfaces as a live version no
    //     publish-log row matches: the rogue-publish signal, raised by a
    //     release that was legitimate.
    {
        const dir = stage();
        const zip = readdirSync(dir).find((n) => /^xchain-wallet-extension-v.*\.zip$/.test(n));
        assert.ok(zip, 'the staging fixture no longer contains an extension zip to rewrite');
        const src = mkdtempSync(join(work, 'stalezip-'));
        writeFileSync(join(src, 'app.js'), 'throw new Error("CONTRACT_LINT_FAILED");\n');
        // Same bytes as a healthy bundle in every respect but the one number.
        writeFileSync(join(src, 'manifest.json'),
            `${JSON.stringify({ manifest_version: 3, name: 'XChain Wallet', version: '9.9.8' }, null, 2)}\n`);
        rmSync(join(dir, zip), { force: true });
        const z = spawnSync('zip', ['-qr', join(dir, zip), '.'], { cwd: src, encoding: 'utf8' });
        assert.equal(z.status, 0, `restaged a stale-content extension zip: ${z.stderr}`);

        const stale = sh(signArgs(dir), { env: gateEnv });
        check('sign.sh refuses an extension zip whose manifest.json is a different release',
            stale.status === 1, `exit ${stale.status}: ${stale.stderr}`);
        check('sign.sh names both numbers rather than only refusing',
            /does not CONTAIN the version its name claims/.test(stale.stderr)
            && /manifest\.json says 9\.9\.8, the tag says 9\.9\.9/.test(stale.stderr), stale.stderr);
        // Without this, "always refuse" satisfies the two checks above and the
        // whole release lane is dead in a way nothing here would notice.
        const good = sh(signArgs(stage()), { env: gateEnv });
        check('sign.sh does NOT refuse a zip that really contains the tagged version',
            !/does not CONTAIN the version its name claims/.test(good.stderr), good.stderr);
    }

    // 8. --help prints the usage block, not the licence header.
    for (const script of [SIGN, VERIFY]) {
        const r = sh([script, '--help']);
        check(`${script.endsWith('sign.sh') ? 'sign' : 'verify'}.sh --help exits 0`,
            r.status === 0, r.stderr);
        const name = script.endsWith('sign.sh') ? 'sign' : 'verify';
        check(`${name}.sh --help prints the whole usage block, not the licence`,
            new RegExp(`^\\s*# tools/release/${name}\\.sh`, 'm').test(r.stdout) &&
            /Usage:/.test(r.stdout) &&
            !/SPDX-License-Identifier/.test(r.stdout),
            r.stdout.slice(0, 200));
    }

    // 9. No GPG key configured: the documented pre-G180 exit path.
    {
        const env = { ...process.env };
        delete env.XCHAIN_RELEASE_GPG_KEY;
        const r = sh(signArgs(stage()), { env });
        check('sign.sh without a GPG key exits 1', r.status === 1, `exit ${r.status}`);
        check('sign.sh cites G180', /G180/.test(r.stderr), r.stderr);
    }

    // Signed round trip. Needs a working GnuPG, and is skipped rather than
    // failed without one: a missing gpg is an environment fact, not a
    // regression, and the gates above all ran regardless.
    const gnupgHome = mkdtempSync(join(tmpdir(), 'xcg-'));
    const gpgEnv = { ...process.env, GNUPGHOME: gnupgHome };
    const keygen = spawnSync('gpg', [
        '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
        '--quick-generate-key', 'XChain Release Smoke <smoke@test.invalid>',
        'default', 'default', 'never',
    ], { encoding: 'utf8', env: gpgEnv });

    let fpr = '';
    if (keygen.status === 0) {
        const listed = spawnSync('gpg', ['--list-secret-keys', '--with-colons'],
            { encoding: 'utf8', env: gpgEnv });
        fpr = (listed.stdout.split('\n').find((l) => l.startsWith('fpr:')) || '').split(':')[9] || '';
    }

    if (!fpr) {
        console.log('SKIP  signed round trip (no usable gpg in this environment)');
    } else {
        /* verify.sh binds a signature to an expected fingerprint and this
         * fixture repo has no release-key pin, so the throwaway key IS the
         * expected key. That binding is driven for real in
         * release-verify-signer.smoke.js. */
        const env = { ...gpgEnv, XCHAIN_RELEASE_GPG_KEY: fpr, XCHAIN_VERIFY_KEY: fpr };
        delete env.SIGN_SKIP_DEV_MOCK_CHECK;

        const dir = stage();

        const signed = sh(signArgs(dir), { env });
        check('sign.sh signs a complete artifact set', signed.status === 0,
            `${signed.stderr}`);

        const manifestPath = join(dir, 'RELEASE_HASHES.txt');
        const manifest = readFileSync(manifestPath, 'utf8');
        const header = Object.fromEntries(
            manifest.split('\n')
                .filter((l) => l.startsWith('# ') && l.includes(': '))
                .map((l) => {
                    const i = l.indexOf(': ');
                    return [l.slice(2, i), l.slice(i + 2)];
                }));

        check('manifest header pins the tag', header.tag === TAG, JSON.stringify(header));
        check('manifest header pins the tag commit', header['tag-commit'] === tagCommit,
            JSON.stringify(header));
        check('manifest header records the dev-mock gate as enforced',
            header['dev-mock-gate'] === 'enforced', JSON.stringify(header));
        check('manifest header counts the artifacts',
            header.artifacts === String(ARTIFACTS.length), JSON.stringify(header));
        check('manifest excludes the mutable channel pointers',
            !/stable(-mac|-linux|-linux-arm64)?\.yml/.test(manifest), manifest);
        check('manifest covers every staged artifact',
            ARTIFACTS.every((a) => manifest.includes(`./${a}`)), manifest);
        check('signature file was written', existsSync(`${manifestPath}.asc`));

        // The interop that decides whether the desktop update lane works: the
        // maintainer signs with the gpg CLI and the app verifies with
        // openpgp.js. If those two disagree, every desktop update fails in the
        // field for a reason synthetic-key unit tests never show.
        {
            const openpgp = await import('openpgp');
            const { verifyManifestSignature } =
                await import('../../../packages/desktop/main/updateVerify.js');
            const exported = spawnSync('gpg', ['--armor', '--export', fpr],
                { encoding: 'utf8', env });
            check('the release public key exports for pinning',
                exported.status === 0 && /BEGIN PGP PUBLIC KEY BLOCK/.test(exported.stdout),
                exported.stderr);
            const armoredKey = exported.stdout;
            const key = await openpgp.readKey({ armoredKey });
            const pinned = { armoredKey, fingerprint: key.getFingerprint().toUpperCase() };

            const armoredSignature = readFileSync(`${manifestPath}.asc`, 'utf8');
            const manifestBytes = readFileSync(manifestPath);

            const verdict = await verifyManifestSignature(manifestBytes, armoredSignature, pinned);
            check('openpgp.js verifies the signature the gpg CLI just made',
                verdict.ok, JSON.stringify(verdict));

            const tampered = Buffer.concat([manifestBytes, Buffer.from('# appended\n')]);
            const tamperVerdict = await verifyManifestSignature(tampered, armoredSignature, pinned);
            check('and rejects the same manifest with one byte appended',
                !tamperVerdict.ok, JSON.stringify(tamperVerdict));

            // The fingerprint cross-check that catches a swapped key.
            const wrongFp = await verifyManifestSignature(manifestBytes, armoredSignature,
                { armoredKey, fingerprint: 'DEADBEEF'.repeat(5) });
            check('and rejects a key that is not the pinned fingerprint',
                !wrongFp.ok, JSON.stringify(wrongFp));
        }

        // Neither signature file is itself an artifact.
        check('the manifest does not cover its own signatures',
            !/RELEASE_HASHES\.txt\.asc/.test(manifest), manifest);

        // Round trip with the tag supplied.
        const ok = sh([VERIFY, '--input', dir, '--tag', TAG], { env });
        check('verify.sh accepts the freshly signed release', ok.status === 0, ok.stderr);
        check('verify.sh reports the anchor', /header anchor ok/.test(ok.stderr), ok.stderr);

        // The published name is itself the anchor.
        cpSync(manifestPath, join(dir, `${TAG}.txt`));
        cpSync(`${manifestPath}.asc`, join(dir, `${TAG}.txt.asc`));
        const byName = sh([VERIFY, '--input', dir, '--manifest', join(dir, `${TAG}.txt`)], { env });
        check('verify.sh anchors on the versioned filename', byName.status === 0, byName.stderr);

        // The replay this whole header exists to stop: every hash is
        // right and the signature is genuine, but it is another release.
        const wrong = sh([VERIFY, '--input', dir, '--tag', 'v8.8.8'], { env });
        check('verify.sh rejects a manifest replayed onto another release',
            wrong.status === 1, wrong.stderr);
        check('verify.sh names both tags',
            /describes 'v9\.9\.9' but you expected 'v8\.8\.8'/.test(wrong.stderr), wrong.stderr);

        // Signature mode with nothing to anchor against: "the signature
        // is good" plus "I don't know which release this is" is the gap.
        const unanchored = sh([VERIFY, '--input', dir], { env });
        check('verify.sh refuses an unanchored manifest in signature mode',
            unanchored.status === 1, unanchored.stderr);

        // Truncation: a dropped line, header count unchanged.
        const kept = manifest.split('\n').filter((l) => !l.includes('.AppImage')).join('\n');
        writeFileSync(manifestPath, kept);
        const truncated = sh([VERIFY, '--input', dir, '--tag', TAG, '--no-sig'], { env });
        check('verify.sh catches a truncated manifest', truncated.status === 1, truncated.stderr);
        check('verify.sh reports the count mismatch',
            /claims \d+ artifact\(s\) but carries/.test(truncated.stderr), truncated.stderr);

        // Malformed hash lines. macOS /sbin/sha256sum prints a warning
        // and EXITS 0 for these, so a manifest that verified nothing at
        // all would otherwise report a clean hash check.
        writeFileSync(manifestPath, `${manifest.split('\n').filter((l) => l.startsWith('#')).join('\n')}\ndeadbeef  ./x\n`);
        const malformed = sh([VERIFY, '--input', dir, '--tag', TAG, '--no-sig'], { env });
        check('verify.sh refuses malformed hash lines', malformed.status === 1, malformed.stderr);
        check('verify.sh explains why the tool cannot be trusted here',
            /MALFORMED/.test(malformed.stderr), malformed.stderr);

        // A tampered artifact, manifest untouched.
        writeFileSync(manifestPath, manifest);
        writeFileSync(join(dir, 'xchain-wallet-9.9.9-x86_64.AppImage'), 'malware\n');
        const tampered = sh([VERIFY, '--input', dir, '--tag', TAG, '--no-sig'], { env });
        check('verify.sh catches a tampered artifact', tampered.status === 1,
            `${tampered.stdout}${tampered.stderr}`);

        // A headerless manifest cannot answer for a release: strip the `# `
        // lines and the hash rows still cover the artifacts perfectly, so
        // --no-sig warns and exits 0 with --tag never consulted, and a
        // checksum-only manifest built for another release satisfies a request
        // for this one on the path deploy-web.sh runs before flipping a site.
        //
        // Pinned here is the half that must SURVIVE the refusal: the genuinely
        // unanchored hash-only mode the warning exists to serve. The refusal
        // itself ships with the verify.sh change, which is held back because
        // editing that script moves it off the sha256 the release rehearsal pin
        // records, and re-driving that rehearsal is an operator step on the
        // release machine. Both halves land in the same change.
        const bare = stage();
        const barePath = join(bare, 'RELEASE_HASHES.txt');
        const bareWrite = sh([VERIFY, '--input', bare, '--recompute'], { env });
        check('fixture: --recompute writes the manifest to strip',
            bareWrite.status === 0, bareWrite.stderr);
        writeFileSync(barePath,
            readFileSync(barePath, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'));
        const unasked = sh([VERIFY, '--input', bare, '--no-sig'], { env });
        check('a bare hash check with no anchor requested still passes',
            unasked.status === 0, `${unasked.stdout}${unasked.stderr}`);
        check('and still says out loud that the manifest has no header',
            /no header/.test(unasked.stderr), unasked.stderr);

        // verify.sh must be able to read what verify.sh writes. Found
        // 2026-08-02: `--recompute` wrote a manifest verify.sh then refused on
        // any tag, because the profile check keyed on a header line a recompute
        // manifest also carries. It matters because signing is blocked on the
        // release-key ceremony, so --recompute is the only way an operator can
        // hash-verify an artifact today and the runbook sends them down it.
        const rt = stage();
        rmSync(join(rt, 'RELEASE_HASHES.txt'), { force: true });
        rmSync(join(rt, 'RELEASE_HASHES.txt.asc'), { force: true });
        const recomputed = sh([VERIFY, '--input', rt, '--recompute'], { env });
        check('verify.sh --recompute writes a manifest', recomputed.status === 0, recomputed.stderr);
        const rtManifest = readFileSync(join(rt, 'RELEASE_HASHES.txt'), 'utf8');
        check('and stamps it as not describing a release',
            /^# tag: \(none\)$/m.test(rtManifest), rtManifest.slice(0, 300));
        check('and gives it no build-profile lines',
            !/^# profile /m.test(rtManifest), rtManifest.slice(0, 400));

        const readBack = sh([VERIFY, '--input', rt, '--no-sig'], { env });
        check('verify.sh reads back its own --recompute output', readBack.status === 0,
            `${readBack.stdout}${readBack.stderr}`);
        check('and says plainly that nothing anchors it',
            /nothing anchors it/.test(readBack.stderr), readBack.stderr);

        // The profile check must still bite on a manifest that DOES claim a
        // release, or the fix above would have bought the green by deleting
        // the rule rather than by scoping it.
        const declawed = stage();
        const declawedSign = sh(signArgs(declawed), { env });
        check('fixture: the declawed stage signs first', declawedSign.status === 0, declawedSign.stderr);
        const declawedPath = join(declawed, 'RELEASE_HASHES.txt');
        writeFileSync(declawedPath,
            readFileSync(declawedPath, 'utf8').split('\n').filter((l) => !l.startsWith('# profile ')).join('\n'));
        const stripped = sh([VERIFY, '--input', declawed, '--tag', TAG, '--no-sig'], { env });
        check('verify.sh still refuses a RELEASE manifest with no profile lines',
            stripped.status === 1, `${stripped.stdout}${stripped.stderr}`);
        check('and names the missing profile claim',
            /profile/i.test(stripped.stderr), stripped.stderr);

        // The escape hatch survives, but leaves a permanent signed trace.
        const skipped = stage();
        const skipRun = sh(signArgs(skipped), {
            env: { ...env, SIGN_SKIP_DEV_MOCK_CHECK: '1' },
        });
        check('sign.sh still signs with the gate skipped', skipRun.status === 0, skipRun.stderr);
        const skipManifest = readFileSync(join(skipped, 'RELEASE_HASHES.txt'), 'utf8');
        check('a skipped dev-mock gate is recorded in the SIGNED header',
            /^# dev-mock-gate: SKIPPED$/m.test(skipManifest), skipManifest.slice(0, 300));
        const skipVerify = sh([VERIFY, '--input', skipped, '--tag', TAG], { env });
        check('verify.sh surfaces the skipped gate to whoever checks the release',
            /dev-mock gate state is 'SKIPPED'/.test(skipVerify.stderr), skipVerify.stderr);
    }
    rmSync(gnupgHome, { recursive: true, force: true });
} finally {
    rmSync(work, { recursive: true, force: true });
}

// Wiring and gate: the package scripts that drive all of the above.

const rootPkg = JSON.parse(read('package.json'));
assert.ok(/tools\/release\/sign\.sh/.test(rootPkg.scripts['release:sign'] || ''),
    'release:sign wraps tools/release/sign.sh');
assert.ok(/--tag v\$\(node -p/.test(rootPkg.scripts['release:sign']),
    'release:sign passes the tag (sign.sh now requires it)');
assert.ok(/release-artifacts\//.test(rootPkg.scripts['release:sign']),
    'release:sign targets release-artifacts/<version>');
assert.ok(/tools\/release\/verify\.sh/.test(rootPkg.scripts['release:verify'] || ''),
    'root package.json has a release:verify wrapper');
assert.ok(/--tag v\$\(node -p/.test(rootPkg.scripts['release:verify']),
    'release:verify anchors to the version it is checking');

// §6 step 1: the release gate is ONE command. It runs the full CI
// suite plus the regtest e2e venue, and only the latter proves real
// transaction signing - the dev server silently substitutes the mock SDK,
// so a green `test:e2e` says nothing about whether the wallet can sign.
assert.ok(rootPkg.scripts['test:e2e:regtest'] &&
    /playwright\.regtest\.config\.js/.test(rootPkg.scripts['test:e2e:regtest']),
    'root package.json exposes the prod-build regtest e2e suite');
assert.ok(rootPkg.scripts['release:gate'],
    'root package.json has a release:gate script (§6 step 1)');
assert.ok(/\bci\b/.test(rootPkg.scripts['release:gate']) &&
    /test:e2e:regtest/.test(rootPkg.scripts['release:gate']),
    'release:gate runs CI *and* the prod-build regtest e2e');

assert.ok(!/wait-ready|regtest/.test(rootPkg.scripts['test:integration']),
    'default test:integration stays network-free (no regtest gate)');
assert.ok(rootPkg.scripts['test:integration:regtest'] &&
    /tools\/regtest\/test-integration\.sh/.test(rootPkg.scripts['test:integration:regtest']),
    'root package.json has the regtest integration driver script');

assert.ok(/check-no-dev-mock\.sh/.test(signSrc), 'sign.sh runs the pre-sign dev-mock gate');
assert.ok(/SIGN_SKIP_DEV_MOCK_CHECK/.test(signSrc),
    'sign.sh exposes the SIGN_SKIP_DEV_MOCK_CHECK escape hatch');

// The gate scans every shell bundle that actually ships. The
// desktop renderer is a separate tree and was not scanned at all.
const devMockSrc = read('tools/build-reproduce/check-no-dev-mock.sh');
assert.ok(/packages\/desktop\/renderer\/dist/.test(devMockSrc),
    'dev-mock gate scans the desktop renderer bundle');
assert.ok(!/"packages\/desktop\/dist"/.test(devMockSrc),
    'dev-mock gate does NOT scan electron-builder installer output (not a source tree)');
for (const shell of ['web', 'extension']) {
    assert.ok(new RegExp(`packages/${shell}/dist\\|`).test(devMockSrc),
        `dev-mock gate still scans packages/${shell}/dist with its own SDK markers`);
}

// The expected-artifact list is the thing that stops a partial release
// from producing a clean-looking manifest, so its own shape is pinned.
const expected = read('tools/release/expected-artifacts.txt');
const expectedRows = expected.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/));
assert.ok(expectedRows.length > 0, 'expected-artifacts.txt declares rows');
// The status column names both the strength and the release set:
// `required`/`optional` describe a production release, `staging-<os>-*` the
// §7.5 per-OS rehearsal set, which holds only update-capable formats and can
// never satisfy a production row. Enumerated rather than prefix-matched so a
// typo like `stagng-required` fails here instead of being waved through, the
// same reason lib.sh and verify-signatures.mjs refuse an unknown status. This
// array is the third of three places that must agree (lib.sh's
// xr_set_for_status, verify-signatures.mjs's SET_FOR_STATUS, and this).
const EXPECTED_STATUSES = [
    'required', 'optional',
    'staging-linux-required', 'staging-linux-optional',
    'staging-mac-required', 'staging-mac-optional',
    'staging-windows-required', 'staging-windows-optional',
];
for (const [status, pattern] of expectedRows) {
    assert.ok(EXPECTED_STATUSES.includes(status),
        `expected-artifacts.txt row status is one of ${EXPECTED_STATUSES.join('|')} (got '${status}')`);
    assert.ok(pattern && pattern.length > 0, 'expected-artifacts.txt row has a pattern');
}
const requiredPats = expectedRows.filter(([s]) => s === 'required').map(([, p]) => p);
for (const pat of ['xchain-wallet-web-v*.tar.gz', 'xchain-wallet-extension-v*.zip']) {
    assert.ok(requiredPats.includes(pat), `expected-artifacts.txt requires ${pat}`);
}
const optionalPats = expectedRows.filter(([s]) => s === 'optional').map(([, p]) => p);
for (const pat of ['xchain-wallet-android-v*.aab', 'xchain-wallet-ios-v*.ipa']) {
    assert.ok(optionalPats.includes(pat),
        `expected-artifacts.txt declares the dormant mobile artifact ${pat}`);
}
assert.ok(!expectedRows.some(([, p]) => p.includes('blockmap')),
    'blockmaps stay undeclared (differential updates are a non-goal)');

// Reproduce wiring: the scripts that rebuild a shipped bundle.

const driverSrc = read('tools/regtest/test-integration.sh');
assert.ok(/set -euo pipefail/.test(driverSrc), 'regtest driver has strict-mode guard');
assert.ok(/wait-ready\.sh/.test(driverSrc), 'regtest driver gates on wait-ready.sh');
assert.ok((statSync(join(root, 'tools/regtest/test-integration.sh')).mode & 0o111) !== 0,
    'regtest driver has the executable bit set');

for (const shell of ['web', 'extension']) {
    const repro = `packages/${shell}/scripts/reproduce.sh`;
    const buildSh = `packages/${shell}/scripts/build.sh`;
    const dockerfile = `packages/${shell}/Dockerfile`;
    // The per-shell REPRODUCIBLE_BUILDS.md now lives as one page in
    // xchain-documentation, gated by repro-build-root-doc.smoke.js. This loop
    // keeps the scripts, which are what actually reproduce a build.
    for (const p of [repro, buildSh, dockerfile]) {
        assert.ok(existsSync(join(root, p)), `${p} exists`);
    }
    for (const p of [repro, buildSh]) {
        assert.ok((statSync(join(root, p)).mode & 0o111) !== 0,
            `${p} has the executable bit set`);
    }
    const reproSrc = read(repro);
    assert.ok(/set -euo pipefail/.test(reproSrc), `${repro} has strict-mode guard`);
    assert.ok(/SOURCE_DATE_EPOCH/.test(reproSrc), `${repro} injects SOURCE_DATE_EPOCH`);
    assert.ok(/git worktree add/.test(reproSrc), `${repro} builds from an isolated worktree`);

    const buildSrc = read(buildSh);
    assert.ok(/--frozen-lockfile/.test(buildSrc), `${buildSh} installs with --frozen-lockfile`);
    assert.ok(/check-no-dev-mock\.sh/.test(buildSrc), `${buildSh} runs the dev-mock gate`);
    assert.ok(/sha256sum/.test(buildSrc) && /RELEASE_HASHES\.txt/.test(buildSrc),
        `${buildSh} emits a SHA-256 RELEASE_HASHES.txt manifest`);

    const dockerSrc = read(dockerfile);
    assert.ok(/@sha256:/.test(dockerSrc), `${dockerfile} pins its base image by digest`);
    // Either spelling: the parameterised `NODE_SHA256_X64=` is correct, and the
    // extension and web lanes moved onto it once their hardcoded form was found
    // pinning a Node MAJOR below the release lane's. This asserts the tarball
    // is verified at all; reproducible-toolchain.smoke.js holds the value.
    assert.ok(/NODE_SHA256(_X64)?=/.test(dockerSrc),
        `${dockerfile} SHA256-verifies the Node tarball`);

    const shellPkg = JSON.parse(read(`packages/${shell}/package.json`));
    assert.ok(/scripts\/reproduce\.sh/.test(shellPkg.scripts.reproduce || ''),
        `packages/${shell}/package.json has a reproduce script`);
}

// The store listing assets are pinned.
//
// A pixel-dimension check settles the ADDRESS, not the contents: on 2026-08-06
// the four assets were captured at v0.333.1 while the staged release was
// v0.336.0, 33 commits later, and nothing recorded which build they came from.
//
// This section holds the half checkable everywhere (the pin exists, covers
// every asset, and matches the bytes on disk) and deliberately not the drift
// half, which would go red on every UI commit; drift is only a defect at upload
// time, so it lives in the ceremony's Phase 5 step. It lives in THIS file
// because its subject is entirely inside this repo, while
// extension-listing-pack.smoke.js skips itself when the docs sibling is absent.
const pinned = verifyPin();
assert.ok(!pinned.reason,
    `the Chrome Web Store listing assets have no usable capture pin: ${pinned.reason}. `
    + 'Their pixel dimensions cannot say which build they depict, so without this note the '
    + 'submission uploads four images nobody can date. Write it with '
    + 'node tools/release/verify-listing-assets.mjs --write.');
assert.deepEqual(pinned.hashProblems, [],
    'the listing assets no longer match their capture pin. Either an asset was replaced, '
    + 're-cropped or hand-edited without a capture run, or the pin was edited to describe bytes '
    + 'that are not there. Re-run packages/extension/scripts/capture-listing-screenshots.mjs, '
    + 'which re-pins as it goes.');
assert.deepEqual(pinned.extra, [],
    'the capture pin describes files that are not listing assets. The pin and the asset map in '
    + 'tools/release/verify-listing-assets.mjs have to name the same four files.');
assert.ok(['capture', 'derived'].includes(pinned.pin.capturedFrom.how),
    `capture pin records how=${pinned.pin.capturedFrom.how}, which is neither 'capture' (a real `
    + "capture run wrote it) nor 'derived' (reconstructed from git history). The field exists so a "
    + 'reader can tell an observation from a reconstruction.');

// The pin is only worth anything if a capture keeps writing it. A future edit
// that drops the call leaves the last pin sitting there describing bytes that
// have since been replaced - which reads as a pass, not as an omission.
const captureSrc = read('packages/extension/scripts/capture-listing-screenshots.mjs');
assert.ok(/writePin\(/.test(captureSrc),
    'capture-listing-screenshots.mjs no longer calls writePin(). A capture that does not re-pin '
    + 'leaves a stale note beside fresh images, and the note is the only thing that says which '
    + 'build the store listing shows.');
assert.equal(ASSETS.length, 4,
    `the listing-asset map names ${ASSETS.length} assets; the store listing takes four (three `
    + '1280x800 screenshots and the 440x280 promo tile). A map that shrank stops checking an '
    + 'asset that is still uploaded.');

// The README's Scripts table is the inventory, and it is derived rather than
// remembered: the person who forgets to add a row is the person who would have
// to remember to check for it. Measured 2026-08-06, the table described 16 of
// the 30 scripts here and looked complete, omitting verify-signatures.mjs,
// verify-release-key.sh and cws-upload.mjs. A tool absent from the inventory is
// invisible until somebody greps for it, mid-ceremony.
//
// Recursive because tools/release/drills/ holds the most side-effecting script
// in the tree, and a non-recursive walk would report a complete inventory
// without it.
const walkScripts = (relDir) => readdirSync(join(root, relDir), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory()
        ? walkScripts(`${relDir}/${entry.name}`)
        : (/\.(mjs|sh)$/.test(entry.name) ? [`${relDir}/${entry.name}`] : [])));
const releaseScriptFiles = walkScripts('tools/release').sort();
assert.ok(releaseScriptFiles.length >= 30,
    `only ${releaseScriptFiles.length} scripts found under tools/release/, fewer than the 30 there `
    + 'when this was measured. A scan that finds less than it should still prints a verdict.');

const readmeScripts = read('tools/release/README.md');
const undocumented = releaseScriptFiles.filter((rel) => {
    const name = rel.replace(/^tools\/release\//, '');
    // Nested scripts are named with their subdirectory, since that is how the
    // reader would type them.
    return !readmeScripts.includes(`\`${name}\``);
});
assert.deepEqual(undocumented, [],
    `tools/release/README.md's Scripts table does not name ${undocumented.length} script(s) that `
    + `exist in the directory: ${undocumented.join(', ')}. That table is the inventory an operator `
    + 'reads to find out what exists, and a tool missing from it is invisible until somebody greps. '
    + 'Add a row (Script | Purpose | Status), or delete the script.');

if (failures > 0) {
    console.error(`\n${failures} release-pipeline gate check(s) failed`);
    process.exit(1);
}

console.log('OK: tools/release/ signing pipeline smoke (§6 gates + signed round trip,'
    + `${ASSETS.length} listing assets pinned to ${pinned.pin.capturedFrom.commit.slice(0, 8)} `
    + `v${pinned.pin.capturedFrom.version})`);
