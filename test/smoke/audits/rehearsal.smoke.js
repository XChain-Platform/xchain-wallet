// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §7.5, stage 5: the staging rehearsal, RUN.
//
// It stands up a real staging feed - real artifacts, real pointers, a real
// GPG-signed manifest - and drives `rehearse.mjs` over it exactly as a
// release would, then drives every way the rehearsal is supposed to
// REFUSE. A rehearsal harness that only passes is worth nothing: the
// whole point of the stage is to fail a release, so each refusal is
// tested by breaking the feed in one specific way and checking the
// failure names that way and not something adjacent.
//
// TWO HONEST DEVIATIONS FROM A LIVE REHEARSAL, both stated rather than
// papered over:
//
//   TLS. `updateVerify.js` requires an https feed base, correctly. The
//   fixture serves plain HTTP on localhost and injects a fetch that maps
//   the https base onto it, so every layer above the socket is the real
//   one. The https REQUIREMENT itself is tested separately below, against
//   the unmapped function, because that requirement is load-bearing:
//   the production staging feed is currently served on :80 only.
//
//   The swap. Whether the downloaded artifact replaces the running app is
//   an OS-level fact that no test in this process can observe. That half
//   is the human attestation, and what is tested here is that the record
//   cannot claim it without one.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
    parseUpdateInfo,
    selectFileForArch,
    probeLane,
    assertRecord,
    swapRequirement,
    RECORD_VERSION,
} from '../../../tools/release/rehearse.mjs';
import { LANES } from '../../../tools/release/rehearsal-matrix.mjs';
import { pointerNameFor } from '../../../tools/release/update-info.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status !== 0) {
    process.stderr.write('rehearsal.smoke.js: SKIPPED - gpg is not installed\n');
    process.exit(0);
}

const TAG = 'v0.333.1';
const VERSION = '0.333.1';
const CHANNEL = 'staging';

const work = mkdtempSync(join(tmpdir(), 'xchain-rehearse-'));
const gnupg = join(work, 'gnupg');
mkdirSync(gnupg, { recursive: true, mode: 0o700 });
const gpgEnv = { ...process.env, GNUPGHOME: gnupg };

execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-generate-key',
    'XChain Rehearsal Smoke <smoke@example.invalid>', 'ed25519', 'sign', '0'], { env: gpgEnv });
const armoredKey = execFileSync('gpg', ['--armor', '--export'], { env: gpgEnv, encoding: 'utf8' });
const fingerprint = execFileSync('gpg', ['--list-keys', '--with-colons'],
    { env: gpgEnv, encoding: 'utf8' })
    .split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];
const pinned = { armoredKey, fingerprint };

// The artifact names electron-builder produces under the arch-carrying
// patterns in electron-builder.config.cjs. They are spelled out rather
// than generated so that a change to those patterns shows up HERE, in a
// test about update selection, which is what they exist for.
const ARTIFACTS = {
    [`xchain-wallet-setup-${VERSION}-x64.exe`]: 'win-x64-bytes',
    [`xchain-wallet-setup-${VERSION}-arm64.exe`]: 'win-arm64-bytes',
    [`xchain-wallet-${VERSION}-x64-mac.zip`]: 'mac-x64-bytes',
    [`xchain-wallet-${VERSION}-arm64-mac.zip`]: 'mac-arm64-bytes',
    [`xchain-wallet-${VERSION}.AppImage`]: 'linux-x64-bytes',
    [`xchain-wallet-${VERSION}-arm64.AppImage`]: 'linux-arm64-bytes',
    // The debs are lanes too ( §5, corrected 2026-08-02): DebUpdater
    // selects them out of these same two pointers and installs them with
    // `dpkg -i` under pkexec. The arch tokens are Debian's, not
    // electron-builder's - `amd64`, not `x64` - which is its own reason to
    // spell these names out here.
    [`xchain-wallet_${VERSION}_amd64.deb`]: 'linux-x64-deb-bytes',
    [`xchain-wallet_${VERSION}_arm64.deb`]: 'linux-arm64-deb-bytes',
};

function sha512b64(text) { return createHash('sha512').update(text).digest('base64'); }

// `lookup` is passed explicitly by cases that add files, so a mutation
// stays inside the feed it was made for. Sharing one mutable map across
// fixtures makes a later case pass or fail because of an earlier one.
function pointerBody(names, lookup = ARTIFACTS) {
    return [
        `version: ${VERSION}`,
        'files:',
        ...names.flatMap((n) => [
            `  - url: ${n}`,
            `    sha512: ${sha512b64(lookup[n])}`,
            `    size: ${Buffer.byteLength(lookup[n])}`,
        ]),
        `path: ${names[0]}`,
        `sha512: ${sha512b64(lookup[names[0]])}`,
        "releaseDate: '2026-07-31T00:00:00.000Z'",
        '',
    ].join('\n');
}

/**
 * Build a feed tree that mirrors the published layout.
 *
 * TWO HOOKS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE TRUST MODEL:
 *
 *   mutate   runs BEFORE the manifest is written and signed. This is a
 *            different BUILD - whatever it does is covered by K1's
 *            signature, because the maintainer really did produce it.
 *            Used for the cases that are our own mistakes.
 *
 *   tamper   runs AFTER signing, so it changes only what the feed SERVES.
 *            This is an attacker who owns the feed host or the CDN and
 *            cannot forge K1. Used for the cases where the pointer and
 *            the payload agree with each other and with nothing else.
 *
 * A fixture that ran both before signing would have the maintainer
 * signing the attacker's file, which is not a threat model, it is a
 * test that always passes.
 */
function makeFeed(name, { mutate = () => {}, tamper = () => {} } = {}) {
    const dir = join(work, name);
    const desktop = join(dir, 'desktop');
    const hashes = join(dir, 'RELEASE_HASHES');
    mkdirSync(desktop, { recursive: true });
    mkdirSync(hashes, { recursive: true });

    const files = { ...ARTIFACTS };
    const pointers = {
        [`${CHANNEL}.yml`]: pointerBody([
            `xchain-wallet-setup-${VERSION}-x64.exe`,
            `xchain-wallet-setup-${VERSION}-arm64.exe`,
        ]),
        [`${CHANNEL}-mac.yml`]: pointerBody([
            `xchain-wallet-${VERSION}-x64-mac.zip`,
            `xchain-wallet-${VERSION}-arm64-mac.zip`,
        ]),
        // Each Linux pointer carries BOTH formats, which is what a real
        // build emits (verified against a two-arch packaged build,
        // 2026-08-02): one pointer serves the AppImage lane and the deb
        // lane, and the two are told apart by extension, not by arch.
        [`${CHANNEL}-linux.yml`]: pointerBody([
            `xchain-wallet-${VERSION}.AppImage`,
            `xchain-wallet_${VERSION}_amd64.deb`,
        ]),
        [`${CHANNEL}-linux-arm64.yml`]: pointerBody([
            `xchain-wallet-${VERSION}-arm64.AppImage`,
            `xchain-wallet_${VERSION}_arm64.deb`,
        ]),
    };

    mutate({ files, pointers });

    // The manifest is written by lib.sh and signed by gpg, the same two
    // steps sign.sh runs. Hand-rolling it here would test this file's idea
    // of a manifest rather than the one the release path produces.
    const staged = join(work, `${name}-staged`);
    mkdirSync(staged, { recursive: true });
    for (const [n, body] of Object.entries(files)) writeFileSync(join(staged, n), body);
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `xr_write_manifest "${staged}" "${TAG}" "${'0'.repeat(40)}" `
        + '"2026-07-31T00:00:00Z" "enforced"'], { env: process.env });
    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign',
        join(staged, 'RELEASE_HASHES.txt')], { env: gpgEnv });

    writeFileSync(join(hashes, `${TAG}.txt`), readFileSync(join(staged, 'RELEASE_HASHES.txt')));
    writeFileSync(join(hashes, `${TAG}.txt.asc`), readFileSync(join(staged, 'RELEASE_HASHES.txt.asc')));

    // Post-signature. Whatever this changes, K1 never saw.
    tamper({ files, pointers });

    for (const [n, body] of Object.entries(files)) writeFileSync(join(desktop, n), body);
    for (const [n, body] of Object.entries(pointers)) writeFileSync(join(desktop, n), body);
    return { dir, staged };
}

// A single origin serving whichever feed a case points it at.
let serving = null;
const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    // Read BEFORE writing the head. `writeHead(200).end(readFileSync(...))`
    // evaluates the argument after the header is already on the wire, so a
    // missing file becomes ERR_HTTP_HEADERS_SENT instead of a 404 - and the
    // 404 path is one of the things under test.
    let body;
    try {
        body = readFileSync(join(serving, rel));
    } catch {
        res.writeHead(404).end('nope');
        return;
    }
    res.writeHead(200).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// https on the outside, http on the wire. Everything the rehearsal
// actually checks lives above this line.
const FEED = 'https://feed.invalid/wallet/';
const mappedFetch = (url, init) => fetch(
    String(url).replace(FEED, `http://127.0.0.1:${port}/`), init,
);

const probeAll = (feedDir, opts = {}) => {
    serving = feedDir;
    return Promise.all(LANES.map((lane) => probeLane({
        lane, feedBase: FEED, channel: CHANNEL, tag: TAG, fetch: mappedFetch, pinned, ...opts,
    })));
};

// ------------------------------------------------------- the happy path

const good = makeFeed('feed-good');
{
    const results = await probeAll(good.dir);
    assert.equal(results.length, 8, 'every shipped lane is probed (four OS/arch pairs, '
        + 'plus the two Linux deb lanes that share the AppImage pointers)');
    for (const r of results) {
        assert.ok(r.ok, `lane ${r.id} passes: ${r.failed} ${r.reason}`);
        assert.equal(r.checks.signedManifest, 'ok', `${r.id} checked the signed manifest`);
    }

    // Every lane resolved a DIFFERENT artifact, and each one carries its
    // own arch. This is the property that stops an x64 machine installing
    // an arm64 build; asserting only "it passed" would not notice two
    // lanes resolving to the same file.
    const selected = results.map((r) => r.selected);
    assert.equal(new Set(selected).size, 8, 'no two lanes resolve to the same artifact');
    for (const r of results) {
        const expected = r.arch === 'x64' && r.os === 'linux' ? null : r.arch;
        if (expected) {
            assert.ok(r.selected.includes(expected),
                `${r.id} resolved ${r.selected}, which does not carry ${expected}`);
        }
    }

    // The two multi-arch pointers must have resolved BY NAME. If either
    // fell back to list order it would still "work" today and break on
    // the first build that reordered its lanes.
    for (const id of ['win-x64', 'win-arm64', 'mac-x64', 'mac-arm64']) {
        const r = results.find((x) => x.id === id);
        assert.equal(r.checks.selection, 'by-arch', `${id} must resolve by name, not by order`);
        assert.equal(r.checks.candidates, 2, `${id} really did have a choice to get wrong`);
    }
    // ...and the Linux lanes legitimately have only one candidate EACH,
    // which is why the same fallback is allowed there. Note what that
    // means now that both formats share a pointer: the two candidates in
    // `stable-linux.yml` are told apart by EXTENSION before arch is ever
    // considered, so an AppImage install can never fall back onto the deb
    // (which would be a root-privileged install of the wrong artifact).
    for (const id of ['linux-x64-appimage', 'linux-arm64-appimage',
        'linux-x64-deb', 'linux-arm64-deb']) {
        assert.equal(results.find((x) => x.id === id).checks.candidates, 1,
            `${id} sees exactly the one artifact of its own format`);
    }
    for (const [id, ext] of [['linux-x64-appimage', '.AppImage'], ['linux-x64-deb', '.deb'],
        ['linux-arm64-appimage', '.AppImage'], ['linux-arm64-deb', '.deb']]) {
        assert.ok(results.find((x) => x.id === id).selected.endsWith(ext),
            `${id} resolved its own format`);
    }
}

// ------------------------------------------------ each refusal, one by one

{
    // The stage-1 class: a pointer nothing fetches. Renaming the arm64
    // Linux pointer strands exactly one lane and no other.
    const feed = makeFeed('feed-missing-pointer', { mutate: ({ pointers }) => {
        delete pointers[`${CHANNEL}-linux-arm64.yml`];
    } });
    const results = await probeAll(feed.dir);
    const bad = results.filter((r) => !r.ok);
    // Two lanes, not one: `stable-linux-arm64.yml` is the only pointer the
    // arm64 AppImage AND the arm64 deb have. Losing it strands both, and
    // nothing else.
    assert.deepEqual(bad.map((r) => r.id).sort(),
        ['linux-arm64-appimage', 'linux-arm64-deb'],
        'exactly the lanes that read the deleted pointer fail');
    assert.ok(bad.every((r) => r.failed === 'pointer'));
}

{
    // The DD4 class, and the one that motivates the arch-carrying names:
    // strip the arch from the Windows filenames and both Windows lanes
    // collapse onto whichever file is listed first.
    const feed = makeFeed('feed-unarched', {
        // A BUILD change, not an attack: this is what electron-builder
        // emits under its own defaults, which is exactly how the bug
        // would arrive.
        mutate: ({ files, pointers }) => {
            const plain = `xchain-wallet-setup-${VERSION}.exe`;
            const other = `xchain-wallet-setup-${VERSION}-other.exe`;
            files[plain] = files[`xchain-wallet-setup-${VERSION}-x64.exe`];
            files[other] = files[`xchain-wallet-setup-${VERSION}-arm64.exe`];
            pointers[`${CHANNEL}.yml`] = pointerBody([plain, other], files);
        },
    });
    const results = await probeAll(feed.dir);
    for (const id of ['win-x64', 'win-arm64']) {
        const r = results.find((x) => x.id === id);
        assert.ok(!r.ok, `${id} must refuse a name-blind selection`);
        assert.equal(r.failed, 'selection');
        assert.match(r.reason, /fell back to the first of 2/);
    }
    assert.ok(results.filter((r) => r.os !== 'win32').every((r) => r.ok),
        'and no other lane is affected');
}

{
    // A STRAY COMBINED INSTALLER ON THE FEED .
    //
    // The operator decided on 2026-08-01 to ship only the two per-arch
    // installers, and `nsis.buildUniversalInstaller: false` stops the
    // un-suffixed both-arch file being produced at all. The signing gate
    // refuses it if it ever returns.
    //
    // This case covers the window between those two: a feed that somehow
    // carries it anyway must not misroute anybody. It would be easy to
    // assume it does, because the generated yml's `path:` field names the
    // combined file - which reads, at a glance, as "every client gets the
    // 193M one". It does not: `getFileList` prefers `updateInfo.files` and
    // only falls back to `path` when `files` is absent, and `findFile`
    // then picks the first entry whose URL contains `process.arch`.
    //
    // Listed FIRST here on purpose: that is the position from which a
    // name-blind selection would hand it to everybody, so if selection
    // ever regresses to `first-listed`, this case fails.
    const feed = makeFeed('feed-stray-combined-installer', {
        mutate: ({ files, pointers }) => {
            const combined = `xchain-wallet-setup-${VERSION}.exe`;
            files[combined] = 'win-combined-both-arches-bytes';
            pointers[`${CHANNEL}.yml`] = pointerBody([
                combined,
                `xchain-wallet-setup-${VERSION}-x64.exe`,
                `xchain-wallet-setup-${VERSION}-arm64.exe`,
            ], files);
        },
    });
    const results = await probeAll(feed.dir);
    assert.ok(results.every((r) => r.ok),
        `every lane must still resolve with a stray combined installer present:\n${
            JSON.stringify(results.filter((r) => !r.ok), null, 2)}`);
    for (const [id, want] of [['win-x64', '-x64.exe'], ['win-arm64', '-arm64.exe']]) {
        const r = results.find((x) => x.id === id);
        assert.equal(r.checks.selection, 'by-arch',
            `${id} must select by arch, not fall back to the combined installer`);
        assert.ok(r.selected.endsWith(want),
            `${id} resolved to ${r.selected}, not its own installer`);
    }
}

{
    // The feed serves different bytes than the pointer claims.
    const feed = makeFeed('feed-swapped-bytes', {
        tamper: ({ files }) => {
            files[`xchain-wallet-${VERSION}-arm64-mac.zip`] = 'tampered';
        },
    });
    const results = await probeAll(feed.dir);
    const r = results.find((x) => x.id === 'mac-arm64');
    assert.equal(r.failed, 'sha512', `expected a hash failure, got ${r.failed}: ${r.reason}`);
}

{
    // A self-consistent lie: the pointer and the artifact agree, so the
    // sha512 check passes. Only the SIGNED manifest catches this, which
    // is the entire reason the S5 gate is in the loop.
    const feed = makeFeed('feed-consistent-lie', {
        tamper: ({ files, pointers }) => {
            const name = `xchain-wallet-${VERSION}.AppImage`;
            files[name] = 'attacker-payload';
            // Rewritten to match, so the feed is internally consistent.
            // The deb entry is left honest, so this case also shows the
            // refusal is per-ARTIFACT: swapping one format's bytes must
            // not fail, or pass, the other format sharing the pointer.
            pointers[`${CHANNEL}-linux.yml`] = pointerBody(
                [name, `xchain-wallet_${VERSION}_amd64.deb`], files,
            );
        },
    });
    const results = await probeAll(feed.dir);
    const r = results.find((x) => x.id === 'linux-x64-appimage');
    assert.ok(!r.ok, 'a payload the pointer vouches for must still be refused');
    assert.equal(r.failed, 'verify');
    assert.match(r.reason, /does not match the signed hash/);
    assert.ok(results.find((x) => x.id === 'linux-x64-deb').ok,
        'the untouched deb sharing that pointer still passes');
}

{
    // The manifest is signed, but by the wrong key.
    const results = await probeAll(good.dir, { pinned: { armoredKey, fingerprint: 'A'.repeat(40) } });
    assert.ok(results.every((r) => r.failed === 'verify'), 'a wrong pinned fingerprint fails every lane');
}

{
    // The rehearsal is for a different version than the feed carries.
    serving = good.dir;
    const r = await probeLane({
        lane: LANES[0], feedBase: FEED, channel: CHANNEL, tag: 'v9.9.9', fetch: mappedFetch, pinned,
    });
    assert.equal(r.failed, 'version');
}

{
    // The https requirement, against the UNMAPPED function. Worth its own
    // case: the staging feed on origin-host is served on :80 today, so this
    // is the error a first live rehearsal will actually hit.
    serving = good.dir;
    const r = await probeLane({
        lane: LANES[0],
        feedBase: `http://127.0.0.1:${port}/`,
        channel: CHANNEL,
        tag: TAG,
        pinned,
    });
    assert.equal(r.failed, 'manifest');
    assert.match(r.reason, /must be https/);
}

// --------------------------------------------------------- the yml parser

{
    assert.throws(() => parseUpdateInfo(''), /empty/);
    assert.throws(() => parseUpdateInfo('version: 1.0.0\n'), /lists no files/);
    assert.throws(
        () => parseUpdateInfo('version: 1.0.0\nfiles:\n  - url: a.exe\n    size: 1\n'),
        /no sha512/,
        'a file entry with no hash is refused rather than treated as unchecked',
    );

    const parsed = parseUpdateInfo(pointerBody([
        `xchain-wallet-setup-${VERSION}-x64.exe`,
        `xchain-wallet-setup-${VERSION}-arm64.exe`,
    ]));
    assert.equal(parsed.version, VERSION);
    assert.equal(parsed.files.length, 2, 'both arches parsed out of one pointer');
    assert.equal(parsed.files[1].size, Buffer.byteLength('win-arm64-bytes'));
}

{
    // Pinned against upstream's rule, not ours: `x64` is not a substring
    // of `arm64`, which is the only reason substring matching works at all
    // here. If that ever stopped holding, selection would silently invert.
    assert.ok(!'arm64'.includes('x64'));
    const files = [{ url: 'app-arm64.exe' }, { url: 'app-x64.exe' }];
    assert.equal(selectFileForArch(files, 'x64', 'exe').file.url, 'app-x64.exe');
    assert.equal(selectFileForArch(files, 'arm64', 'exe').file.url, 'app-arm64.exe');
    assert.equal(selectFileForArch(files, 'ia32', 'exe').selection, 'first-listed');
    assert.equal(selectFileForArch(files, 'x64', 'dmg').selection, 'none');
}

// -------------------------------------------------------- pointer naming

{
    assert.equal(pointerNameFor({ channel: 'stable', os: 'win32' }), 'stable.yml');
    assert.equal(pointerNameFor({ channel: 'stable', os: 'darwin' }), 'stable-mac.yml');
    assert.equal(pointerNameFor({ channel: 'stable', os: 'linux', arch: 'x64' }), 'stable-linux.yml');
    assert.equal(pointerNameFor({ channel: 'stable', os: 'linux', arch: 'arm64' }),
        'stable-linux-arm64.yml');
    // Upstream special-cases armv7l to `-arm`. If the DD1 lane is ever
    // taken up, getting this wrong strands it silently.
    assert.equal(pointerNameFor({ channel: 'stable', os: 'linux', arch: 'armv7l' }),
        'stable-linux-arm.yml');
    assert.equal(pointerNameFor({ channel: 'staging', os: 'darwin' }), 'staging-mac.yml');
}

// ----------------------------------------------------------- the record

const MANIFEST_SHA = 'a'.repeat(64);
const baseRecord = {
    'record-version': RECORD_VERSION,
    tag: TAG,
    'prod-manifest-sha256': MANIFEST_SHA,
    'swap-requirement': 'one-os',
    'requirement-reason': 'test',
    'pinned-key-override': null,
    lanes: LANES.map((l) => ({ id: l.id, ok: true })),
    swaps: [{ lane: 'mac-arm64', device: 'Mac Studio', from: '0.333.0' }],
};
const check = (over) => assertRecord({
    record: { ...baseRecord, ...over }, tag: TAG, prodManifestSha256: MANIFEST_SHA,
});

{
    assert.ok(check({}).ok, 'a complete record passes');

    assert.match(check({ tag: 'v0.1.0' }).problems.join(' '), /record is for v0\.1\.0/);

    // The binding that makes a record unreusable across a re-cut.
    const recut = assertRecord({ record: baseRecord, tag: TAG, prodManifestSha256: 'b'.repeat(64) });
    assert.ok(!recut.ok);
    assert.match(recut.problems.join(' '), /different production manifest/);

    assert.match(check({ swaps: [] }).problems.join(' '), /no observed swap on any OS/,
        'feed-side probes alone are not a rehearsal');

    // One OS is not enough when the release touches the updater.
    const strict = check({ 'swap-requirement': 'all-os' });
    assert.ok(!strict.ok);
    assert.match(strict.problems.join(' '), /win32 has none/);
    assert.match(strict.problems.join(' '), /linux has none/);
    assert.ok(!strict.problems.join(' ').includes('darwin has none'),
        'and the OS that WAS swapped is not complained about');

    assert.match(check({ lanes: baseRecord.lanes.slice(1) }).problems.join(' '), /no result for lane/);
    assert.match(
        check({ lanes: [{ id: 'win-x64', ok: false, failed: 'pointer', reason: '404' }] })
            .problems.join(' '),
        /lane win-x64 failed at pointer/,
    );
    assert.match(check({ 'pinned-key-override': { fingerprint: 'x' } }).problems.join(' '),
        /pinned-key override/,
        'a rehearsal against a key the app does not ship proves nothing about trust');

    // Bootstrap: the first release has nothing to update FROM, so it
    // needs no swap - but it has to say so in the record.
    assert.ok(check({ 'swap-requirement': 'bootstrap', swaps: [] }).ok);
    assert.ok(!check({ 'swap-requirement': 'whatever', swaps: [] }).ok);
}

// ------------------------------------------------------ the requirement

{
    const fakeRun = (files) => () => files.join('\n');

    assert.equal(swapRequirement({ repo: '.', tag: TAG, previousTag: null }).requirement,
        'bootstrap');
    assert.equal(
        swapRequirement({
            repo: '.', tag: TAG, previousTag: 'v0.333.0',
            run: fakeRun(['packages/web/src/App.jsx', 'CONTRIBUTING.md']),
        }).requirement,
        'one-os',
    );
    assert.equal(
        swapRequirement({
            repo: '.', tag: TAG, previousTag: 'v0.333.0',
            run: fakeRun(['packages/desktop/main/updater.js']),
        }).requirement,
        'all-os',
        'an updater change must be rehearsed on every OS',
    );
    assert.equal(
        swapRequirement({
            repo: '.', tag: TAG, previousTag: 'v0.333.0',
            run: fakeRun(['packages/core/src/storage/backend.js']),
        }).requirement,
        'all-os',
        'a storage change too: a bad swap there loses vaults, not pixels',
    );
    // Cannot tell must mean the strict answer, never the cheap one.
    assert.equal(
        swapRequirement({
            repo: '.',
            tag: TAG,
            previousTag: 'v0.333.0',
            run: () => { throw new Error('not a git repo'); },
        }).requirement,
        'all-os',
    );
}

// ------------------------------------------- the CLI, against a real repo

{
    // This section exists because the bug it pins was found by RUNNING the
    // command, not by reading it. `bootstrap` waives the swap requirement
    // outright, and the tag resolver returned it for every reason it could
    // not find a predecessor - including "the tag has not been created
    // yet", which is the state a release is in right up until §6 step 2.
    // Waiving a safety requirement because a lookup came back empty is the
    // failure mode the whole file is about, and the unit-level exports
    // could not have caught it: it lives in the CLI's own wiring.
    const repo = join(work, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'smoke@example.invalid');
    git('config', 'user.name', 'smoke');
    writeFileSync(join(repo, 'a'), 'x');
    git('add', 'a');
    git('commit', '-qm', 'one');
    // `-c tag.gpgsign=false` explicitly: with the global setting on (see
    // ) a bare `git tag NAME` needs a message, fails, and creates
    // NOTHING - which would leave this repo tagless and every case below
    // reading as `bootstrap`, i.e. green for the wrong reason. A test must
    // not inherit ambient git config.
    git('-c', 'tag.gpgsign=false', 'tag', 'v0.1.0');
    git('-c', 'tag.gpgsign=false', 'tag', 'v0.2.0');

    const cli = (...args) => spawnSync(
        process.execPath, [join(root, 'tools/release/rehearse.mjs'), ...args],
        { encoding: 'utf8' },
    );

    const oldest = cli('requirement', '--repo', repo, '--tag', 'v0.1.0');
    assert.equal(oldest.status, 0);
    assert.match(oldest.stdout, /^bootstrap/, 'the genuinely-first release is bootstrap');

    const normal = cli('requirement', '--repo', repo, '--tag', 'v0.2.0');
    assert.equal(normal.status, 0);
    assert.match(normal.stdout, /^one-os/, 'a release with a predecessor needs a real swap');

    const unknown = cli('requirement', '--repo', repo, '--tag', 'v9.9.9');
    assert.equal(unknown.status, 1, 'an untagged release must not resolve to bootstrap');
    assert.match(unknown.stderr, /is not a tag in/);
    // `\s+` because the message wraps: the reason spans a line break.
    assert.match(unknown.stderr, /waive the\s+swap requirement/);

    // And `assert` refuses a missing record with a non-zero status, which
    // is the only reason publish.sh stops.
    const missing = cli('assert', '--record', join(work, 'nope.json'),
        '--tag', TAG, '--prod-input', repo);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no rehearsal record/);

    const coverage = cli('coverage', '--records', join(work, 'no-records'));
    assert.equal(coverage.status, 1, 'no lane has been swapped, so coverage fails');
    assert.match(coverage.stdout, /NO DEVICE NAMED \(DD4\)/);
    assert.match(coverage.stdout, /mac-arm64\s+device Mac Studio/,
        'the one lane with hardware is reported as hardware-ready but unrehearsed');
}

server.close();
rmSync(work, { recursive: true, force: true });
process.stdout.write('rehearsal.smoke.js: ok\n');
