// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §51 / G003 /  §6: `tools/release/` signing pipeline.
//
// Two halves. The first pins the scaffolding shape so a future edit
// cannot silently drop a piece. The second RUNS the pipeline against a
// throwaway git repo and a staged artifact set, because every gate here
// exists to refuse something, and a gate is only real if something has
// watched it refuse. Each negative case below is a way a release could
// be signed while being wrong; asserting the failure is the point, and
// asserting it by exit code alone is not enough (a gate that fails for
// the wrong reason still "fails").

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ---------------------------------------------------------------- shape

const files = [
    'tools/release/README.md',
    'tools/release/lib.sh',
    'tools/release/sign.sh',
    'tools/release/verify.sh',
    'tools/release/expected-artifacts.txt',
    'tools/release/publish.sh',
    'tools/release/deploy-web.sh',
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

//  S6. These two encode ordering rules whose violation is
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
// The mobile names were missing from the convention ( §3); both
// shells are dormant, so the doc is the only place they are pinned until
//  /  ship.
assert.ok(/xchain-wallet-android-vX\.Y\.Z\.aab/.test(readme),
    'README pins the Android artifact name');
assert.ok(/xchain-wallet-ios-vX\.Y\.Z\.ipa/.test(readme),
    'README pins the iOS artifact name');

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
//  §7.1. lib.sh no longer decides which files are channel pointers;
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
assert.ok(/gpg --verify/.test(verifySrc), 'verify.sh runs gpg --verify');
assert.ok(/--no-sig/.test(verifySrc) && /--recompute/.test(verifySrc),
    'verify.sh accepts --no-sig and --recompute');

// ------------------------------------------------------- runtime harness

const sh = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', ...opts });
const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

const TAG = 'v9.9.9';
const ARTIFACTS = [
    'xchain-wallet-web-v9.9.9.tar.gz',
    'xchain-wallet-extension-v9.9.9.zip',
    // Spaces are deliberate: electron-builder's defaults embed
    // productName ("XChain Wallet"), and the manifest + checksum
    // round trip has to survive them.
    'XChain Wallet-9.9.9-arm64.dmg',
    'XChain Wallet-9.9.9-arm64-mac.zip',
    'XChain Wallet Setup 9.9.9.exe',
    'XChain Wallet-9.9.9-win.zip',
    'XChain Wallet-9.9.9.AppImage',
    'xchain-wallet_9.9.9_amd64.deb',
];

const work = mkdtempSync(join(tmpdir(), 'xc-rel-'));
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
    // update-info.mjs is in this list because lib.sh calls it to decide
    // what is an artifact and what is a channel pointer. Leave it out and
    // sign.sh reports a completely empty artifact set, which reads as a
    // staging problem rather than a missing file.
    for (const f of ['lib.sh', 'sign.sh', 'verify.sh', 'expected-artifacts.txt',
        'update-info.mjs']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    cpSync(join(root, 'tools/build-reproduce/check-no-dev-mock.sh'),
        join(repo, 'tools/build-reproduce/check-no-dev-mock.sh'));
    git(repo, ['init', '-q', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        'commit', '-qm', 'init']);
    git(repo, ['tag', TAG]);
    const tagCommit = git(repo, ['rev-parse', TAG]).stdout.trim();
    assert.ok(/^[0-9a-f]{40}$/.test(tagCommit), 'throwaway repo has a tagged commit');

    const SIGN = join(repo, 'tools/release/sign.sh');
    const VERIFY = join(repo, 'tools/release/verify.sh');

    const stage = (extra = [], omit = []) => {
        const dir = mkdtempSync(join(work, 'stage-'));
        for (const name of ARTIFACTS) {
            if (omit.includes(name)) continue;
            writeFileSync(join(dir, name), `bytes of ${name}\n`);
        }
        for (const name of extra) writeFileSync(join(dir, name), 'extra\n');
        // Channel pointers: present in a real staging dir, never in the
        // manifest. Real names and real SHAPE, both load-bearing. The
        // names because our channel is `stable`, so `latest*.yml` is not
        // what a build emits ( §7.1); the shape because the split
        // is decided on content, and a stub reading `version: 9.9.9`
        // alone would be classified as an artifact and hard-fail the
        // expected-artifacts gate - which is exactly what this fixture
        // used to assert was fine.
        for (const name of ['stable.yml', 'stable-mac.yml', 'stable-linux.yml',
            'stable-linux-arm64.yml']) {
            writeFileSync(join(dir, name),
                'version: 9.9.9\n'
                + 'files:\n'
                + '  - url: XChain Wallet-9.9.9.dmg\n'
                + '    sha512: ZmFrZQ==\n'
                + 'path: XChain Wallet-9.9.9.dmg\n'
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
        git(repo, ['tag', 'v9.9.8']);
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
        const r = sh(signArgs(stage([], ['XChain Wallet Setup 9.9.9.exe'])), { env: gateEnv });
        check('sign.sh refuses a partial artifact set', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the unmatched required pattern',
            /MISSING.*\*\.exe/.test(r.stderr), r.stderr);
    }

    // 7. An undeclared artifact is staged. A blockmap is the realistic
    //    case: electron-builder emits them, and differential updates are
    //    a non-goal (§7), so one appearing here means delta metadata
    //    would be served but never verified.
    {
        const r = sh(signArgs(stage(['XChain Wallet-9.9.9-arm64.dmg.blockmap'])), { env: gateEnv });
        check('sign.sh refuses an undeclared artifact', r.status === 1, `exit ${r.status}`);
        check('sign.sh names the undeclared file',
            /UNDECLARED.*blockmap/.test(r.stderr), r.stderr);
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

    // --------------------------------------------- signed round trip
    //
    // Needs a working GnuPG. Skipped rather than failed where there
    // isn't one: this smoke runs on developer machines and in CI, and a
    // missing gpg is an environment fact, not a regression. The gates
    // above all ran regardless.
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
        const env = { ...gpgEnv, XCHAIN_RELEASE_GPG_KEY: fpr };
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

        //  S5: the interop that actually decides whether the
        // desktop update lane works. The maintainer signs with the gpg
        // CLI; the app verifies with openpgp.js. Those are two different
        // implementations of OpenPGP, and if they disagree about the
        // signature gpg just produced, every desktop update fails in the
        // field for a reason no unit test with synthetic keys would show.
        // The unit suite covers the logic with openpgp-generated keys;
        // this covers the real gpg output.
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
        writeFileSync(join(dir, 'XChain Wallet-9.9.9.AppImage'), 'malware\n');
        const tampered = sh([VERIFY, '--input', dir, '--tag', TAG, '--no-sig'], { env });
        check('verify.sh catches a tampered artifact', tampered.status === 1,
            `${tampered.stdout}${tampered.stderr}`);

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

// ------------------------------------------------------- wiring + gate

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

//  §6 step 1: the release gate is ONE command. It runs the full CI
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

//  §6: the gate scans every shell bundle that actually ships. The
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
for (const [status, pattern] of expectedRows) {
    assert.ok(status === 'required' || status === 'optional',
        `expected-artifacts.txt row status is required|optional (got '${status}')`);
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

// ---------------------------------------------- reproduce wiring 

const driverSrc = read('tools/regtest/test-integration.sh');
assert.ok(/set -euo pipefail/.test(driverSrc), 'regtest driver has strict-mode guard');
assert.ok(/wait-ready\.sh/.test(driverSrc), 'regtest driver gates on wait-ready.sh');
assert.ok((statSync(join(root, 'tools/regtest/test-integration.sh')).mode & 0o111) !== 0,
    'regtest driver has the executable bit set');

for (const shell of ['web', 'extension']) {
    const repro = `packages/${shell}/scripts/reproduce.sh`;
    const buildSh = `packages/${shell}/scripts/build.sh`;
    const dockerfile = `packages/${shell}/Dockerfile`;
    for (const p of [repro, buildSh, dockerfile, `packages/${shell}/REPRODUCIBLE_BUILDS.md`]) {
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
    assert.ok(/NODE_SHA256=/.test(dockerSrc), `${dockerfile} SHA256-verifies the Node tarball`);

    const shellPkg = JSON.parse(read(`packages/${shell}/package.json`));
    assert.ok(/scripts\/reproduce\.sh/.test(shellPkg.scripts.reproduce || ''),
        `packages/${shell}/package.json has a reproduce script`);
}

if (failures > 0) {
    console.error(`\n${failures} release-pipeline gate check(s) failed`);
    process.exit(1);
}

console.log('OK: tools/release/ signing pipeline smoke ( §6 gates + signed round trip)');
