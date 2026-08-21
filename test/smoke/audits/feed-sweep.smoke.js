// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §7.2: the feed sweep, driven against a real tree.
//
// Two failure modes are being guarded here and they pull in opposite
// directions, which is the whole difficulty. The sweep has to SEE the
// attack it exists for - an attacker who can write to the feed uploads
// their own Linux artifact and rewrites the pointer to name it, producing
// a yml that is internally perfect - and it has to STAY QUIET during a
// rollback, where the feed legitimately serves a previous release's
// pointer beside the newest release's binaries. A sweep that misses the
// first is decoration; one that fires on the second gets muted inside a
// month, which comes to the same thing.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PAYLOAD_DIRS, parseManifest, parseUpdateInfo, sweep, verifyManifestSignature }
    from '../../../tools/release/feed-sweep.mjs';

const root = mkdtempSync(join(tmpdir(), 'xchain-feed-sweep-'));
const codes = (result) => result.findings.map((f) => f.code).sort();

function sha256(text) { return createHash('sha256').update(text).digest('hex'); }
function sha512b64(text) { return createHash('sha512').update(text).digest('base64'); }

/**
 * Build a feed tree. `artifacts` is name -> bytes; `manifests` is tag ->
 * the artifact names that release covered; `pointers` is filename -> the
 * update-info body.
 */
function buildFeed(dir, { artifacts = {}, manifests = {}, pointers = {}, signed = true }) {
    rmSync(dir, { recursive: true, force: true });
    for (const sub of ['desktop', 'extension', 'web', 'RELEASE_HASHES']) {
        mkdirSync(join(dir, sub), { recursive: true });
    }
    for (const [name, body] of Object.entries(artifacts)) {
        writeFileSync(join(dir, 'desktop', name), body);
    }
    for (const [tag, names] of Object.entries(manifests)) {
        const lines = [
            '# XChain Wallet release manifest',
            '# manifest-version: 1',
            `# tag: ${tag}`,
            '# tag-commit: ' + '0'.repeat(40),
            '# built: 2026-07-31T00:00:00Z',
            '# dev-mock-gate: enforced',
            `# artifacts: ${names.length}`,
            ...names.map((n) => `${sha256(artifacts[n])}  ./${n}`),
        ];
        writeFileSync(join(dir, 'RELEASE_HASHES', `${tag}.txt`), `${lines.join('\n')}\n`);
        if (signed) {
            writeFileSync(join(dir, 'RELEASE_HASHES', `${tag}.txt.asc`), 'signature\n');
        }
    }
    for (const [name, body] of Object.entries(pointers)) {
        writeFileSync(join(dir, 'desktop', name), body);
    }
}

/** An update-info yml in exactly the shape app-builder-lib serializes. */
function updateInfo(version, entries) {
    const lines = [`version: ${version}`, 'files:'];
    for (const [name, body] of entries) {
        lines.push(`  - url: ${name}`,
            `    sha512: ${sha512b64(body)}`,
            `    size: ${Buffer.byteLength(body)}`);
    }
    const [firstName, firstBody] = entries[0];
    lines.push(`path: ${firstName}`, `sha512: ${sha512b64(firstBody)}`,
        "releaseDate: '2026-07-31T00:00:00.000Z'");
    return `${lines.join('\n')}\n`;
}

const V1 = {
    'xchain-wallet-0.333.1-x86_64.AppImage': 'appimage-one',
    'xchain-wallet-0.333.1-arm64.AppImage': 'appimage-one-arm',
};
const V2 = {
    'xchain-wallet-0.333.2-x86_64.AppImage': 'appimage-two',
};

// ----------------------------------------------------- the parsers first

{
    const text = updateInfo('0.333.1', Object.entries(V1));
    const info = parseUpdateInfo(text);
    assert.equal(info.version, '0.333.1', 'version is read');
    assert.equal(info.files.length, 2, 'both arch entries are read from one mac/linux yml');
    assert.equal(info.files[0].url, 'xchain-wallet-0.333.1-x86_64.AppImage',
        'a url containing spaces survives (productName is "XChain Wallet")');
    assert.equal(info.files[0].sha512, sha512b64('appimage-one'), 'nested sha512 binds to its url');
    assert.equal(info.files[1].sha512, sha512b64('appimage-one-arm'),
        'the SECOND entry keeps its own hash - the top-level legacy sha512 duplicates the '
        + 'FIRST, and folding it onto the last entry would blind the sweep to a tampered arm64');
}

{
    // The pre-`files:` shape electron-updater still reads. A tamper that
    // edits only this legacy pair has to be visible too.
    const legacy = 'version: 0.333.1\npath: old.AppImage\nsha512: abc==\n';
    const info = parseUpdateInfo(legacy);
    assert.equal(info.files.length, 1, 'the legacy top-level pair counts as a file entry');
    assert.equal(info.files[0].url, 'old.AppImage');
    assert.equal(info.files[0].sha512, 'abc==');
}

// ------------------------------------------------------- a healthy feed

{
    buildFeed(root, {
        artifacts: V1,
        manifests: { 'v0.333.1': Object.keys(V1) },
        pointers: { 'stable-linux.yml': updateInfo('0.333.1', Object.entries(V1)) },
    });
    const result = sweep(root);
    assert.deepEqual(result.findings, [], 'a clean feed reports nothing');
    assert.equal(result.checked, 2, 'both artifacts were hashed');
    assert.equal(result.pointers, 1, 'the yml was classified as a pointer, not an artifact');
    assert.match(result.signatureMode, /NOT gpg-verified/,
        'without --gpg-key the summary says so rather than implying the stronger check ran');
}

// ------------------------------------- the attack this tool exists for

{
    // Feed write access, used properly: upload a payload, then rewrite the
    // pointer to name it with a matching sha512. Every internal check of
    // that yml passes. What the attacker cannot forge is the manifest.
    buildFeed(root, {
        artifacts: { ...V1, 'xchain-wallet-0.333.1-evil.AppImage': 'malware' },
        manifests: { 'v0.333.1': Object.keys(V1) },
        pointers: {
            'stable-linux.yml': updateInfo('0.333.1',
                [['xchain-wallet-0.333.1-evil.AppImage', 'malware']]),
        },
    });
    const result = sweep(root);
    assert.ok(codes(result).includes('POINTER-UNCOVERED'),
        'a pointer naming a file no signed manifest covers is the headline finding');
    assert.ok(codes(result).includes('UNCOVERED'),
        'and the planted artifact is itself reported');
}

{
    // The cruder version: same filename, different bytes.
    buildFeed(root, {
        artifacts: V1,
        manifests: { 'v0.333.1': Object.keys(V1) },
        pointers: {},
    });
    writeFileSync(join(root, 'desktop', 'xchain-wallet-0.333.1-x86_64.AppImage'), 'swapped');
    const result = sweep(root);
    assert.deepEqual(codes(result), ['MISMATCH'], 'swapped bytes under a known name');
}

// --------------------------------------------- rollback must stay quiet

{
    // §7.4 move 1: restore the PREVIOUS release's pointer verbatim while
    // v2's binaries are still on the feed (§7.3 retention keeps 3). A
    // newest-manifest-only baseline calls every v1 file divergence, fires
    // during the incident it was built for, and teaches everyone to
    // ignore it. The union is what makes this quiet.
    buildFeed(root, {
        artifacts: { ...V1, ...V2 },
        manifests: { 'v0.333.1': Object.keys(V1), 'v0.333.2': Object.keys(V2) },
        pointers: { 'stable-linux.yml': updateInfo('0.333.1', Object.entries(V1)) },
    });
    const result = sweep(root);
    assert.deepEqual(result.findings, [],
        'a rolled-back pointer beside retained newer binaries is a correct state');
    assert.equal(result.manifests, 2, 'both manifests fed the baseline');
}

// ------------------------------------------------- the ordinary breakage

{
    // The §7.3 ordering failure, seen from the feed: a pointer went up
    // before the binary it names.
    buildFeed(root, {
        artifacts: V1,
        manifests: { 'v0.333.1': Object.keys(V1) },
        pointers: { 'stable-linux.yml': updateInfo('0.333.9', [['not-uploaded.AppImage', 'x']]) },
    });
    const result = sweep(root);
    assert.ok(codes(result).includes('POINTER-DANGLING'), 'a yml pointing at nothing');
    assert.ok(codes(result).includes('POINTER-NO-MANIFEST'),
        'and its version has no published manifest at all');
}

{
    // A pointer whose sha512 was edited but whose target is genuine.
    const body = updateInfo('0.333.1', Object.entries(V1))
        .replace(sha512b64('appimage-one'), sha512b64('something-else'));
    buildFeed(root, {
        artifacts: V1,
        manifests: { 'v0.333.1': Object.keys(V1) },
        pointers: { 'stable-linux.yml': body },
    });
    assert.deepEqual(codes(sweep(root)), ['POINTER-HASH'], 'edited hash, real target');
}

{
    buildFeed(root, {
        artifacts: V1,
        manifests: { 'v0.333.1': Object.keys(V1) },
        signed: false,
    });
    assert.deepEqual(codes(sweep(root)), ['MANIFEST-UNSIGNED'],
        'a manifest with no .asc is reported even though its hashes all check out');
}

// -------------------------------------------------- the signature anchor

{
    // Without --gpg-key the baseline is only as good as the directory: an
    // attacker who can write a payload can write a manifest covering it.
    // With it, a manifest signed by anything but K1 is refused ENTRY to
    // the baseline, so the payload it was planted to launder shows up.
    const K1 = 'AAAABBBBCCCCDDDDEEEEFFFF0000111122223333';
    const runGood = () => ({ stdout: `[GNUPG:] VALIDSIG ${K1} 2026-07-31\n`, status: 0 });
    const runAttacker = () => ({ stdout: '[GNUPG:] VALIDSIG 9999888877776666 2026\n', status: 0 });

    buildFeed(root, {
        artifacts: { ...V1, 'xchain-wallet-0.333.1-evil.AppImage': 'malware' },
        manifests: { 'v0.333.1': [...Object.keys(V1), 'xchain-wallet-0.333.1-evil.AppImage'] },
    });

    const trusting = sweep(root, { gpgKey: K1, run: runGood });
    assert.deepEqual(trusting.findings, [],
        'a K1-signed manifest covering every file is clean by construction');

    const anchored = sweep(root, { gpgKey: K1, run: runAttacker });
    assert.ok(codes(anchored).includes('MANIFEST-BAD-SIG'),
        'a manifest signed by another key is called out');
    assert.ok(codes(anchored).includes('UNCOVERED'),
        'and is kept OUT of the baseline, so the file it was planted to launder is '
        + 'still uncovered - a rejected manifest that still fed the union would make '
        + 'this sweep the attacker\'s alibi');
    assert.match(anchored.signatureMode, /gpg-verified/, 'the mode is stated in the summary');
}

{
    // gpg exits 0 for a good signature from an UNTRUSTED key, so reading
    // the exit status instead of VALIDSIG would accept exactly the case
    // this anchor exists to reject.
    const noStatus = () => ({ stdout: 'gpg: Good signature from "Someone Else"\n', status: 0 });
    assert.equal(verifyManifestSignature('/nonexistent', 'ABCD', noStatus), 'bad',
        'a zero exit with no VALIDSIG line is not a pass');
}

// ------------------------------------------------------------ manifests

{
    buildFeed(root, { artifacts: V1, manifests: { 'v0.333.1': Object.keys(V1) } });
    const parsed = parseManifest(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'));
    assert.equal(parsed.tag, 'v0.333.1', 'the tag comes from the signed header');
    assert.equal(parsed.entries.size, 2);
    assert.ok(parsed.entries.has('xchain-wallet-0.333.1-x86_64.AppImage'),
        'entries are keyed on basename: the manifest says ./name, the feed says desktop/name');
}

// -------------------------- the K1 fingerprint the world sees (row 137)
//
// K1 signs with a subkey, so VALIDSIG's first field is the SUBKEY while
// every document a user is handed - xchain.io/security, SECURITY.md, the
// verification recipe - publishes the PRIMARY. Matching only field 1 made
// the documented value the wrong one: driven against the live feed,
// `--gpg-key <primary>` reported MANIFEST-BAD-SIG on a genuine K1
// signature and dropped the manifest from the baseline with it.

{
    const K1_PRIMARY = '1A29E7C4C228F0E55D40A8C3B5B0E5ADAFDA7CE7';
    const K1_SUBKEY = '27A1593607C828903EF67DAD10ADF79899B41573';
    // The exact status line the live feed produces, fields and all.
    const validsig = () => ({
        status: 0,
        stdout: `[GNUPG:] GOODSIG 10ADF79899B41573 XChain Wallet Release Signing\n`
            + `[GNUPG:] VALIDSIG ${K1_SUBKEY} 2026-08-06 1786041697 0 4 0 22 10 00 ${K1_PRIMARY}\n`,
    });

    assert.equal(verifyManifestSignature(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'),
        K1_PRIMARY, validsig), 'ok',
    'the PRIMARY fingerprint verifies - it is the only one any document publishes');
    assert.equal(verifyManifestSignature(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'),
        K1_SUBKEY, validsig), 'ok',
    'and the signing subkey still verifies, for anyone who pinned that');

    // The property that must not be lost while widening the match: a
    // signature from a key that is not K1 is still rejected. An attacker
    // with their own key is exactly what this check exists for.
    const otherKey = () => ({
        status: 0,
        stdout: '[GNUPG:] VALIDSIG ' + 'B'.repeat(40) + ' 2026-08-06 1 0 4 0 22 10 00 '
            + 'C'.repeat(40) + '\n',
    });
    assert.equal(verifyManifestSignature(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'),
        K1_PRIMARY, otherKey), 'bad',
    'a good signature from someone else is still rejected on both fields');

    // The match is FULL-FINGERPRINT EQUALITY, never a suffix. A suffix
    // match let a configured short key id anchor the baseline to any key
    // whose fingerprint ended in those characters, and short-id collisions
    // are cheap to mint - so the sweep would have counted the collision
    // key's manifest into the union and swept the payload under it clean.
    assert.equal(verifyManifestSignature(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'),
        K1_PRIMARY.slice(-16), validsig), 'bad',
    'the last 16 characters of the real fingerprint are NOT the fingerprint');

    const collision = () => ({
        status: 0,
        stdout: '[GNUPG:] VALIDSIG ' + `0${'0'.repeat(23)}${K1_PRIMARY.slice(-16)}`
            + ' 2026-08-06 1 0 4 0 22 10 00 ' + `1${'1'.repeat(23)}${K1_PRIMARY.slice(-16)}`
            + '\n',
    });
    assert.equal(verifyManifestSignature(join(root, 'RELEASE_HASHES', 'v0.333.1.txt'),
        K1_PRIMARY.slice(-16), collision), 'bad',
    'and a 40-hex fingerprint that merely ENDS WITH the configured value is refused');
}

// --------------------------------- the CLI refuses a short --gpg-key
//
// Strict equality alone would turn a short id into MANIFEST-BAD-SIG on
// every manifest plus UNCOVERED on every file, which in a cron log reads
// as a compromised feed rather than as operator input the tool cannot use.
// One usage error is the readable failure, and it is verify.sh's stance
// for --key (verify.sh:372-378).

{
    const sweepScript = join(dirname(fileURLToPath(import.meta.url)),
        '..', '..', '..', 'tools', 'release', 'feed-sweep.mjs');
    const drive = (...args) => spawnSync(process.execPath, [sweepScript, '--root', root, ...args],
        { encoding: 'utf8' });

    const short = drive('--gpg-key', '99B41573');
    assert.equal(short.status, 2, 'a short key id is a usage error, not a wall of alarms');
    assert.match(short.stderr, /full 40-character fingerprint/,
        'and the refusal says what the flag actually wants');

    const empty = drive('--gpg-key');
    assert.equal(empty.status, 2,
        'the flag present with no value is the same error, never a silent downgrade '
        + 'to the unanchored mode');
}

// ------------------------------------- the android lane (row 136)
//
// The direct-APK lane is the only one that has ever published, and this
// sweep could not see it: PAYLOAD_DIRS listed desktop/extension/web, and
// the pointer test accepted only `.yml`. Measured on origin-host the hourly
// cron reported "0 artifact(s), 0 pointer(s), 1 manifest(s), 0 finding(s)"
// over a feed holding a published APK and its pointer - a clean report on
// an empty set, from the tool whose job is spotting a swapped binary.

{
    // A whole android lane, in the shape the real feed carries: the APK
    // covered by its signed manifest, and a JSON pointer naming the version.
    const apk = 'xchain-wallet-v0.336.0.apk';
    const bytes = 'apk-bytes';
    buildFeed(root, { artifacts: { [apk]: bytes }, manifests: { 'v0.336.0': [apk] } });
    mkdirSync(join(root, 'android'), { recursive: true });
    rmSync(join(root, 'desktop', apk));
    writeFileSync(join(root, 'android', apk), bytes);
    writeFileSync(join(root, 'android', 'latest.json'), '{"version":"0.336.0"}\n');

    const clean = sweep(root);
    assert.equal(clean.checked, 1, 'the published APK is hashed, not skipped');
    assert.equal(clean.pointers, 1, 'the JSON pointer is recognised as a pointer');
    assert.deepEqual(codes(clean), [], 'a feed that matches its signed manifest is clean');

    // The swap this tool exists to detect, on the only binary we ship.
    writeFileSync(join(root, 'android', apk), `${bytes}-tampered`);
    assert.deepEqual(codes(sweep(root)), ['MISMATCH'],
        'rewritten APK bytes are caught against the K1-signed manifest');
    writeFileSync(join(root, 'android', apk), bytes);

    // The pointer attack: send every direct install at a version no signed
    // manifest covers. The pointer names no bytes, so this is the whole of
    // what the JSON lane can check, and it is the check that matters.
    writeFileSync(join(root, 'android', 'latest.json'), '{"version":"9.9.9"}\n');
    assert.deepEqual(codes(sweep(root)), ['POINTER-NO-MANIFEST'],
        'a pointer moved to an unsigned version is caught');
    writeFileSync(join(root, 'android', 'latest.json'), '{"version":"0.336.0"}\n');

    // An extra binary appearing beside the real one.
    writeFileSync(join(root, 'android', 'xchain-wallet-v9.9.9.apk'), 'rogue');
    assert.deepEqual(codes(sweep(root)), ['UNCOVERED'],
        'an unmanifested file in the android lane is reported');
    rmSync(join(root, 'android', 'xchain-wallet-v9.9.9.apk'));

    // Carrying a version is what makes a JSON file a pointer. Without one it
    // is not an unparseable pointer, it is an unexplained file on the feed,
    // and it must be treated as payload rather than waved through.
    writeFileSync(join(root, 'android', 'latest.json'), '{}\n');
    const stripped = sweep(root);
    assert.equal(stripped.pointers, 0, 'a versionless JSON file is not a pointer');
    assert.deepEqual(codes(stripped), ['UNCOVERED'],
        'and it is reported as an uncovered file rather than ignored');
}

{
    // The lane list is the whole defect, so assert it by property rather
    // than by re-listing it: every directory the feed publishes into must
    // be swept. A future lane that ships without being added here is the
    // same bug again.
    assert.ok(PAYLOAD_DIRS.includes('android'),
        'the only lane that has ever published must be one the sweep walks');
}

rmSync(root, { recursive: true, force: true });
console.log('feed-sweep.smoke.js: ok (including the row 136 android lane: '
    + 'the published APK is hashed against its signed manifest and the JSON '
    + 'update pointer is checked, neither of which this sweep could see)');
