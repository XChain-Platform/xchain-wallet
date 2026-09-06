// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// deploy-web.sh must verify the tarball BEFORE it extracts anything.
//
// WHAT THIS PINS, and why a source grep is not it. Until 2026-08-15 this
// script checked its inputs for existence and for an index.html and then
// unpacked whatever it was handed, so any tarball with an entry point went
// live: a fresh local rebuild, a stale one from another version, or a
// tampered one. The gap was driven with a control rather than read - an
// ATTACKER-REBUILD tarball deployed cleanly, exited 0, and served
// `<html>ATTACKER REBUILD</html>` from `current/index.html`.
//
// The fix landed unpinned, which is what this file is for. The only existing
// coverage of this script (release-tools.smoke.js) greps its SOURCE for the
// strings `mv -T` and `index.html`, and a source-reading test is exactly what
// stayed green through S37's wrong-key hole in verify.sh. So every case here
// runs the real script against a real tarball and a real manifest, and the
// refusals are checked at the FILESYSTEM: a refusal that still created the
// release directory would mean bytes nobody signed were unpacked, which is
// the event this step exists to prevent.
//
// The hash-and-anchor cases run with --no-sig so they hold on any machine.
// The signature cases need gpg and take the documented skip, the same shape
// release-verify-signer.smoke.js uses; the tamper refusal itself never skips.

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const DEPLOY = join(root, 'tools', 'release', 'deploy-web.sh');

const TAG = 'v9.9.9';
const TARBALL_NAME = `xchain-wallet-web-${TAG}.tar.gz`;
const GENUINE_MARKER = '<html>GENUINE RELEASE</html>';
const ATTACKER_MARKER = '<html>ATTACKER REBUILD</html>';

const work = mkdtempSync(join(tmpdir(), 'xc1513-deploy-'));

const failures = [];
const check = (what, ok, detail = '') => {
    if (ok) return;
    failures.push(`${what}${detail ? `\n    ${detail.trim().split('\n').slice(-8).join('\n    ')}` : ''}`);
};

/** Build a web tarball whose index.html carries `marker`, and return its path. */
function buildTarball(dir, marker) {
    const staging = join(dir, 'staging');
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, 'assets'), { recursive: true });
    writeFileSync(join(staging, 'index.html'), `${marker}\n`);
    writeFileSync(join(staging, 'assets', 'app-deadbeef.js'), `// ${marker}\n`);
    const tarball = join(dir, TARBALL_NAME);
    execFileSync('tar', ['-czf', tarball, '-C', staging, '.']);
    return tarball;
}

/**
 * A manifest in the shape verify.sh requires: header, artifact count, a build
 * profile for every hashed row, and the sha256 of the file beside it.
 */
function writeManifest(dir, tarball, { hash = null, tag = TAG } = {}) {
    const sha = hash || createHash('sha256').update(readFileSync(tarball)).digest('hex');
    const manifest = join(dir, 'RELEASE_HASHES.txt');
    writeFileSync(manifest, [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        `# tag: ${tag}`,
        '# tag-commit: 0000000000000000000000000000000000000000',
        '# built: 2026-01-01T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        `# profile default: ./${TARBALL_NAME}`,
        `${sha}  ./${TARBALL_NAME}`,
        '',
    ].join('\n'));
    return manifest;
}

/** A webroot nobody has deployed into yet. */
let webrootSeq = 0;
function freshWebroot() {
    webrootSeq += 1;
    const dir = join(work, `webroot-${webrootSeq}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function deploy({ tarball, manifest, webroot, tag = TAG, extra = [], env = {} }) {
    const args = [DEPLOY, '--tarball', tarball, '--manifest', manifest, '--tag', tag,
        '--webroot', webroot, ...extra];
    return spawnSync('bash', args, { encoding: 'utf8', env: { ...process.env, ...env } });
}

/**
 * Nothing was unpacked and nothing was flipped. Checked at the filesystem
 * rather than from the exit code, because the failure this pins is bytes on
 * disk: a refusal that had already extracted would still be serving them.
 */
function nothingDeployed(label, webroot, result) {
    check(`${label}: exits non-zero`, result.status !== 0,
        `status=${result.status}\n${result.stderr}`);
    check(`${label}: the release directory was never created`,
        !existsSync(join(webroot, 'releases', TAG)),
        `${join(webroot, 'releases', TAG)} exists, so the tarball was extracted before it was checked`);
    check(`${label}: the live symlink was never created`, !existsSync(join(webroot, 'current')));
}

try {
    // --- 1. CONTROL: the genuine tarball deploys ------------------------
    //
    // First, because a refusal test that would also refuse the real release
    // proves nothing. This is the case that makes every refusal below a gate
    // rather than a wall.
    const genuineDir = join(work, 'genuine');
    mkdirSync(genuineDir);
    const genuine = buildTarball(genuineDir, GENUINE_MARKER);
    const genuineManifest = writeManifest(genuineDir, genuine);
    {
        const webroot = freshWebroot();
        const r = deploy({ tarball: genuine, manifest: genuineManifest, webroot, extra: ['--no-sig'] });
        check('CONTROL: the signed tarball deploys', r.status === 0, r.stderr);
        const served = join(webroot, 'current', 'index.html');
        check('CONTROL: the live symlink serves the release', existsSync(served)
            && readFileSync(served, 'utf8').includes(GENUINE_MARKER),
        existsSync(served) ? readFileSync(served, 'utf8') : 'current/index.html absent');
    }

    // --- 2. THE FINDING: an ATTACKER REBUILD is refused before extraction
    //
    // Same filename, same manifest, different bytes: the exact artifact the
    // pre-fix control deployed cleanly. A rebuilt-after-signing tarball is
    // byte-for-byte this case, which is why one input covers both.
    const tamperDir = join(work, 'tampered');
    mkdirSync(tamperDir);
    const attacker = buildTarball(tamperDir, ATTACKER_MARKER);
    // The manifest describes the GENUINE bytes; only the tarball was swapped.
    const tamperManifest = writeManifest(tamperDir, genuine);
    {
        const webroot = freshWebroot();
        const r = deploy({ tarball: attacker, manifest: tamperManifest, webroot, extra: ['--no-sig'] });
        nothingDeployed('TAMPER', webroot, r);
        check('TAMPER: the operator is told the tarball did not verify',
            /did not verify against/.test(r.stderr), r.stderr);
        check('TAMPER: and that nothing was unpacked, so the site is untouched',
            /Nothing was unpacked/.test(r.stderr), r.stderr);
        // Not implied by the two checks above: a partial extraction into some
        // other path under the webroot would still be bytes on the host.
        const hits = spawnSync('grep', ['-rl', 'ATTACKER REBUILD', webroot], { encoding: 'utf8' });
        check('TAMPER: the attacker marker was never written anywhere under the webroot',
            !(hits.stdout || '').trim(), hits.stdout || '');
    }

    // --- 3. A dry run is a preflight, not an echo -----------------------
    //
    // --dry-run must verify too. If it only printed a plan, the rehearsal an
    // operator does before the live flip would pass on bytes the flip then
    // refuses, or worse, would not refuse.
    {
        const webroot = freshWebroot();
        const r = deploy({
            tarball: attacker, manifest: tamperManifest, webroot, extra: ['--no-sig', '--dry-run'],
        });
        nothingDeployed('TAMPER --dry-run', webroot, r);
    }

    // --- 4. Another release's manifest cannot satisfy this deploy -------
    {
        const webroot = freshWebroot();
        const r = deploy({ tarball: genuine, manifest: genuineManifest, webroot, tag: 'v9.9.8',
            extra: ['--no-sig'] });
        nothingDeployed('WRONG TAG', webroot, r);
    }

    // --- 5. A tarball no manifest describes -----------------------------
    {
        const strayDir = join(work, 'stray');
        mkdirSync(strayDir);
        const stray = buildTarball(strayDir, GENUINE_MARKER);
        const otherManifest = join(strayDir, 'RELEASE_HASHES.txt');
        writeFileSync(otherManifest, [
            '# XChain Wallet release manifest', '# manifest-version: 2', `# tag: ${TAG}`,
            '# tag-commit: 0000000000000000000000000000000000000000',
            '# built: 2026-01-01T00:00:00Z', '# dev-mock-gate: enforced', '# artifacts: 1',
            '# profile default: ./some-other-artifact.zip',
            `${'0'.repeat(64)}  ./some-other-artifact.zip`, '',
        ].join('\n'));
        const webroot = freshWebroot();
        const r = deploy({ tarball: stray, manifest: otherManifest, webroot, extra: ['--no-sig'] });
        nothingDeployed('UNLISTED ARTIFACT', webroot, r);
    }

    // --- 5b. A headerless manifest cannot answer for a release ----------
    //
    // Held back with the verify.sh change it exercises, not dropped. Strip
    // the `# ` header off a manifest and the hash rows still cover the
    // tarball perfectly, so verify.sh's headerless branch warns and exits 0
    // under --no-sig with --tag never read. Deployment forwards --tag on
    // every call and deploy-web.sh's own header promises that under --no-sig
    // "the hash and the anchor are still checked", so the anchor half of that
    // promise is false on the one effector that flips a live site.
    //
    // The refusal cannot ship yet: editing verify.sh moves it off the sha256
    // the release rehearsal pin records, and re-driving that rehearsal is an
    // operator step on the release machine. Asserting the refusal before it
    // exists reddens this gate on every push, so the case travels with the
    // change instead. Restore both halves in one commit when the pin moves.

    // --- 6. There is no way to deploy without a manifest ----------------
    //
    // The refusal has to be the ABSENCE of a bypass, not a flag nobody is
    // meant to type: --manifest is required, and --no-sig forwards to
    // verify.sh's degraded mode rather than skipping the hash.
    {
        const webroot = freshWebroot();
        const r = spawnSync('bash', [DEPLOY, '--tarball', genuine, '--tag', TAG, '--webroot', webroot],
            { encoding: 'utf8' });
        nothingDeployed('NO MANIFEST', webroot, r);
        check('NO MANIFEST: exits 2 as a usage error', r.status === 2, `status=${r.status}`);
        check('NO MANIFEST: says why a manifest is not optional',
            /--manifest <path> is required/.test(r.stderr), r.stderr);
    }
    {
        const src = readFileSync(DEPLOY, 'utf8');
        check('there is no flag that skips the manifest check',
            !/--(skip|no)-verify|--force\b/.test(src),
            'deploy-web.sh grew a bypass flag; the manifest check is the whole step');
    }

    // --- 6b. The bytes that were HASHED are the bytes that are UNPACKED --
    //
    // Verifying before extracting is not the same property as extracting
    // what was verified. Until 2026-09-05 the script handed verify.sh the
    // tarball's own directory and then re-opened that path with tar, so a
    // writer who replaced the file between the two reads had the gate pass
    // on the release and the site serve the replacement - and every case
    // above stayed green, because each of them tampers BEFORE the check.
    //
    // Driven, not grepped, and driven WITHOUT a sleep: the script is run
    // from a scratch directory whose verify.sh is a stand-in that runs the
    // real one and then performs the swap, which puts the writer exactly in
    // the window rather than near it. `HERE` is how deploy-web.sh finds
    // verify.sh and is the only thing it takes from its own directory.
    {
        const raceDir = join(work, 'race');
        mkdirSync(raceDir, { recursive: true });
        const victim = buildTarball(raceDir, GENUINE_MARKER);
        const raceManifest = writeManifest(raceDir, victim);

        const attackerDir = join(work, 'race-replacement');
        mkdirSync(attackerDir, { recursive: true });
        const replacement = buildTarball(attackerDir, ATTACKER_MARKER);

        const harness = join(work, 'race-harness');
        mkdirSync(harness, { recursive: true });
        copyFileSync(DEPLOY, join(harness, 'deploy-web.sh'));
        writeFileSync(join(harness, 'verify.sh'), [
            '#!/usr/bin/env bash',
            '# A stand-in for verify.sh that runs the real one and then plays',
            '# the concurrent writer, replacing the caller-named tarball the',
            '# instant the check has passed. Deterministic where a sleep is',
            '# not: the swap lands inside the window rather than near it.',
            'bash "$RACE_REAL_VERIFY" "$@"',
            'rc=$?',
            'cp "$RACE_REPLACEMENT" "$RACE_VICTIM"',
            'exit $rc',
            '',
        ].join('\n'));

        const webroot = freshWebroot();
        const r = spawnSync('bash', [join(harness, 'deploy-web.sh'), '--tarball', victim,
            '--manifest', raceManifest, '--tag', TAG, '--webroot', webroot, '--no-sig'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                RACE_REAL_VERIFY: join(root, 'tools', 'release', 'verify.sh'),
                RACE_REPLACEMENT: replacement,
                RACE_VICTIM: victim,
            },
        });

        // The harness has to have actually raced, or the three checks below
        // are a green that never had anything to catch.
        check('RACE: the stand-in really did replace the tarball after the check',
            readFileSync(victim).equals(readFileSync(replacement)),
            'the swap never happened, so this case proves nothing');

        check('RACE: the deploy still succeeds on the release it verified',
            r.status === 0, `status=${r.status}\n${r.stderr}`);
        const served = join(webroot, 'current', 'index.html');
        check('RACE: and it is the VERIFIED bytes that are live, not the replacement',
            existsSync(served) && readFileSync(served, 'utf8').includes(GENUINE_MARKER),
            existsSync(served) ? readFileSync(served, 'utf8') : 'current/index.html absent');
        const hits = spawnSync('grep', ['-rl', 'ATTACKER REBUILD', webroot], { encoding: 'utf8' });
        check('RACE: the replacement marker reached nothing under the webroot',
            !(hits.stdout || '').trim(), hits.stdout || '');
    }

    // --- 7. The signature path, where gpg is available ------------------
    //
    // --no-sig above checks the bytes and not who signed them. This block
    // drives the default path: a real detached signature, bound to a real
    // fingerprint, over a manifest that is then left alone or tampered with.
    if (spawnSync('gpg', ['--version'], { encoding: 'utf8' }).status === 0) {
        const gnupg = join(work, 'gnupg');
        mkdirSync(gnupg, { mode: 0o700 });
        const gpgEnv = { ...process.env, GNUPGHOME: gnupg };
        const gpg = (...args) => execFileSync('gpg', ['--batch', '--quiet', ...args],
            { env: gpgEnv, encoding: 'utf8' });
        try {
            // K1's real shape: a certify-only primary with a signing subkey,
            // so the fingerprint published to users is not the one that signs.
            gpg('--passphrase', '', '--quick-generate-key',
                'XC1513 Release <release@example.invalid>', 'ed25519', 'cert', '0');
            const fprs = (uid) => {
                const lines = gpg('--list-keys', '--with-colons', uid).split('\n');
                const primary = lines.find((l) => l.startsWith('fpr:'))?.split(':')[9];
                const subIdx = lines.findIndex((l) => l.startsWith('sub:'));
                return { primary, sub: subIdx === -1 ? null : lines[subIdx + 1]?.split(':')[9] ?? null };
            };
            gpg('--passphrase', '', '--quick-add-key', fprs('release@example.invalid').primary,
                'ed25519', 'sign', '0');
            const K1 = fprs('release@example.invalid');
            gpg('--passphrase', '', '--quick-generate-key',
                'XC1513 Other <other@example.invalid>', 'ed25519', 'sign', '0');
            const OTHER = fprs('other@example.invalid');

            const signedDir = join(work, 'signed');
            mkdirSync(signedDir);
            const tarball = buildTarball(signedDir, GENUINE_MARKER);
            const manifest = writeManifest(signedDir, tarball);
            gpg('--yes', '--local-user', K1.primary, '--armor', '--detach-sign',
                '--output', `${manifest}.asc`, manifest);

            // (a) the genuine, signed release deploys, named by the PRIMARY
            //     fingerprint a user reads while the SUBKEY made the signature.
            {
                const webroot = freshWebroot();
                const r = deploy({ tarball, manifest, webroot,
                    env: { ...gpgEnv, XCHAIN_VERIFY_KEY: K1.primary } });
                check('SIGNED: the genuine release deploys under the published primary fingerprint',
                    r.status === 0, r.stderr);
                check('SIGNED: and it is the signed bytes that are live',
                    existsSync(join(webroot, 'current', 'index.html'))
                    && readFileSync(join(webroot, 'current', 'index.html'), 'utf8')
                        .includes(GENUINE_MARKER));
            }

            // (b) the same signed manifest, tampered tarball.
            {
                const webroot = freshWebroot();
                const swapped = join(work, 'swapped');
                mkdirSync(swapped, { recursive: true });
                const bad = buildTarball(swapped, ATTACKER_MARKER);
                writeFileSync(join(swapped, 'RELEASE_HASHES.txt'), readFileSync(manifest));
                writeFileSync(join(swapped, 'RELEASE_HASHES.txt.asc'), readFileSync(`${manifest}.asc`));
                const r = deploy({ tarball: bad, manifest: join(swapped, 'RELEASE_HASHES.txt'),
                    webroot, env: { ...gpgEnv, XCHAIN_VERIFY_KEY: K1.primary } });
                nothingDeployed('SIGNED + TAMPER', webroot, r);
            }

            // (c) a GOOD signature from the WRONG KEY. gpg exits 0 for this,
            //     which is why the exit code is never what is read.
            {
                const wrongDir = join(work, 'wrong-key');
                mkdirSync(wrongDir);
                const t = buildTarball(wrongDir, GENUINE_MARKER);
                const m = writeManifest(wrongDir, t);
                gpg('--yes', '--local-user', OTHER.primary, '--armor', '--detach-sign',
                    '--output', `${m}.asc`, m);
                const webroot = freshWebroot();
                const r = deploy({ tarball: t, manifest: m, webroot,
                    env: { ...gpgEnv, XCHAIN_VERIFY_KEY: K1.primary } });
                nothingDeployed('SIGNED BY THE WRONG KEY', webroot, r);
            }

            // (d) a ZERO-BYTE .asc. The existence of a signature file is not a
            //     signature; this is the sibling of the cws-upload.mjs hole.
            {
                const emptyDir = join(work, 'empty-asc');
                mkdirSync(emptyDir);
                const t = buildTarball(emptyDir, GENUINE_MARKER);
                const m = writeManifest(emptyDir, t);
                writeFileSync(`${m}.asc`, '');
                const webroot = freshWebroot();
                const r = deploy({ tarball: t, manifest: m, webroot,
                    env: { ...gpgEnv, XCHAIN_VERIFY_KEY: K1.primary } });
                nothingDeployed('ZERO-BYTE SIGNATURE', webroot, r);
            }
        } finally {
            spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env: gpgEnv });
        }
    } else if (process.env.CI) {
        // A SKIP IS A PASS EVERYWHERE ELSE AND MUST NOT BE ONE HERE: these refusals
        // must run on a RUNNER, not only the release machine, or a runner that
        // quietly lost gpg would report green with the signature cases never
        // executed.
        check('CI: the SIGNED cases ran rather than skipping', false,
            'gpg is not on PATH on this runner, so the signature refusals were not driven. '
            + 'Install gnupg in the workflow rather than letting the skip stand.');
    } else {
        process.stderr.write('deploy-web-provenance.smoke.js: gpg is not installed, so the SIGNED '
            + 'cases were not run. The hash and anchor refusals above still ran.\n');
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`FAIL deploy-web-provenance.smoke.js: ${failures.length} check(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('PASS deploy-web-provenance.smoke.js (deploy-web.sh verifies the tarball '
    + 'against the signed manifest before it extracts anything, so a rebuilt or tampered tarball, '
    + 'another release\'s manifest, an unlisted artifact, a missing manifest, a wrong-key signature '
    + 'and a zero-byte .asc all leave the webroot untouched)');
