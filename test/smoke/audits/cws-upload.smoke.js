/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

// test/smoke/audits/cws-upload.smoke.js - the Chrome Web Store upload tool
// refuses everything it should (D4, row 6).
//
// WHAT THIS IS PROTECTING, because it is not the upload.
//
// D4 was recommended NOT YET for two stages: console uploads work, and an
// OAuth credential that can publish to the store is functionally the
// publisher account, which is the credential the dominant real-world
// extension compromise steals. The operator chose to build it anyway on
// 2026-08-06, so the credential now exists and the mitigations are all this
// tool's REFUSALS. A refusal that quietly stops refusing is the entire risk,
// and it would look exactly like a working tool.
//
// So every assertion here drives a path that must FAIL. The happy path is
// deliberately not tested end to end: doing that needs a live credential and
// a real store item, and a test that uploads to the Chrome Web Store on every
// CI run is a worse idea than an untested success branch.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const walletRoot = join(here, '..', '..', '..');
const TOOL = join(walletRoot, 'tools', 'release', 'cws-upload.mjs');
const ITEM = 'abcdefghijklmnopabcdefghijklmnop';

const {
    parseArgs, checkPublishTarget, credentialState, hashFromManifest, headerField, checkProvenance,
    Refusal, PUBLISH_TARGETS,
} = await import(TOOL);

/** Run the tool as an operator would, and report what they would see. */
function run(args, env = {}) {
    try {
        const stdout = execFileSync('node', [TOOL, ...args], {
            encoding: 'utf8',
            // A deliberately EMPTY credential environment by default: the
            // machine running this suite may legitimately hold the real ones,
            // and a test whose verdict depends on that is not a test.
            env: { ...process.env, CWS_CLIENT_ID: '', CWS_CLIENT_SECRET: '', CWS_REFRESH_TOKEN: '', ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, out: stdout };
    } catch (err) {
        return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
}

// --- 1. --help, which section 13 of the ceremony gate also requires -------
{
    const r = run(['--help']);
    assert.equal(r.code, 0, 'FAIL: --help must exit 0. This tool is typed by an operator mid-ceremony and '
        + 'its first answer must never be a refusal.');
    assert.match(r.out, /Usage:/, 'FAIL: --help printed no usage.');
    assert.match(r.out, /CWS_CLIENT_ID/,
        'FAIL: --help does not name the credentials it needs, which is the one thing the operator is '
        + 'reaching for when they type it.');
}

// --- 2. A credential is never printed, ever ------------------------------
//
// The strongest property this tool has, and the cheapest to lose: someone
// adds a debug line to diagnose a failing exchange, and a refresh token that
// can publish to the store lands in a CI log that many people can read.
//
// THE FIRST CUT OF THIS CHECK COVERED ONE PATH AND WAS WORTH ALMOST NOTHING,
// which a mutation caught rather than a review: a deliberate leak injected
// into the missing-`--zip` branch was not detected, because this test always
// passed a `--zip` value and never reached that branch. A canary is only as
// good as the set of exits it walks, so it now walks every exit an operator
// can hit with credentials in the environment, including the one where the
// credentials are actually USED.
{
    const canaries = {
        CWS_CLIENT_ID: 'CANARY-CLIENT-ID', CWS_CLIENT_SECRET: 'CANARY-SECRET',
        CWS_REFRESH_TOKEN: 'CANARY-REFRESH-TOKEN',
    };
    const dir = mkdtempSync(join(tmpdir(), 'cws-canary-'));
    try {
        const zip = join(dir, 'xchain-wallet-extension-v9.9.9.zip');
        writeFileSync(zip, 'bytes');
        writeFileSync(join(dir, 'RELEASE_HASHES.txt'),
            `# tag: v9.9.9\n${createHash('sha256').update('bytes').digest('hex')}  `
            + 'xchain-wallet-extension-v9.9.9.zip\n');

        const exits = [
            ['no arguments at all', []],
            ['missing --zip', ['--item-id', ITEM]],
            ['missing --item-id', ['--zip', zip]],
            ['a flag with no value', ['--item-id']],
            ['an unknown argument', ['--item-id', ITEM, '--zip', zip, '--publsh', 'x']],
            // Every row below the --tag row must actually PASS --tag, or the
            // run stops at the required-argument check and the branch the row
            // is named for never executes. A canary is only as good as the
            // set of exits it walks, and a new required flag silently empties
            // that set.
            ['a missing --tag', ['--item-id', ITEM, '--zip', zip]],
            ['an unknown publish target',
                ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.9', '--publish', 'production']],
            ['the public-publish guard',
                ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.9', '--publish', 'default']],
            ['a missing manifest',
                ['--item-id', ITEM, '--zip', '/nonexistent/x.zip', '--tag', 'v9.9.9']],
            ['an unsigned manifest', ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.9']],
            ['a manifest for another release',
                ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.8', '--allow-unsigned']],
            // The one that matters most: credentials present, every check
            // passed, and the run stops right where they would be used.
            ['a successful dry run',
                ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.9', '--allow-unsigned', '--dry-run']],
            // And the live token exchange, pointed at a host that cannot
            // answer, so the failure path that HANDLES the credentials runs.
            ['a failed token exchange',
                ['--item-id', ITEM, '--zip', zip, '--tag', 'v9.9.9', '--allow-unsigned']],
        ];

        for (const [label, args] of exits) {
            const r = run(args, canaries);
            for (const [name, value] of Object.entries(canaries)) {
                assert.ok(!r.out.includes(value),
                    `FAIL: the tool printed ${name} on the "${label}" path. A credential that can publish to `
                    + 'the Chrome Web Store is the publisher account for practical purposes, and a CI log is '
                    + 'read by more people than the console is. Report whether a credential is PRESENT, never '
                    + `what it is.\n  output was: ${r.out.slice(0, 400)}`);
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// --- 3. Missing credentials are a config error, named ---------------------
{
    const { ok, missing } = credentialState({});
    assert.equal(ok, false);
    assert.deepEqual(missing, ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']);
    // Empty string is missing, not present. An exported-but-blank variable is
    // the ordinary shape of a broken CI secret, and treating it as set turns a
    // clear refusal into a confusing 400 from the store.
    assert.equal(credentialState({
        CWS_CLIENT_ID: 'x', CWS_CLIENT_SECRET: '  ', CWS_REFRESH_TOKEN: 'z',
    }).ok, false, 'FAIL: a blank credential counted as present.');
}

// --- 4. The public-publish guard -----------------------------------------
{
    assert.throws(() => checkPublishTarget('default', false), (err) => err instanceof Refusal && err.code === 1,
        'FAIL: publishing PUBLICLY without --yes-really-public was allowed. The first submission is unlisted '
        + 'by rule and every later release soaks in the beta item first, so this can never be the easy path.');
    // And the flag has to actually work, or the guard is just a wall.
    assert.doesNotThrow(() => checkPublishTarget('default', true));
    assert.doesNotThrow(() => checkPublishTarget('trustedTesters', false));
    assert.throws(() => checkPublishTarget('production', false), (err) => err.code === 2,
        'FAIL: an unknown publish target was accepted. A typo must not fall back to something plausible.');
    assert.deepEqual(PUBLISH_TARGETS, ['trustedTesters', 'default']);
}

// --- 5. Argument parsing refuses rather than guessing --------------------
{
    assert.throws(() => parseArgs(['--item-id']), (err) => err.code === 2,
        'FAIL: a flag with no value was accepted.');
    assert.throws(() => parseArgs(['--zip', '--dry-run']), (err) => err.code === 2,
        'FAIL: the next flag was swallowed as a value, so --zip would be the string "--dry-run".');
    assert.equal(parseArgs(['--tag', 'v0.336.0']).tag, 'v0.336.0',
        'FAIL: --tag was not parsed. It is the release anchor, so a dropped value would silently '
        + 'restore the unanchored gate.');
    assert.throws(() => parseArgs(['--tag']), (err) => err.code === 2,
        'FAIL: --tag with no value was accepted.');
    assert.throws(() => parseArgs(['--publsh', 'x']), (err) => err.code === 2,
        'FAIL: an unknown argument was ignored. A misspelled --publish that is silently dropped uploads '
        + 'without publishing and reads as a store problem.');
}

// --- 6. The provenance gate, which is why this tool is safe to have ------
{
    const dir = mkdtempSync(join(tmpdir(), 'cws-prov-'));
    try {
        const zip = join(dir, 'xchain-wallet-extension-v9.9.9.zip');
        writeFileSync(zip, 'pretend release bytes');
        const good = createHash('sha256').update('pretend release bytes').digest('hex');
        const manifest = join(dir, 'RELEASE_HASHES.txt');
        const write = (hash) => writeFileSync(manifest,
            `# XChain Wallet release manifest\n# tag: v9.9.9\n${hash}  xchain-wallet-extension-v9.9.9.zip\n`);

        const TAG = 'v9.9.9';

        // (a) no manifest at all
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: join(dir, 'absent.txt'), tag: TAG, allowUnsigned: true,
            }),
            (err) => err instanceof Refusal && /no release manifest/.test(err.message),
            'FAIL: an upload with NO release manifest was allowed. That is the whole provenance chain gone.');

        // (b) manifest present, signature absent, no flag
        write(good);
        await assert.rejects(
            checkProvenance({ zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: false }),
            (err) => /no detached signature/.test(err.message),
            'FAIL: an unsigned manifest was accepted without --allow-unsigned.');

        // (c) the flag is honoured, so the refusal is a gate and not a wall
        const ok = await checkProvenance({
            zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: true,
        });
        assert.equal(ok.sha256, good);
        assert.equal(ok.signed, false);
        assert.equal(ok.release, TAG, 'the gate reports which release it anchored to');

        // (c2) THE GATE HANDS BACK THE BYTES IT HASHED, which is the only
        // thing that makes the upload the checked artifact rather than a
        // second read of the same filename. Swapping the file on disk here
        // plays the writer that the OAuth round trip in main() leaves room
        // for; the buffer must not move with it.
        writeFileSync(zip, 'a neighbour rebuilt this mid-upload');
        assert.equal(createHash('sha256').update(ok.bytes).digest('hex'), good,
            'FAIL: the gate did not hand back the bytes it hashed, so the upload can only re-read the '
            + 'path and the K1-signed hash covers a different read than the one that ships.');
        writeFileSync(zip, 'pretend release bytes');

        // (d) the artifact is not in the manifest
        writeFileSync(manifest, `# tag: v9.9.9\n${good}  some-other-artifact.zip\n`);
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: true,
            }),
            (err) => /is not listed in/.test(err.message),
            'FAIL: a zip absent from the manifest was accepted.');

        // (e) TAMPER: the manifest describes this filename, with another hash
        write('0'.repeat(64));
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: true,
            }),
            (err) => /does not match the hash/.test(err.message),
            'FAIL: bytes that do not match the signed manifest were accepted for upload. This is the '
            + 'assertion the whole tool exists for.');

        // --- the release anchor -----------------------------------------
        //
        // (f) THE STALE-BUT-SIGNED SHAPE, which is the one thing the two
        // checks above cannot see. The zip and the manifest here agree with
        // each other perfectly - same name, same hash, same tag - and they
        // are simply a PREVIOUS release. Every check but the anchor passes.
        write(good);
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: manifest, tag: 'v9.9.10', allowUnsigned: true,
            }),
            (err) => err instanceof Refusal && /describes v9\.9\.9, but you named v9\.9\.10/
                .test(err.message),
            'FAIL: a previous release\'s zip and its own genuinely-signed manifest were accepted for '
            + 'upload. They hash-check and signature-check perfectly, which is exactly why the anchor '
            + 'has to come from outside the pair.');

        // (g) A RE-SIGNATURE satisfies a request for the release it corrects.
        writeFileSync(manifest,
            `# XChain Wallet release manifest\n# tag: v9.9.9-resign1\n${good}  `
            + 'xchain-wallet-extension-v9.9.9.zip\n');
        const resigned = await checkProvenance({
            zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: true,
        });
        assert.equal(resigned.release, 'v9.9.9-resign1',
            'a re-signature of v9.9.9 answers a request for v9.9.9');

        // (h) ONE WAY ONLY: the superseded original does NOT satisfy a
        // request for the re-signature, or fetching the correction and being
        // handed the false one would verify.
        write(good);
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: manifest, tag: 'v9.9.9-resign1', allowUnsigned: true,
            }),
            (err) => /describes v9\.9\.9, but you named v9\.9\.9-resign1/.test(err.message),
            'FAIL: the superseded original passed as its own re-signature.');

        // (i) `verify.sh --recompute` stamps `(none)` to say it describes no
        // release. That is a value to refuse, never one to match.
        writeFileSync(manifest, `# tag: (none)\n${good}  xchain-wallet-extension-v9.9.9.zip\n`);
        await assert.rejects(
            checkProvenance({
                zipPath: zip, manifestPath: manifest, tag: TAG, allowUnsigned: true,
            }),
            (err) => /names no release/.test(err.message),
            'FAIL: a locally recomputed manifest passed as a release manifest.');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// --- 7. Manifest parsing handles the real format -------------------------
{
    const real = '# XChain Wallet release manifest\n# tag: v0.336.0\n'
        + `${'a'.repeat(64)}  xchain-wallet-extension-v0.336.0.zip\n`
        + `${'b'.repeat(64)}  xchain-wallet-web-v0.336.0.tar.gz\n`;
    assert.equal(hashFromManifest(real, 'xchain-wallet-extension-v0.336.0.zip'), 'a'.repeat(64));
    // An absolute path must resolve to the same row: the manifest records
    // names as staged and the caller passes a path.
    assert.equal(hashFromManifest(real, '/somewhere/else/xchain-wallet-web-v0.336.0.tar.gz'), 'b'.repeat(64));
    assert.equal(hashFromManifest(real, 'not-in-there.zip'), null);
    // A comment line that happens to contain a hash-shaped token is not a row.
    assert.equal(hashFromManifest(`# ${'c'.repeat(64)}  decoy.zip\n`, 'decoy.zip'), null,
        'FAIL: a commented line was read as a manifest row.');

    // The header fields the anchor and the coverage line read. They are the
    // SIGNED half of the document, so reading them is reading a claim the
    // release key made, not a label.
    assert.equal(headerField(real, 'tag'), 'v0.336.0');
    assert.equal(headerField(real, 'lanes'), '', 'a whole-release manifest declares no lane subset');
    assert.equal(headerField('# coverage: partial\n# lanes: mac, linux\n', 'lanes'), 'mac, linux');
}

console.log('OK: cws-upload smoke (D4: --help exits 0 and names its credentials, no credential value'
    + 'is ever printed, blank credentials count as missing, public publish needs saying twice, unknown '
    + 'targets and arguments refuse rather than guess, and the provenance gate refuses a missing manifest, '
    + 'an unsigned one, an unlisted artifact, tampered bytes, and a manifest that belongs to another '
    + 'release - including the stale-but-signed pair that agrees with itself, with the re-sign rule '
    + 'accepted one way only)');
