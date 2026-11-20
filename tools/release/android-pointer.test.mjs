// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// android-pointer.mjs, driven for real: a throwaway signing key, a local feed
// root served over HTTP in this process, and the tool spawned against both.
// Every refusal and the dry run must leave the feed byte-identical, and a good
// run must change android/latest.json and nothing else.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildApk } from '../../test/smoke/_apk.js';
import { apkRows, parseArgs } from './android-pointer.mjs';
import { DIRECT_LANES, LANES } from './rehearsal-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TOOL = join(HERE, 'android-pointer.mjs');
const TAG = 'v0.333.1';
const APK = 'xchain-wallet-v0.333.1.apk';
const FULL = 'xchain-wallet-v0.333.1-full.apk';
const HAVE_GPG = spawnSync('gpg', ['--version']).status === 0;

// A SHORT prefix: GNUPGHOME holds gpg-agent's socket, and a long tmpdir path
// overflows sun_path, which gpg reports as "no agent running".
const work = mkdtempSync(join(tmpdir(), 'xap-t-'));
const keyring = join(work, 'g');
const otherKeyring = join(work, 'o');
let fpr = '';
let records = '';
let server;
let base = '';
let served = '';

function newKey(home, uid) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    execFileSync('gpg', ['--batch', '--quiet', '--passphrase', '', '--quick-generate-key',
        uid, 'ed25519', 'sign', '0'], { env: { ...process.env, GNUPGHOME: home } });
    return execFileSync('gpg', ['--list-keys', '--with-colons'], { env: { ...process.env, GNUPGHOME: home }, encoding: 'utf8' })
        .split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];
}

/**
 * A served production feed root after a full publish: the signed full manifest
 * under RELEASE_HASHES/, both APKs under android/, and the old pointer.
 */
function makeFeed(name, {
    signWith = keyring, manifest = true, servedApk = null, pointer = '0.333.0', staging = false,
    appImage = 'appimage-bytes',
} = {}) {
    const rel = join(work, `${name}-rel`);
    mkdirSync(rel, { recursive: true });
    const apks = { [APK]: buildApk(), [FULL]: buildApk({ extraEntries: [{ name: 'assets/full.txt', body: 'full' }] }) };
    for (const [file, body] of Object.entries(apks)) writeFileSync(join(rel, file), body);
    writeFileSync(join(rel, 'xchain-wallet-0.333.1-x86_64.AppImage'), appImage);
    // Written by lib.sh, as sign.sh writes it, so the header is the real shape.
    execFileSync('bash', ['-c',
        `. "${join(HERE, 'lib.sh')}" && xr_write_manifest "${rel}" "${TAG}" "${'0'.repeat(40)}" `
        + `"2026-07-31T00:00:00Z" enforced "${join(HERE, 'expected-artifacts.txt')}"`]);
    execFileSync('gpg', ['--batch', '--yes', '--armor', '--detach-sign', join(rel, 'RELEASE_HASHES.txt')],
        { env: { ...process.env, GNUPGHOME: signWith } });

    const target = join(work, name);
    mkdirSync(join(target, 'android'), { recursive: true });
    mkdirSync(join(target, 'RELEASE_HASHES'), { recursive: true });
    for (const [file, body] of Object.entries(apks)) {
        writeFileSync(join(target, 'android', file), file === APK && servedApk ? servedApk : body);
    }
    if (manifest) {
        writeFileSync(join(target, 'RELEASE_HASHES', `${TAG}.txt`), readFileSync(join(rel, 'RELEASE_HASHES.txt')));
        writeFileSync(join(target, 'RELEASE_HASHES', `${TAG}.txt.asc`), readFileSync(join(rel, 'RELEASE_HASHES.txt.asc')));
    }
    writeFileSync(join(target, 'android', 'latest.json'), `{"version": "${pointer}"}\n`);
    if (staging) writeFileSync(join(target, '.staging-feed'), 'staging\n');
    return { target, manifestPath: join(rel, 'RELEASE_HASHES.txt') };
}

/** A passing rehearsal record bound to `manifestPath`'s bytes. */
function rehearsalFor(name, manifestPath) {
    const path = join(work, `REHEARSAL-${name}.json`);
    writeFileSync(path, `${JSON.stringify({
        'record-version': 1,
        tag: TAG,
        'prod-manifest-sha256': createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
        'swap-requirement': 'one-os',
        'requirement-reason': 'test fixture',
        'pinned-key-override': null,
        lanes: LANES.map((l) => ({ id: l.id, ok: true })),
        'direct-lanes': DIRECT_LANES.map((l) => ({ id: l.id, ok: true })),
        swaps: [{ lane: 'mac-arm64', device: 'Mac Studio', from: '0.333.0' }],
    }, null, 2)}\n`);
    return path;
}

/** Every file under `dir` as relative path -> sha256, the feed's whole state. */
function snapshot(dir) {
    const out = {};
    const walk = (d) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
        }
    };
    walk(dir);
    return out;
}

function changed(beforeSnap, afterSnap) {
    const keys = new Set([...Object.keys(beforeSnap), ...Object.keys(afterSnap)]);
    return [...keys].filter((k) => beforeSnap[k] !== afterSnap[k]).sort();
}

/** Spawned, not spawnSync: the HTTP server it reads lives in this process. */
function runTool(args) {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            GNUPGHOME: keyring,
            XCHAIN_VERIFY_KEY: fpr,
            XCHAIN_WALLET_RELEASE_RECORDS: records,
        };
        delete env.CLOUDFLARE_ZONE_ID;
        delete env.CLOUDFLARE_PURGE_TOKEN;
        const child = spawn(process.execPath, [TOOL, ...args], { env });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        child.on('close', (status) => resolve({ status, out }));
    });
}

const args = (feed, rehearsal, extra = []) => ['--tag', TAG, '--target', feed.target,
    '--public-base', `${base}/${relative(served, feed.target)}`, '--rehearsal', rehearsal, ...extra];

before(async () => {
    if (!HAVE_GPG) return;
    fpr = newKey(keyring, 'XChain Pointer Test <pointer@example.invalid>');
    newKey(otherKeyring, 'Someone Else <other@example.invalid>');
    records = join(work, 'records');
    mkdirSync(records);
    writeFileSync(join(records, 'TEMPLATE.md'), '# XChain Wallet release record - vX.Y.Z\n\n**Version:** X.Y.Z\n**Tag:** vX.Y.Z\n');
    writeFileSync(join(records, `${TAG}.md`), `# XChain Wallet release record - ${TAG}\n\n`
        + `**Version:** ${TAG.slice(1)}  \n**Tag:** ${TAG}  \n**Opened:** 2026-11-19  \n`);
    served = work;
    server = createServer((req, res) => {
        const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/+/, ''));
        const file = resolvePath(served, name);
        if (!file.startsWith(resolvePath(served) + sep) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404); res.end('not found'); return;
        }
        res.writeHead(200); res.end(readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server?.close();
    if (HAVE_GPG) {
        for (const home of [keyring, otherKeyring]) {
            spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env: { ...process.env, GNUPGHOME: home } });
        }
    }
    rmSync(work, { recursive: true, force: true });
});

test('parseArgs takes only a plain vX.Y.Z tag and requires every gate input', () => {
    const ok = ['--target', 't', '--public-base', 'https://x/wallet/', '--rehearsal', 'r'];
    assert.equal(parseArgs(['--tag', 'v1.2.3', ...ok]).publicBase, 'https://x/wallet');
    assert.throws(() => parseArgs(['--tag', 'v1.2.3-rc.1', ...ok]), /plain vMAJOR/);
    assert.throws(() => parseArgs(['--tag', 'v1.2.3', '--target', 't', '--public-base', 'https://x']), /--rehearsal/);
    assert.throws(() => parseArgs(['--tag', 'v1.2.3', ...ok, '--force']), /unknown argument/);
});

test('apkRows reads only the APK rows of a manifest', () => {
    const rows = apkRows(`# tag: v1\n${'a'.repeat(64)}  ./x.apk\n${'b'.repeat(64)}  ./x.aab\n`);
    assert.deepEqual(rows, [{ sha256: 'a'.repeat(64), name: 'x.apk' }]);
});

test('refuses when the version has no served manifest', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('unserved', { manifest: false });
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('unserved', feed.manifestPath)));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /v0\.333\.1 is not published: RELEASE_HASHES\/v0\.333\.1\.txt returned 404/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('refuses a manifest signed by a key other than the expected one', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('wrongkey', { signWith: otherKeyring });
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('wrongkey', feed.manifestPath)));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /verify\.sh refused/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('refuses a corrupted signature', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('badsig');
    const asc = join(feed.target, 'RELEASE_HASHES', `${TAG}.txt.asc`);
    const lines = readFileSync(asc, 'utf8').split('\n');
    const i = lines.findIndex((l) => /^[A-Za-z0-9+/]{20,}/.test(l));
    lines[i] = lines[i].replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    writeFileSync(asc, lines.join('\n'));
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('badsig', feed.manifestPath)));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /verify\.sh refused/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('refuses when a served APK does not match its signed hash', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('mismatch', { servedApk: buildApk({ extraEntries: [{ name: 'assets/x.txt', body: 'swapped' }] }) });
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('mismatch', feed.manifestPath)));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /android\/xchain-wallet-v0\.333\.1\.apk as served hashes to [0-9a-f]{64}, but the signed manifest says/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('refuses without a rehearsal record bound to the served manifest', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('unrehearsed');
    // Another build of the same tag: a different manifest, so a different hash.
    const other = makeFeed('unrehearsed-other', { appImage: 'recut-appimage-bytes' });
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('unrehearsed', other.manifestPath)));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /different production manifest/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('refuses a staging feed root and a pointer already ahead', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const staging = makeFeed('staging', { staging: true });
    const stagingSnap = snapshot(staging.target);
    const s = await runTool(args(staging, rehearsalFor('staging', staging.manifestPath)));
    assert.equal(s.status, 1, s.out);
    assert.match(s.out, /STAGING feed/);
    assert.deepEqual(changed(stagingSnap, snapshot(staging.target)), []);

    const ahead = makeFeed('ahead', { pointer: '0.334.0' });
    const aheadSnap = snapshot(ahead.target);
    const a = await runTool(args(ahead, rehearsalFor('ahead', ahead.manifestPath)));
    assert.equal(a.status, 1, a.out);
    assert.match(a.out, /names 0\.334\.0, which is newer than 0\.333\.1/);
    assert.deepEqual(changed(aheadSnap, snapshot(ahead.target)), []);
});

test('--dry-run runs every check and writes nothing', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('dryrun');
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsalFor('dryrun', feed.manifestPath), ['--dry-run']));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /GPG signature is good and from the expected key/);
    assert.match(r.out, /ok {3}rehearsal v0\.333\.1/);
    assert.match(r.out, /--dry-run, nothing written/);
    assert.deepEqual(changed(snap, snapshot(feed.target)), []);
});

test('writes android/latest.json last, and nothing else', { skip: !HAVE_GPG && 'gpg is not installed' }, async () => {
    const feed = makeFeed('good');
    const rehearsal = rehearsalFor('good', feed.manifestPath);
    const snap = snapshot(feed.target);
    const r = await runTool(args(feed, rehearsal));
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(changed(snap, snapshot(feed.target)), ['android/latest.json']);
    const pointer = join(feed.target, 'android', 'latest.json');
    assert.deepEqual(JSON.parse(readFileSync(pointer, 'utf8')), { version: '0.333.1' });
    assert.equal(statSync(pointer).mode & 0o777, 0o644);

    // Last: the upload line follows both signature checks and the rehearsal gate.
    const upload = r.out.indexOf('uploading android/latest.json');
    assert.ok(upload > r.out.lastIndexOf('GPG signature is good and from the expected key'), r.out);
    assert.ok(upload > r.out.indexOf('ok   rehearsal v0.333.1'), r.out);
    assert.match(r.out, /NOT purging/);
    assert.match(r.out, /names 0\.333\.1$/m);

    // A second run finds the pointer current and writes nothing.
    const again = snapshot(feed.target);
    const second = await runTool(args(feed, rehearsal));
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /already names 0\.333\.1; nothing to write/);
    assert.deepEqual(changed(again, snapshot(feed.target)), []);
});
