// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the DIRECT lane's §7.5 rehearsal .
//
// The desktop rehearsal has had a harness since  stage 5 and the
// direct APK lane had none, which is the whole defect: `rehearsal-matrix.mjs`
// declared eight lanes, all of them electron-updater, so "every update lane
// is rehearsed" was true of a set that did not contain the one shipped
// channel with a hand-rolled feed. This stands one up.
//
// Same fixture shape as rehearsal.smoke.js, and the same two honest
// deviations: plain HTTP behind an injected fetch that maps the https base
// onto it, and no device, so the install-over half is not observed here.
// What IS driven is the shipped client itself - `directUpdateCheck.js`, the
// module inside the published APK - against a real feed, in both directions.
//
// The refusals are the point. A rehearsal harness that only passes proves
// nothing, so each way the direct lane can be wrong is built on purpose and
// the failure has to name that way and not an adjacent one.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
    probeDirectLane,
    assertRecord,
    lanesInRelease,
    RECORD_VERSION,
} from '../../../tools/release/rehearse.mjs';
import { LANES, DIRECT_LANES, laneById, isDirectLane } from '../../../tools/release/rehearsal-matrix.mjs';
import { UPDATE_FEED_URL, updateNoticeText } from '../../../packages/web/src/update/directUpdateCheck.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status !== 0) {
    process.stderr.write('android-update-rehearsal.smoke.js: SKIPPED - gpg is not installed\n');
    process.exit(0);
}

const TAG = 'v0.336.1';
const VERSION = '0.336.1';
const PREVIOUS = '0.336.0';
const APK = `xchain-wallet-v${VERSION}.apk`;
const AAB = `xchain-wallet-android-v${VERSION}.aab`;

const LANE = DIRECT_LANES.find((l) => l.id === 'android-direct');
assert.ok(LANE, 'the matrix must declare the android-direct lane;  is the row that adds it');

// A SHORT prefix on purpose: GNUPGHOME below holds gpg-agent's unix socket,
// and a macOS temp dir plus a descriptive name overruns the ~104-byte
// sun_path limit. gpg then reports "no agent running", which reads as gpg
// being absent rather than as a path being long.
const work = mkdtempSync(join(tmpdir(), 'xc-apk-'));
const gnupg = join(work, 'gnupg');
mkdirSync(gnupg, { recursive: true, mode: 0o700 });
const gpgEnv = { ...process.env, GNUPGHOME: gnupg };

execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-generate-key',
    'XChain Android Rehearsal Smoke <smoke@example.invalid>', 'ed25519', 'sign', '0'], { env: gpgEnv });
const armoredKey = execFileSync('gpg', ['--armor', '--export'], { env: gpgEnv, encoding: 'utf8' });
const fingerprint = execFileSync('gpg', ['--list-keys', '--with-colons'],
    { env: gpgEnv, encoding: 'utf8' })
    .split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];
const pinned = { armoredKey, fingerprint };

/**
 * Build a feed tree in the published layout: the APK under android/, its
 * feed beside it, the signed manifest under RELEASE_HASHES/.
 *
 * `mutate` runs before signing (our own mistake, covered by K1) and
 * `tamper` after it (a feed host we do not control), the same split
 * rehearsal.smoke.js draws and for the same reason.
 */
function makeFeed(name, { mutate = () => {}, tamper = () => {} } = {}) {
    const dir = join(work, name);
    const android = join(dir, 'android');
    const hashes = join(dir, 'RELEASE_HASHES');
    mkdirSync(android, { recursive: true });
    mkdirSync(hashes, { recursive: true });

    const state = {
        artifacts: { [APK]: `apk-bytes-${VERSION}` },
        feed: `${JSON.stringify({ version: VERSION }, null, 2)}\n`,
    };
    mutate(state);

    const staged = join(work, `${name}-staged`);
    mkdirSync(staged, { recursive: true });
    for (const [n, body] of Object.entries(state.artifacts)) writeFileSync(join(staged, n), body);
    execFileSync('bash', ['-c',
        `. "${join(root, 'tools/release/lib.sh')}" && `
        + `xr_write_manifest "${staged}" "${TAG}" "${'0'.repeat(40)}" `
        + '"2026-08-09T00:00:00Z" "enforced"'], { env: process.env });
    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign',
        join(staged, 'RELEASE_HASHES.txt')], { env: gpgEnv });

    writeFileSync(join(hashes, `${TAG}.txt`), readFileSync(join(staged, 'RELEASE_HASHES.txt')));
    writeFileSync(join(hashes, `${TAG}.txt.asc`), readFileSync(join(staged, 'RELEASE_HASHES.txt.asc')));

    tamper(state);

    for (const [n, body] of Object.entries(state.artifacts)) writeFileSync(join(android, n), body);
    if (state.feed !== null) writeFileSync(join(android, 'latest.json'), state.feed);
    return { dir, staged };
}

let serving = null;
const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
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

const FEED = 'https://feed.invalid/wallet/';
const mappedFetch = (url, init) => fetch(
    String(url).replace(FEED, `http://127.0.0.1:${port}/`), init,
);

const probe = (feedDir, over = {}) => {
    serving = feedDir;
    return probeDirectLane({
        lane: LANE,
        feedBase: FEED,
        tag: TAG,
        previousVersion: PREVIOUS,
        fetch: mappedFetch,
        pinned,
        ...over,
    });
};

// --------------------------------------------------------- the happy path

{
    const feed = makeFeed('feed-good');
    const r = await probe(feed.dir);
    assert.ok(r.ok, `the direct lane passes: ${r.failed} ${r.reason}`);

    // The two directions, and the second is the one a sideloader depends on.
    assert.equal(r.checks.currentInstall, 'silent',
        'an install already on this release must be told nothing at all');
    assert.equal(r.checks.previousInstall, VERSION,
        'an install on the previous release must be told about this one, by name');
    assert.equal(r.checks.aheadInstall, 'silent',
        'an install ahead of the feed must not be told to downgrade');

    // Every byte of the notice is composed locally from the version number.
    // The feed is untrusted input into a wallet UI; the day that stops being
    // true, an update notice is a phishing surface.
    assert.equal(r.checks.notice, updateNoticeText(VERSION));
    assert.ok(!r.checks.notice.includes('http'),
        'the notice must not carry a link, from the feed or from anywhere else');

    // The destination half: the file a user is being sent to fetch exists
    // and is the one K1 signed for this tag.
    assert.equal(r.selected, APK, 'the APK is taken from the signed manifest, not from a name pattern');
    assert.equal(r.checks.signedManifest, 'ok');

    // Three forced checks, three requests, all to the client's own URL.
    // A client that fetched something else would have thrown inside the
    // injected fetch rather than quietly reading a second endpoint.
    assert.equal(r.checks.feedRequests, 3);
    assert.equal(r.checks.clientFeedUrl, UPDATE_FEED_URL);
}

// ------------------------------------------------- one refusal at a time

{
    // The feed is simply not there. This is the state the lane was in until
    // 2026-08-06, and a release that publishes the APK without it leaves
    // every direct install with no channel at all.
    const feed = makeFeed('feed-absent', { tamper: (s) => { s.feed = null; } });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'feed');
    assert.match(r.reason, /HTTP 404/);
}

{
    // A feed left behind from the previous release. Nothing about it is
    // malformed; it just describes something other than what is being
    // published, so every install stays where it is and the release is
    // invisible to the lane.
    const feed = makeFeed('feed-stale', {
        tamper: (s) => { s.feed = `${JSON.stringify({ version: PREVIOUS })}\n`; },
    });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'version');
    assert.match(r.reason, new RegExp(`says ${PREVIOUS.replace(/\./g, '\\.')}`));
}

{
    // The schema is exactly one strictly-validated semver field, and the
    // shipped parser is what says so here. A four-part version, a "v"
    // prefix or a pre-release tag are all things a person would write by
    // hand into a feed and all things the client refuses.
    for (const version of ['0.336', 'v0.336.1', '0.336.1-rc1', '00.336.1']) {
        const feed = makeFeed(`feed-bad-${version.replace(/\W/g, '_')}`, {
            tamper: (s) => { s.feed = `${JSON.stringify({ version })}\n`; },
        });
        // eslint-disable-next-line no-await-in-loop
        const r = await probe(feed.dir);
        assert.equal(r.failed, 'feed', `"${version}" must be refused by the shipped parser`);
    }
}

{
    // An oversized feed makes the shipped client return null, which on a
    // phone is indistinguishable from being offline. Told apart here on
    // purpose: silence from a wallet is not evidence that a feed is fine.
    const feed = makeFeed('feed-oversized', {
        tamper: (s) => {
            s.feed = `${JSON.stringify({ version: VERSION, note: 'x'.repeat(5000) })}\n`;
        },
    });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'feed');
    assert.match(r.reason, /reads at most/);
}

{
    // The notice points at a download that is not there. The feed is
    // perfect and the lane is still broken, which is why the destination is
    // part of the rehearsal rather than assumed from the feed passing.
    const feed = makeFeed('feed-no-apk', { tamper: (s) => { s.artifacts = {}; } });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'download');
    assert.match(r.reason, /HTTP 404/);
}

{
    // A feed host that swapped the APK after signing. The bytes are served,
    // the feed agrees with them, and K1 does not.
    const feed = makeFeed('feed-swapped-apk', {
        tamper: (s) => { s.artifacts[APK] = 'not-the-signed-bytes'; },
    });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'verify');
    assert.match(r.reason, /does not match the signed hash/);
}

{
    // A release whose manifest covers no APK at all. The lane is being
    // rehearsed for a release that does not contain its artifact, and
    // saying so beats resolving a name pattern against the feed and
    // hoping.
    const feed = makeFeed('feed-manifest-no-apk', {
        mutate: (s) => { s.artifacts = { [AAB]: 'bundle-bytes' }; },
    });
    const r = await probe(feed.dir);
    assert.equal(r.failed, 'artifact');
    assert.match(r.reason, /covers 0 \.apk/);
}

{
    // The lane and the shipped client disagree about where the feed lives.
    // This is the defect no amount of looking at the published feed by hand
    // would find: the file is right there, and no installed app reads it.
    const feed = makeFeed('feed-url-drift');
    const r = await probe(feed.dir, { lane: { ...LANE, feed: 'android/update.json' } });
    assert.equal(r.failed, 'client-feed-url');
    assert.match(r.reason, /the shipped client reads/);
}

{
    // The first release of a lane has no earlier install to notify, and the
    // record has to say that rather than skip the direction silently.
    const feed = makeFeed('feed-bootstrap');
    const r = await probe(feed.dir, { previousVersion: null });
    assert.ok(r.ok);
    assert.match(String(r.checks.previousInstall), /^skipped/);
}

// -------------------------------------------- what the record is asked for

const MANIFEST_SHA = 'a'.repeat(64);
const okDirect = [{ id: 'android-direct', ok: true, checks: {} }];
const baseRecord = {
    'record-version': RECORD_VERSION,
    tag: TAG,
    'prod-manifest-sha256': MANIFEST_SHA,
    'swap-requirement': 'one-os',
    'requirement-reason': 'test',
    'pinned-key-override': null,
    lanes: LANES.map((l) => ({ id: l.id, ok: true })),
    'direct-lanes': okDirect,
    swaps: [{ lane: 'mac-arm64', device: 'Mac Studio', from: '0.336.0' }],
};
const check = (over, releaseArtifacts) => assertRecord({
    record: { ...baseRecord, ...over },
    tag: TAG,
    prodManifestSha256: MANIFEST_SHA,
    releaseArtifacts,
});

{
    // Omitting the listing keeps the behaviour every existing caller has:
    // desktop demanded, direct not considered. A new parameter must not
    // change what an old call means.
    assert.deepEqual(lanesInRelease(undefined), { desktop: true, direct: false });
    assert.ok(check({ 'direct-lanes': [] }).ok,
        'with no listing, a desktop-shaped record still passes');

    // An empty or unrecognised listing takes the STRICT branch. "I could
    // not tell what this release is" must never be the sentence that
    // waives a gate.
    assert.deepEqual(lanesInRelease([]), { desktop: true, direct: false });
    assert.deepEqual(lanesInRelease(['notes.txt']), { desktop: true, direct: false });
    assert.match(check({ lanes: [] }, []).problems.join(' '), /no result for lane/);
}

{
    // A desktop release is not asked about Android, even though the lane
    // now exists. The gate ranges over what the release contains.
    const desktopOnly = [`xchain-wallet-setup-${VERSION}-x64.exe`, `xchain-wallet_${VERSION}_amd64.deb`];
    assert.deepEqual(lanesInRelease(desktopOnly), { desktop: true, direct: false });
    assert.ok(check({ 'direct-lanes': [] }, desktopOnly).ok);
}

{
    // An APK-only release. The eight desktop lanes are not in it, so they
    // are not demanded of it - this is the shape that used to be blocked by
    // a gate that could not have probed it anyway.
    const apkOnly = [APK, AAB];
    assert.deepEqual(lanesInRelease(apkOnly), { desktop: false, direct: true });

    const noRecord = check({ lanes: [], 'direct-lanes': [], swaps: [] }, apkOnly);
    assert.ok(!noRecord.ok);
    assert.match(noRecord.problems.join(' '), /no result for lane android-direct/);
    assert.ok(!noRecord.problems.join(' ').includes('win-x64'),
        'an Android release is not refused for want of a Windows probe');
    assert.ok(!noRecord.problems.join(' ').includes('no observed swap on any OS'),
        'nor for want of a desktop swap it has no lane for');

    const failed = check({
        lanes: [],
        swaps: [],
        'direct-lanes': [{ id: 'android-direct', ok: false, failed: 'feed', reason: 'HTTP 404' }],
    }, apkOnly);
    assert.ok(!failed.ok);
    assert.match(failed.problems.join(' '), /lane android-direct failed at feed/);

    // Passing, and saying in as many words what it did NOT prove. The
    // waiver is keyed to the matrix naming no device, so it cannot be
    // claimed by a flag and it disappears the day DD-A is answered.
    const passing = check({ lanes: [], swaps: [] }, apkOnly);
    assert.ok(passing.ok, passing.problems.join(' '));
    assert.equal(passing.notes.length, 1);
    assert.match(passing.notes[0], /unrehearsed,\s+not proven/);
    assert.match(passing.notes[0], /DD-A/);
}

{
    // A release carrying both. Both halves are demanded; neither excuses
    // the other.
    const both = [APK, `xchain-wallet-setup-${VERSION}-x64.exe`];
    assert.deepEqual(lanesInRelease(both), { desktop: true, direct: true });
    assert.ok(check({}, both).ok);
    assert.match(check({ 'direct-lanes': [] }, both).problems.join(' '),
        /no result for lane android-direct/);
    assert.match(check({ lanes: [] }, both).problems.join(' '), /no result for lane\(s\)/);
}

{
    // Once a device IS named, the install-over stops being a note and
    // becomes a requirement, with no other edit anywhere. Driven with a
    // stand-in device rather than asserted about the real matrix, which
    // deliberately names none yet.
    const named = { ...LANE, device: 'Pixel 7a (bench)' };
    const withDevice = assertRecordAgainst(named, { lanes: [], swaps: [] });
    assert.ok(!withDevice.ok);
    assert.match(withDevice.problems.join(' '), /has no observed install-over/);
    assert.match(withDevice.problems.join(' '), /destroys the vault/);

    const attested = assertRecordAgainst(named, {
        lanes: [],
        swaps: [{ lane: 'android-direct', device: named.device, from: PREVIOUS }],
    });
    assert.ok(attested.ok, attested.problems.join(' '));
    assert.equal(attested.notes.length, 0);
}

// The lane list is module state, so the device is swapped in place around
// the two cases above and put back immediately. Done here rather than by
// exporting a setter: a release tool that can be told its own hardware by
// a caller is a release tool whose record cannot be trusted.
function assertRecordAgainst(lane, over) {
    const original = { ...DIRECT_LANES[0] };
    Object.assign(DIRECT_LANES[0], lane);
    try {
        return check(over, [APK]);
    } finally {
        Object.assign(DIRECT_LANES[0], original);
    }
}

// ------------------------------------------------------------- the CLI

{
    const cli = (...args) => spawnSync(
        process.execPath, [join(root, 'tools/release/rehearse.mjs'), ...args],
        { encoding: 'utf8' },
    );

    // `attest` refuses the lane while DD-A is unanswered. Recording an
    // install-over without saying which device watched it is the claim the
    // named-device rule exists to prevent.
    const record = join(work, 'record.json');
    writeFileSync(record, `${JSON.stringify(baseRecord, null, 2)}\n`);
    const attest = cli('attest', '--record', record, '--lane', 'android-direct',
        '--from', PREVIOUS, '--by', 'nobody');
    assert.equal(attest.status, 1);
    assert.match(attest.stderr, /no named smoke device/);
    assert.equal(readFileSync(record, 'utf8').includes('android-direct'), true);
    assert.equal(JSON.parse(readFileSync(record, 'utf8')).swaps.length, 1,
        'a refused attestation must not have written a swap');

    // The gate publish.sh actually runs, over an APK-only release
    // directory. Driven through the CLI rather than through assertRecord
    // because the listing that decides which lanes are demanded is read
    // there, and a gate whose input is computed in the test is a gate the
    // test is passing on behalf of.
    const prodInput = join(work, 'prod-apk');
    mkdirSync(prodInput, { recursive: true });
    writeFileSync(join(prodInput, APK), 'apk-bytes');
    writeFileSync(join(prodInput, AAB), 'aab-bytes');
    writeFileSync(join(prodInput, 'RELEASE_HASHES.txt'), '# XChain Wallet release manifest\n');
    // Computed the way rehearse.mjs computes it, in-process. Shelling out
    // to shasum/sha256sum would make this case depend on which of the two a
    // venue happens to have, which is a thing lib.sh has a helper for and a
    // test has no reason to reproduce.
    const manifestSha = createHash('sha256')
        .update(readFileSync(join(prodInput, 'RELEASE_HASHES.txt'))).digest('hex');

    const apkRecord = join(work, 'record-apk.json');
    const writeApkRecord = (over) => writeFileSync(apkRecord, `${JSON.stringify({
        ...baseRecord, 'prod-manifest-sha256': manifestSha, lanes: [], swaps: [], ...over,
    }, null, 2)}\n`);

    writeApkRecord({ 'direct-lanes': [] });
    const refused = cli('assert', '--record', apkRecord, '--tag', TAG, '--prod-input', prodInput);
    assert.equal(refused.status, 1, 'an APK release with no direct-lane result is refused');
    assert.match(refused.stderr, /no result for lane android-direct/);

    writeApkRecord({});
    const passed = cli('assert', '--record', apkRecord, '--tag', TAG, '--prod-input', prodInput);
    assert.equal(passed.status, 0, `an APK release with a direct-lane result passes:\n${passed.stderr}`);
    // And says what it did not prove, on stderr, before the ok line. A
    // publish that exits 0 must not read as fully proven when a whole half
    // of the lane has never been watched.
    assert.match(passed.stderr, /NOT PROVEN/);
    assert.match(passed.stderr, /unrehearsed, not proven/);
    assert.match(passed.stdout, /^ok /);

    // The lane appears in coverage with its own open question named, and
    // not under DD4, which is a different blocker with a different owner.
    const coverage = cli('coverage', '--records', join(work, 'no-records'));
    assert.equal(coverage.status, 1);
    assert.match(coverage.stdout, /android-direct\s+NO DEVICE NAMED \(DD-A\)/);

    // The matrix prints the direct lane too. It was left off the printed
    // table for eight lanes' worth of releases, and a table someone reads
    // to decide what to rehearse is exactly where an omission compounds.
    const matrix = spawnSync(process.execPath,
        [join(root, 'tools/release/rehearsal-matrix.mjs')], { encoding: 'utf8' });
    assert.equal(matrix.status, 0);
    assert.match(matrix.stdout, /android-direct/);
    assert.match(matrix.stdout, /direct lane/);
}

// --------------------------------------------------------- the module seam

{
    // The two lane sets stay separate. Folding the direct lane into LANES
    // would make every desktop consumer special-case it, starting with the
    // linux-format audit and the electron-updater selection rule.
    assert.ok(!LANES.some((l) => l.id === 'android-direct'),
        'android-direct is not an electron-updater lane and must not be in LANES');
    assert.ok(isDirectLane('android-direct'));
    assert.ok(!isDirectLane('mac-arm64'));
    assert.equal(laneById('android-direct')?.os, 'android',
        'laneById spans both sets, which is what lets attest and coverage stay one code path');

    // The lane names the module it drives, and that module has to be the
    // one the app ships. A rename that left this pointing at a copy would
    // rehearse the copy.
    assert.equal(LANE.client, 'packages/web/src/update/directUpdateCheck.js');
    assert.ok(UPDATE_FEED_URL.endsWith(LANE.feed),
        `the matrix says the feed is ${LANE.feed} and the client reads ${UPDATE_FEED_URL}`);
    assert.ok(UPDATE_FEED_URL.startsWith('https://downloads.xchain.io/'),
        'the direct feed is served from the downloads host and nowhere else');
}

server.close();
rmSync(work, { recursive: true, force: true });
process.stdout.write('android-update-rehearsal.smoke.js: ok\n');
