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

/* publish.sh runs verify.sh, and verify.sh binds a signature to an
 * expected fingerprint since  S37 rather than accepting any good
 * one. Left unset it would resolve the repo's own pin, which is K1 - the
 * real release key, which this throwaway key is emphatically not - and
 * every publish here would fail on a wrong-key refusal that has nothing
 * to do with what the file is testing. */
const SMOKE_FPR = execFileSync('gpg', ['--list-keys', '--with-colons', 'smoke@example.invalid'],
    { env: { ...process.env, GNUPGHOME: gnupg }, encoding: 'utf8' })
    .split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];

const TAG = 'v0.333.1';
const ARTIFACTS = {
    'xchain-wallet-0.333.1-x86_64.AppImage': 'appimage-bytes-x64',
    'xchain-wallet-0.333.1-arm64.AppImage': 'appimage-bytes-arm64',
};

function sha512b64(text) { return createHash('sha512').update(text).digest('base64'); }

/** A signed release directory whose pointers belong to `channel`. */
function makeRelease(name, channel, extra = {}) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    const all = { ...ARTIFACTS, ...extra };
    for (const [file, body] of Object.entries(all)) writeFileSync(join(dir, file), body);

    // The channel pointer stays a DESKTOP concern: `extra` exists for artifacts
    // that ship beside the desktop ones without an electron-updater feed, which
    // is exactly what the Android pair is.
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
 * A §6 release records directory holding an instantiated record for TAG.
 *
 * Every case below except the one testing the record gate itself runs
 * with this pointed at by `XCHAIN_WALLET_RELEASE_RECORDS`. Without it
 * every prod case would stop at the  gate, which is correct
 * behaviour and useless coverage: the point of those cases is what
 * happens AFTER the preconditions are satisfied.
 *
 * The default (unset) location is the platform repo above this checkout,
 * which holds real releases and must not gain a fixture for v0.333.1.
 */
function makeRecords(name, { withRecord = true } = {}) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'TEMPLATE.md'),
        '# XChain Wallet release record - vX.Y.Z\n\n**Version:** X.Y.Z\n**Tag:** vX.Y.Z\n');
    if (withRecord) {
        writeFileSync(join(dir, `${TAG}.md`),
            `# XChain Wallet release record - ${TAG}\n\n`
            + `**Version:** ${TAG.slice(1)}  \n**Tag:** ${TAG}  \n**Opened:** 2026-08-04  \n`);
    }
    return dir;
}

const RECORDS = makeRecords('release-records');

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
            env: {
                ...process.env,
                GNUPGHOME: gnupg,
                XCHAIN_VERIFY_KEY: SMOKE_FPR,
                XCHAIN_WALLET_RELEASE_RECORDS: RECORDS,
                ...env,
            },
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

// ------------------------------------------ the §6 record gate 
//
// §6's release record was a convention with nothing enforcing it, so the
// first release was tagged and built with no record open and its only
// account for a day was GitHub's run history. It is now a precondition of
// a production publish, in the same shape and for the same reason as the
// rehearsal record one gate below.

{
    // No record for this tag. This is the state of any release nobody
    // opened a record for, so it is the case that has to fail - and it
    // has to fail BEFORE the rehearsal gate, which is the more expensive
    // of the two.
    // No rehearsal record is written here either, deliberately: the point
    // is that the CHEAPER gate is the one that speaks, and the next
    // section needs the default rehearsal path still empty.
    const target = makeTarget('feed-no-record');
    const r = await run(['--input', prodRelease, '--tag', TAG, '--target', target],
        { XCHAIN_WALLET_RELEASE_RECORDS: makeRecords('records-empty', { withRecord: false }) });
    assert.equal(r.status, 1, 'a prod publish with no §6 release record is refused');
    assert.match(r.out, /no release record at/);
    assert.match(r.out, /release-record\.mjs open --tag/,
        'and says how to open one rather than only that it is missing');
    assert.equal(existsSync(join(target, 'desktop')), false, 'and nothing was uploaded');
}

{
    // A staging publish is step ONE of the rehearsal, run while the
    // record is still being filled in, so the gate must not fire on it.
    // Proven by the absence of the record error, not by a green publish:
    // this fixture has no record at all and the staging publish gets past
    // the point where a prod publish would have stopped.
    const target = makeTarget('feed-staging-no-record', { staging: true });
    const r = await run(['--input', stagingRelease, '--tag', TAG, '--target', target,
        '--no-edge-verify', '--dry-run'],
    { XCHAIN_WALLET_RELEASE_RECORDS: makeRecords('records-empty-staging', { withRecord: false }) });
    assert.doesNotMatch(r.out, /no release record at/,
        'a --staging publish is not refused for want of a §6 record');
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
    assert.ok(existsSync(join(target, 'desktop', 'xchain-wallet-0.333.1-x86_64.AppImage')),
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

// ------------------------------------------- the Android pair ( §6/§7)
//
// Two artifacts, two different rules, and the routing used to get both wrong
// because it ended in a catch-all that meant "desktop".
//
// The APK belongs under wallet/android/: that is what §6 step 6 says, what the
// download page links, and what the published K10 fingerprint is meant to
// verify. Filed under desktop/ it would still have "published" cleanly, and the
// edge check would have agreed, because the check derives its URL exactly the
// way the upload did. Self-consistent and wrong.
//
// The AAB must not be published AT ALL. It is signed, it is hashed into
// RELEASE_HASHES, expected-artifacts.txt says "NEVER hosted" in as many words,
// and it is the bundle Play re-signs before serving, so a public copy is a file
// nobody can install and nobody can check against anything Google handed them.
{
    const androidRelease = makeRelease('release-android', 'stable', {
        'xchain-wallet-v0.333.1.apk': 'apk-bytes',
        'xchain-wallet-android-v0.333.1.aab': 'aab-bytes',
    });
    writeRehearsalRecord(androidRelease, { manifestFrom: androidRelease });
    const target = makeTarget('feed-android');
    const r = await run(['--input', androidRelease, '--tag', TAG, '--target', target,
        '--no-edge-verify']);

    assert.equal(r.status, 0, `the Android pair publishes cleanly:\n${r.out}`);
    assert.ok(existsSync(join(target, 'android', 'xchain-wallet-v0.333.1.apk')),
        'the APK lands in android/, which is where §6 and the download page both point');
    assert.equal(existsSync(join(target, 'desktop', 'xchain-wallet-v0.333.1.apk')), false,
        'and NOT in desktop/, where the old catch-all put it');

    for (const sub of ['android', 'desktop', 'extension', 'web']) {
        assert.equal(existsSync(join(target, sub, 'xchain-wallet-android-v0.333.1.aab')), false,
            `the store-bound .aab must not be published, and it is not in ${sub}/`);
    }
    assert.match(r.out, /NOT uploading xchain-wallet-android-v0\.333\.1\.aab/,
        'and it says so by name: a silent skip creates the "where did my artifact go" question');

    // The plan is read BEFORE the upload, and it used to promise a count the
    // upload could not keep: the manifest's artifact count, printed whole,
    // while Phase 1 refuses every .aab in it. An operator who reads
    // "2 artifact(s)" and finds one file on the feed has to work out which
    // half of their own tooling lied. It now splits the count in the same
    // terms Phase 1 refuses them.
    assert.match(r.out, /\d+ artifact\(s\): \d+ uploaded, 1 store-bound \(\.aab, never hosted\)/,
        'the plan counts what actually lands, not what the manifest lists');

    // The desktop lane is untouched by the new cases.
    assert.ok(existsSync(join(target, 'desktop', 'xchain-wallet-0.333.1-x86_64.AppImage')),
        'desktop artifacts still route to desktop/');

    // The rehearsal record lives at ONE path shared by every block in this
    // file, so pointing it at the Android release leaves it pointing at the
    // wrong manifest for everything below. Put it back.
    writeRehearsalRecord(prodRelease);
}

// ------------------------------ a PARTIAL release, no channel pointers 
//
// The block above publishes the Android pair ALONGSIDE a full desktop release,
// which is the case that existed when it was written. It is not the case that
// arrived: with Play frozen the Android lane is signed on its own, by
// `sign.sh --lane android`, and such a directory holds two artifacts, a signed
// manifest, and NO channel pointer at all - electron-updater's feed is a
// desktop concern and no store lane has ever produced one.
//
// publish.sh asserted the input was a `stable` build by reading those pointers,
// and with none present it refused: "With none, this assertion has nothing to
// check and would pass an empty or wrong directory straight through to the
// feed." Correct as far as it went, and it made the direct lane unpublishable
// for exactly the reason sign.sh had been unable to sign it - the same defect,
// one step downstream, found by running the real script rather than reading it.
//
// THE ANSWER IS NOT A FLAG. The manifest publish.sh already requires carries
// the coverage in its SIGNED bytes (`# coverage: partial`, `# lanes: android`),
// so the release says what it is and argv does not get a vote. What that
// replaces the pointer check with is strictly stronger for these lanes: a
// pointer is an unsigned file in the directory, and this is inside the
// signature.
{
    const partial = join(work, 'release-partial');
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, 'xchain-wallet-v0.333.1.apk'), 'apk-bytes');
    writeFileSync(join(partial, 'xchain-wallet-android-v0.333.1.aab'), 'aab-bytes');
    // Written through lib.sh with a lane set, so the fixture is the same shape
    // `sign.sh --lane android` produces rather than a hand-rolled header.
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `scope=$(xr_lane_scope "${join(root, 'tools/release/shipped-lanes.txt')}" `
        + `"${join(root, 'tools/release/expected-artifacts.txt')}" android) && `
        + `printf '%s\\n' "$scope" > "${join(work, 'scope-android.txt')}" && `
        + `xr_write_manifest "${partial}" "${TAG}" "${'0'.repeat(40)}" `
        + `"2026-07-31T00:00:00Z" "enforced" "${join(work, 'scope-android.txt')}" "android"`],
    { env: process.env });
    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign',
        join(partial, 'RELEASE_HASHES.txt')], { env: { ...process.env, GNUPGHOME: gnupg } });

    assert.match(readFileSync(join(partial, 'RELEASE_HASHES.txt'), 'utf8'),
        /^# coverage: partial$/m, 'the fixture really is a partial manifest');

    // NO rehearsal record is written for this release, deliberately. The
    // §7.5 matrix declares eight lanes and all eight are desktop, so a
    // store-lane release has nothing there to probe - and the point of this
    // case is that publish.sh must not demand a record about lanes the
    // release does not contain.
    const target = makeTarget('feed-partial');
    const r = await run(['--input', partial, '--tag', TAG, '--target', target,
        '--no-edge-verify']);

    assert.equal(r.status, 0, `a pointerless partial release publishes:\n${r.out}`);
    assert.match(r.out, /rehearsal NOT REQUIRED[\s\S]*NOT PERFORMED/,
        'the waived rehearsal is stated, not silent');
    assert.match(r.out, /unrehearsed, not proven/,
        'and it names what stays uncovered: the direct APK feed nothing rehearses');
    assert.match(r.out, /PARTIAL release/,
        'and says out loud that the channel assertion was answered from the '
        + 'signed manifest rather than from pointers that do not exist');
    assert.ok(existsSync(join(target, 'android', 'xchain-wallet-v0.333.1.apk')),
        'the APK still routes to android/');
    assert.equal(existsSync(join(target, 'android', 'xchain-wallet-android-v0.333.1.aab')), false,
        'and the store-bound .aab is still refused');

    // The staging feed is the DESKTOP update rehearsal venue (§7.5): it exists
    // to prove electron-updater walks a pointer to a binary. A lane with no
    // pointer has nothing to rehearse there, so asking for it is a mistake
    // worth naming rather than a no-op to allow.
    const stagingTarget = makeTarget('feed-partial-staging', { staging: true });
    const s = await run(['--input', partial, '--tag', TAG, '--target', stagingTarget,
        '--staging', '--no-edge-verify']);
    assert.notEqual(s.status, 0, `--staging with a partial release is refused:\n${s.out}`);
    assert.match(s.out, /staging/i, 'and the refusal says why');

    // And the guard has not been widened into "no pointers is fine". A FULL
    // release with no pointers is still the empty-or-wrong directory the
    // original message describes, and must still be refused.
    const noPointers = join(work, 'release-nopointers');
    mkdirSync(noPointers, { recursive: true });
    writeFileSync(join(noPointers, 'xchain-wallet-v0.333.1.apk'), 'apk-bytes');
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `xr_write_manifest "${noPointers}" "${TAG}" "${'0'.repeat(40)}" `
        + `"2026-07-31T00:00:00Z" "enforced" "${join(root, 'tools/release/expected-artifacts.txt')}"`],
    { env: process.env });
    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign',
        join(noPointers, 'RELEASE_HASHES.txt')], { env: { ...process.env, GNUPGHOME: gnupg } });
    writeRehearsalRecord(noPointers, { manifestFrom: noPointers });
    const n = await run(['--input', noPointers, '--tag', TAG,
        '--target', makeTarget('feed-nopointers'), '--no-edge-verify']);
    assert.notEqual(n.status, 0,
        `a FULL release with no channel pointers is still refused:\n${n.out}`);
    // Asserted on the SPECIFIC message, not on the words "no channel
    // pointers", because publish.sh has two guards for this condition and
    // both say that. Measured by disarming the later one and watching this
    // block stay green: the `assert-channel` step always fires first, so the
    // pointer-count guard further down is unreachable for a full release and
    // cannot be falsified there. A loose match would have read as coverage of
    // a check nothing can exercise.
    assert.match(n.out, /this assertion has nothing to check/,
        'refused by the channel assertion, which is the guard that actually '
        + 'fires for a full release with no pointers');

    writeRehearsalRecord(prodRelease);
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

// A REHEARSAL MANIFEST MUST NEVER REACH THE PRODUCTION FEED (§7.5,
// operator answer 2026-08-07). A scoped rehearsal manifest is a real K1
// signature over real bytes from a real tag, so nothing downstream can tell
// it from a release manifest by inspection - it just covers one OS's
// update-capable formats. And a rehearsal set is byte-different twins of
// the production files under identical names, which is the hazard §7.5
// names, so a file listing cannot answer this either. The signed header
// can, and this is the guard that reads it.
{
    const reh = join(work, 'rehearsal-set');
    mkdirSync(reh, { recursive: true });
    writeFileSync(join(reh, 'xchain-wallet-0.333.1-x86_64.AppImage'), 'ai-bytes');
    writeFileSync(join(reh, 'xchain-wallet_0.333.1_amd64.deb'), 'deb-bytes');
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `xr_write_manifest "${reh}" "${TAG}" "${'0'.repeat(40)}" `
        + `"2026-07-31T00:00:00Z" "enforced" `
        + `"${join(root, 'tools/release/expected-artifacts.txt')}" "" "linux"`],
    { env: process.env });

    assert.match(readFileSync(join(reh, 'RELEASE_HASHES.txt'), 'utf8'),
        /^# rehearsal-os: linux$/m, 'the fixture really is a scoped rehearsal manifest');

    const prodTarget = makeTarget('feed-prod-for-rehearsal');
    const r = await run(['--input', reh, '--tag', TAG, '--target', prodTarget,
        '--no-edge-verify']);
    assert.notEqual(r.status, 0,
        `a rehearsal manifest must be refused by a production publish:\n${r.out}`);
    assert.match(r.out, /REHEARSAL manifest/,
        'and the refusal names what it found, rather than failing on some '
        + 'downstream symptom the operator would misread');
}

rmSync(work, { recursive: true, force: true });
console.log('publish-feed.smoke.js: ok');
