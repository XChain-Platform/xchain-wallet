// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §7.3: publish.sh, RUN rather than read.
//
// The existing coverage of this script was a set of greps over its source,
// which is how the stage-1 defect survived review: the text said "channel
// pointers last" and the code globbed for a filename that never existed,
// and both statements were true at once. So this drives the real script
// against a real signed release, a real target tree, and a real HTTP
// origin standing in for the edge.
//
// It builds a throwaway GPG key to do it. That is not ceremony: publish.sh
// verifies the signature before it uploads anything, so a fixture without
// one could only ever test the argument parser.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync }
    from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { LANES } from '../../../tools/release/rehearsal-matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const publish = join(root, 'tools', 'release', 'publish.sh');

if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status !== 0) {
    // Said loudly, and to stderr. A skip that prints nothing is
    // indistinguishable from a pass, which is the exact failure class the
    // rest of this file exists to catch.
    process.stderr.write('publish-feed.smoke.js: SKIPPED - gpg is not installed\n');
    process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'xchain-publish-'));
const gnupg = join(work, 'gnupg');
mkdirSync(gnupg, { recursive: true, mode: 0o700 });

execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-generate-key',
    'XChain Publish Smoke <smoke@example.invalid>', 'ed25519', 'sign', '0'],
{ env: { ...process.env, GNUPGHOME: gnupg } });

const TAG = 'v0.333.1';
const ARTIFACTS = {
    'XChain Wallet-0.333.1.AppImage': 'appimage-bytes-x64',
    'XChain Wallet-0.333.1-arm64.AppImage': 'appimage-bytes-arm64',
};

function sha512b64(text) { return createHash('sha512').update(text).digest('base64'); }

/** A signed release directory whose pointers belong to `channel`. */
function makeRelease(name, channel) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, body] of Object.entries(ARTIFACTS)) writeFileSync(join(dir, file), body);

    const entries = Object.entries(ARTIFACTS);
    const yml = [
        'version: 0.333.1',
        'files:',
        ...entries.flatMap(([file, body]) => [
            `  - url: ${file}`,
            `    sha512: ${sha512b64(body)}`,
            `    size: ${Buffer.byteLength(body)}`,
        ]),
        `path: ${entries[0][0]}`,
        `sha512: ${sha512b64(entries[0][1])}`,
        "releaseDate: '2026-07-31T00:00:00.000Z'",
        '',
    ].join('\n');
    writeFileSync(join(dir, `${channel}-linux.yml`), yml);

    // Written through lib.sh, not hand-rolled, so the fixture is the same
    // shape sign.sh produces - including the artifact/pointer split, which
    // is the thing under test, and the build-profile lines verify.sh now
    // requires . The expected-artifacts list is passed for the same
    // reason sign.sh passes it: without it the manifest claims to be
    // version 2 and omits the one thing version 2 exists for.
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `xr_write_manifest "${dir}" "${TAG}" "${'0'.repeat(40)}" `
        + `"2026-07-31T00:00:00Z" "enforced" "${join(root, 'tools/release/expected-artifacts.txt')}"`],
    { env: process.env });

    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign',
        join(dir, 'RELEASE_HASHES.txt')], { env: { ...process.env, GNUPGHOME: gnupg } });
    return dir;
}

/** A feed root. `staging: true` plants the .staging-feed marker. */
function makeTarget(name, { staging = false } = {}) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    if (staging) writeFileSync(join(dir, '.staging-feed'), 'rehearsal feed, never public\n');
    return dir;
}

/**
 * Run publish.sh and collect everything it said.
 *
 * ASYNC, and that is not a style choice. The edge cases below stand a real
 * HTTP server up in THIS process; `spawnSync` would block the event loop
 * for the whole run, so the server could never accept the connection
 * publish.sh is waiting on, and the test would deadlock until curl's
 * timeout and then report the edge check as broken. It was written
 * synchronously first and did exactly that.
 */
function run(args, env = {}) {
    return new Promise((resolve) => {
        const child = spawn('bash', [publish, ...args], {
            env: { ...process.env, GNUPGHOME: gnupg, ...env },
        });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        child.on('close', (status) => resolve({ status, out }));
    });
}

const prodRelease = makeRelease('release-prod', 'stable');
const stagingRelease = makeRelease('release-staging', 'staging');

/**
 * A passing §7.5 rehearsal record for a signed release directory.
 *
 * Written by hand rather than produced by `rehearse.mjs run`, which would
 * need a whole staging feed stood up. What is under test here is that
 * publish.sh CONSULTS the record and refuses without a valid one; that
 * the record's own contents mean what they say is tested where it is
 * generated, in rehearsal.smoke.js.
 *
 * The default path is the one publish.sh looks in when no --rehearsal is
 * given, so the happy path exercises the no-flag case a release actually
 * uses.
 */
function writeRehearsalRecord(releaseDir, { manifestFrom = releaseDir, ...over } = {}) {
    const path = join(work, `REHEARSAL-${TAG}.json`);
    writeFileSync(path, `${JSON.stringify({
        'record-version': 1,
        tag: TAG,
        'prod-manifest-sha256': createHash('sha256')
            .update(readFileSync(join(manifestFrom, 'RELEASE_HASHES.txt'))).digest('hex'),
        'swap-requirement': 'one-os',
        'requirement-reason': 'smoke fixture',
        'pinned-key-override': null,
        lanes: LANES.map((l) => ({ id: l.id, ok: true })),
        swaps: [{ lane: 'mac-arm64', device: 'Mac Studio', from: '0.333.0' }],
        ...over,
    }, null, 2)}\n`);
    return path;
}

// --------------------------------------------- the rehearsal gate (§7.5)

{
    // No record at all. This is the default state of any release nobody
    // rehearsed, so it is the case that has to fail.
    const target = makeTarget('feed-no-rehearsal');
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 1, 'a prod publish with no rehearsal record is refused');
    assert.match(r.out, /no rehearsal record/);
    assert.equal(existsSync(join(target, 'desktop')), false, 'and nothing was uploaded');
}

{
    // A record for a DIFFERENT set of signed bytes: the re-cut case, where
    // the tag is right and the release is not the one that was rehearsed.
    //
    // The hash is overridden outright rather than taken from the staging
    // release, which was the first attempt and did not fail: the two
    // fixtures hold the same artifact bytes under the same tag and commit,
    // and pointers are excluded from the manifest, so their manifests came
    // out BYTE-IDENTICAL. Real staging artifacts differ from prod ones (a
    // different feed is baked in), so that collision is a property of this
    // fixture and not of a release - but it is why the case now states the
    // difference instead of assuming one.
    const target = makeTarget('feed-stale-rehearsal');
    writeRehearsalRecord(prodRelease, { 'prod-manifest-sha256': 'b'.repeat(64) });
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 1, 'a record bound to other bytes is refused');
    assert.match(r.out, /different production manifest/);
    assert.equal(existsSync(join(target, 'desktop')), false);
}

{
    // A rehearsal that never showed a swap on any OS.
    const target = makeTarget('feed-no-swap');
    writeRehearsalRecord(prodRelease, { swaps: [] });
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 1, 'feed-side probes alone do not satisfy the gate');
    assert.match(r.out, /no observed swap/);
}

// Good from here on, so the rest of the file tests what it was written to.
writeRehearsalRecord(prodRelease);

// -------------------------------------------------- the happy prod path

{
    const target = makeTarget('feed-prod');
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 0, `a clean prod publish succeeds:\n${r.out}`);

    for (const file of Object.keys(ARTIFACTS)) {
        assert.ok(existsSync(join(target, 'desktop', file)), `${file} landed`);
    }
    assert.ok(existsSync(join(target, 'desktop', 'stable-linux.yml')), 'the pointer landed');
    assert.ok(existsSync(join(target, 'RELEASE_HASHES', `${TAG}.txt`)),
        'the manifest landed under its versioned name');
    assert.ok(existsSync(join(target, 'RELEASE_HASHES', `${TAG}.txt.asc`)), 'and its signature');

    // The ordering guarantee, read off the transcript rather than assumed.
    const pointerAt = r.out.indexOf('stable-linux.yml (channel pointer, last)');
    const lastArtifactAt = Math.max(
        ...Object.keys(ARTIFACTS).map((f) => r.out.indexOf(`uploading ${f}`)));
    assert.ok(pointerAt > lastArtifactAt && lastArtifactAt > -1,
        'every artifact is uploaded before the pointer that names it');

    // Immutability, on a second run against the same tree.
    const again = await run(['--input', prodRelease, '--tag', TAG, '--target', target]);
    assert.equal(again.status, 1, 'republishing a live tag is refused');
    assert.match(again.out, /already published/);
}

// ------------------------------------ prod and rehearsal cannot be mixed

{
    // The dangerous one: a rehearsal build aimed at the live feed. Its
    // installers are named IDENTICALLY to the real ones, so nothing in a
    // file listing would have shown it.
    const target = makeTarget('feed-prod-2');
    const r = await run(['--input', stagingRelease, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 1, 'a staging build is refused by a prod publish');
    assert.match(r.out, /expected only "stable"/,
        'and the reason names the channel, not a vague mismatch');
    assert.equal(existsSync(join(target, 'desktop')), false,
        'nothing at all was uploaded: the check runs before the first copy');
}

{
    const target = makeTarget('feed-prod-3');
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target, '--staging']);
    assert.equal(r.status, 1, '--staging with a prod build is refused');
    assert.match(r.out, /expected only "staging"/);
}

{
    // Right build, right flag, wrong feed. Caught by the DESTINATION,
    // which is the half that still works when the input is what it claims.
    const target = makeTarget('feed-prod-4');
    const r = await run(['--input', stagingRelease, '--tag', TAG, '--target', target, '--staging']);
    assert.equal(r.status, 1, 'a staging publish into an unmarked feed is refused');
    assert.match(r.out, /no \.staging-feed marker/);
}

{
    const target = makeTarget('feed-staging-2', { staging: true });
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target, '--no-edge-verify']);
    assert.equal(r.status, 1, 'a prod publish into the staging feed is refused');
    assert.match(r.out, /is the STAGING feed/);
}

{
    const target = makeTarget('feed-staging', { staging: true });
    const r = await run(['--input', stagingRelease, '--tag', TAG, '--target', target, '--staging']);
    assert.equal(r.status, 0, `the rehearsal publish succeeds:\n${r.out}`);
    assert.ok(existsSync(join(target, 'desktop', 'staging-linux.yml')),
        'the staging pointer landed');
    assert.ok(existsSync(join(target, 'RELEASE_HASHES', `${TAG}.txt`)),
        'the staging feed carries its OWN signed manifest (§7.5: K1 signs the staging set too, '
        + 'so the rehearsal proves the key that actually matters)');
}

// ------------------------------------------------- a mixed directory

{
    const dir = makeRelease('release-mixed', 'stable');
    writeFileSync(join(dir, 'staging-linux.yml'), readFileSync(join(dir, 'stable-linux.yml')));
    const target = makeTarget('feed-mixed');
    const r = await run(['--input', dir, '--tag', TAG, '--target', target]);
    assert.equal(r.status, 1, 'one directory holding both channels is refused');
    assert.match(r.out, /\[stable, staging\]/, 'and both channels are named in the error');
}

// ----------------------------------------------- the edge-check contract

{
    // A remote target without --public-base must fail on its ARGUMENTS,
    // before anything opens an SSH connection to a host this test does
    // not have.
    const r = await run(['--input', prodRelease, '--tag', TAG,
        '--target', 'deploy@origin-host.example.invalid:/srv/downloads/wallet']);
    assert.equal(r.status, 2, 'a remote publish demands --public-base');
    assert.match(r.out, /--public-base is required/);
    assert.doesNotMatch(r.out, /verifying the signed release/,
        'and it says so before spending a full manifest verify on it');
}

// --------------------------- the edge check, against a real HTTP origin

/**
 * Serve a directory over HTTP, optionally lying about one file the way a
 * cache does: a stale 404 for something that already exists, or a stale
 * copy of a different length.
 */
function serve(dir, { missing = null, wrongLength = null } = {}) {
    const server = createServer((req, res) => {
        // Decoded, because publish.sh percent-encodes: every desktop
        // artifact name contains a space.
        const name = decodeURIComponent(req.url.replace(/^\/+/, ''));
        if (missing !== null && name.endsWith(missing)) { res.writeHead(404); res.end(); return; }
        const file = join(dir, name);
        if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
        const size = wrongLength !== null && name.endsWith(wrongLength)
            ? statSync(file).size + 4096
            : statSync(file).size;
        res.writeHead(200, { 'content-length': String(size) });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(readFileSync(file));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server, base: `http://127.0.0.1:${server.address().port}`,
        }));
    });
}

{
    const target = makeTarget('feed-edge-ok');
    const { server, base } = await serve(target);
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target,
        '--public-base', base]);
    server.close();
    assert.equal(r.status, 0, `a serving edge lets the release through:\n${r.out}`);
    assert.match(r.out, /edge ok/);
    assert.ok(existsSync(join(target, 'desktop', 'stable-linux.yml')), 'and the pointer went up');
}

{
    // The §7.3 failure: the artifact is at the origin, the edge still
    // says 404. The release must stop with the binaries uploaded and NO
    // pointer, because that state is invisible to every client.
    const target = makeTarget('feed-edge-404');
    const { server, base } = await serve(target, { missing: '-arm64.AppImage' });
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target,
        '--public-base', base]);
    server.close();

    assert.equal(r.status, 1, 'a 404 through the edge stops the publish');
    assert.match(r.out, /EDGE-FAIL.*arm64\.AppImage: HTTP 404/);
    assert.ok(existsSync(join(target, 'desktop', 'XChain Wallet-0.333.1.AppImage')),
        'the artifacts stay uploaded - phase 1 is idempotent and re-running is the fix');
    assert.equal(existsSync(join(target, 'desktop', 'stable-linux.yml')), false,
        'but NO pointer was written, so no client is looking for the missing file');
}

{
    // A 200 is not enough on its own: an edge holding a same-named
    // artifact from a previous build of this version answers 200 with the
    // WRONG bytes, which is exactly what a re-cut release produces.
    const target = makeTarget('feed-edge-stale');
    const { server, base } = await serve(target, { wrongLength: '-arm64.AppImage' });
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target,
        '--public-base', base]);
    server.close();

    assert.equal(r.status, 1, 'a stale same-named copy at the edge stops the publish');
    assert.match(r.out, /EDGE-FAIL.*edge serves \d+ bytes, we uploaded \d+/);
    assert.equal(existsSync(join(target, 'desktop', 'stable-linux.yml')), false,
        'again, no pointer');
}

// -------------------------------------------------------- the purge step

{
    const target = makeTarget('feed-purge');
    const { server, base } = await serve(target);
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target,
        '--public-base', base]);
    server.close();
    assert.match(r.out, /NOT purging/,
        'with no Cloudflare credentials the publish still succeeds but says the cache '
        + 'was not purged');
    assert.match(r.out, new RegExp(`${base}/desktop/stable-linux\\.yml`),
        'and prints the exact paths to purge by hand');
}

{
    // The credential must never reach the process table, where any local
    // user can read it out of `ps` for the life of the call.
    const src = readFileSync(publish, 'utf8');
    assert.match(src, /--config -/,
        'the purge feeds curl its Authorization header on stdin');
    assert.doesNotMatch(src, /-H\s+["']Authorization: Bearer \$/,
        'and never as a command-line argument');
}

rmSync(work, { recursive: true, force: true });
console.log('publish-feed.smoke.js: ok');
