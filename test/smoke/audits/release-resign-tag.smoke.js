// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : correcting a signed manifest that says a gate ran when it did not.
//
// `sign.sh` reads TWO trees. Its scripts come from whichever checkout invoked
// it; `check-no-dev-mock.sh`, `shipped-lanes.txt` and `expected-artifacts.txt`
// come from `--repo`, the pristine clone at the release tag. So a defect fixed
// in the gate CANNOT reach a release already tagged, and the only signed
// manifest this project has published (RELEASE_HASHES/v0.336.0.txt, K1-signed,
// `lanes: android`) says `# dev-mock-gate: enforced` for a gate that read zero
// bytes: v0.336.0's copy predates `--artifacts`, so it ignored the flag,
// scanned a pristine clone's absent dist/ trees and reported OK.
//
// The operator's decision (2026-08-11) was to RE-SIGN that release from a tag
// whose own gate runs, rather than to annotate the published record. This file
// drives the three pieces that makes possible:
//
//   * `prepare-resign-tag.sh` cuts such a tag and PROVES it - the same receipt
//     sign.sh requires, from the tree sign.sh will read it out of.
//   * The `-resign<N>` suffix names the same release, in `verify.sh`'s anchor
//     (lib.sh `xr_release_tag_of`) and in the feed sweep (`releaseTagOf`), so
//     the corrected manifest can be republished under the name every existing
//     link already has - and NOT the other way round.
//   * `sign.sh` runs a check the release predates from the tool tree instead
//     of dying on it. Driven while preparing the real v0.336.0 re-sign: every
//     gate passed and then `node` exited with MODULE_NOT_FOUND, because
//     `launch-probe.mjs` landed after that tag was cut.

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
    rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseTagOf } from '../../../tools/release/feed-sweep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const PREPARE = join(root, 'tools/release/prepare-resign-tag.sh');
const VERIFY = join(root, 'tools/release/verify.sh');
const SIGN = join(root, 'tools/release/sign.sh');
const REAL_GATE = join(root, 'tools/build-reproduce/check-no-dev-mock.sh');
const TAG = 'v0.336.0';

const work = mkdtempSync(join(tmpdir(), 'xc1266-resign-'));

// A git config that is HOSTILE in the one way this operator's really is:
// `tag.gpgsign = true`. Measured 2026-08-12 - it turns `git tag <name>` into a
// signed annotated tag and killed the first run of the tool with "fatal: no
// tag message?", which is a failure mode no fixture using a neutral config can
// ever see. The identity is here because the global config is replaced
// wholesale; the signing setting is here because it is the trap.
const GITCONFIG = join(work, 'hostile-gitconfig');
writeFileSync(GITCONFIG, [
    '[user]', '\tname = smoke', '\temail = smoke@test.invalid',
    '[tag]', '\tgpgsign = true',
    '[commit]', '\tgpgsign = false',
    '',
].join('\n'));
const ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: GITCONFIG,
    GIT_CONFIG_SYSTEM: '/dev/null',
};

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();

// The gate v0.336.0 actually shipped, in the one respect that matters: it has
// NO argument parsing, so it does not reject `--artifacts` - it ignores the
// flag, scans the repo's dist/ trees, and reports OK having read nothing.
const OLD_GATE = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'echo "SKIP packages/web/dist (not built)"',
    'echo "SKIP packages/extension/dist (not built)"',
    'echo "OK - no dev-SDK markers in dist/, real xchain-sdk present"',
    '',
].join('\n');

/**
 * A source repo shaped like this one: a release tag carrying `tagGate`, and a
 * later commit on the branch carrying `headGate`.
 */
const makeSource = ({ tagGate, headGate }) => {
    const repo = mkdtempSync(join(work, 'source-'));
    mkdirSync(join(repo, 'tools', 'build-reproduce'), { recursive: true });
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    cpSync(PREPARE, join(repo, 'tools/release/prepare-resign-tag.sh'));
    const gate = join(repo, 'tools/build-reproduce/check-no-dev-mock.sh');
    if (tagGate === 'real') cpSync(REAL_GATE, gate); else writeFileSync(gate, tagGate);
    chmodSync(gate, 0o755);
    writeFileSync(join(repo, 'README.md'), 'fixture\n');
    git(repo, ['init', '-q', '-b', 'master', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'the release commit']);
    // `-c tag.gpgsign=false` here and NOT in the tool's own invocation: the
    // fixture must be able to make its release tag on a machine with no key,
    // while the thing under test faces the hostile config as it really is.
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', '-a', '-m', 'release', TAG]);
    if (headGate === 'real') cpSync(REAL_GATE, gate); else writeFileSync(gate, headGate);
    chmodSync(gate, 0o755);
    // `--allow-empty`: one case gives the tag and HEAD the SAME gate on
    // purpose, and the fixture still needs HEAD to be a later commit.
    git(repo, ['commit', '-qam', 'later work: the gate learns --artifacts', '--allow-empty']);
    return repo;
};

/**
 * An android-only staging set: the only shape `--lane android` can be given,
 * because inside a lane scope the artifact-set gate calls every other lane's
 * file undeclared. BOTH artifacts, because the android lane row claims both
 * globs and demands each - the ceremony derives the APK from the AAB it signs,
 * so a set with one of them means the ceremony was interrupted.
 *
 * The web payload sits at the two paths a Capacitor build really puts it:
 * `assets/public/` in an APK, `base/assets/public/` in an app bundle.
 */
const stageAndroid = (dir, version = '0.336.0') => {
    mkdirSync(dir, { recursive: true });
    const pack = (name, payloadDir) => {
        const mk = join(dir, 'mk');
        mkdirSync(join(mk, payloadDir), { recursive: true });
        writeFileSync(join(mk, payloadDir, 'index.js'), 'const e = "CONTRACT_LINT_FAILED";\n');
        execFileSync('zip', ['-qr', join(dir, name), '.'],
            { cwd: mk, stdio: ['ignore', 'pipe', 'pipe'] });
        rmSync(mk, { recursive: true, force: true });
    };
    pack(`xchain-wallet-v${version}.apk`, join('assets', 'public'));
    pack(`xchain-wallet-android-v${version}.aab`, join('base', 'assets', 'public'));
    return dir;
};

// spawnSync rather than execFileSync: this tool reports on stderr even when it
// succeeds (it is a ceremony step, and its output is instructions), and
// execFileSync hands back stdout alone on a zero exit - which made every
// assertion below match against an empty string.
const prepare = (repo, args) => {
    const r = execFileSyncPair(join(repo, 'tools/release/prepare-resign-tag.sh'), args);
    return r;
};

const execFileSyncPair = (script, args) => {
    const r = spawnSync('bash', [script, ...args], {
        encoding: 'utf8', env: ENV, timeout: 120_000,
    });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// --- 1. Caller errors are caller errors ----------------------------------
{
    const repo = makeSource({ tagGate: OLD_GATE, headGate: 'real' });
    assert.equal(prepare(repo, ['--work-dir', join(work, 'unused-1')]).status, 2,
        '--tag is required');
    assert.equal(prepare(repo, ['--tag', TAG]).status, 2,
        '--work-dir is required: the tag is cut in a throwaway clone, never in the '
        + 'checkout the operator is standing in, and this repo is worked by more than '
        + 'one session at once');
    const missing = prepare(repo, ['--tag', 'v9.9.9', '--work-dir', join(work, 'unused-2')]);
    assert.equal(missing.status, 1, 'a tag that does not exist is refused');
    assert.match(missing.out, /does not exist/,
        'and named, rather than producing an empty clone');
}

// --- 2. A source whose gate cannot read a staged bundle is refused --------
//
// The refusal is BEHAVIOURAL, and it has to be. The gate that shipped with
// v0.336.0 does not reject `--artifacts`, it ignores it, so "did it complain?"
// calls that gate healthy - which is how the published record came to say
// `enforced`. Grepping the script for the flag is no better: a comment
// mentioning it passes.
{
    const repo = makeSource({ tagGate: OLD_GATE, headGate: OLD_GATE });
    const r = prepare(repo, ['--tag', TAG, '--work-dir', join(work, 'unused-3')]);
    assert.equal(r.status, 1,
        `a source tree whose gate reads nothing must be refused; out: ${r.out}`);
    assert.match(r.out, /cannot read a staged bundle/,
        'and say so in terms of what it failed to READ, not what it failed to parse: '
        + `a gate that silently ignores the flag is the whole defect:\n${r.out}`);
    assert.ok(!existsSync(join(work, 'unused-3')),
        'a refused run leaves no half-made clone behind');

    // AND THE FIX HAS TO BE COMMITTED. The tool reads the gate out of
    // `--source-ref` with `git show`, never off the disk: a tag carries
    // committed bytes by construction, so a corrected gate sitting
    // uncommitted in the worktree would produce a tag that does NOT have it
    // while the run that made it looked green. This repo is edited by more
    // than one session at once, which is exactly how a fix comes to be
    // present on disk and absent from every ref.
    cpSync(REAL_GATE, join(repo, 'tools/build-reproduce/check-no-dev-mock.sh'));
    const dirty = prepare(repo, ['--tag', TAG, '--work-dir', join(work, 'unused-3b')]);
    assert.equal(dirty.status, 1,
        'an UNCOMMITTED corrected gate must not be treated as the source tree: a clone '
        + `cannot obtain it, so the tag would not carry it; out: ${dirty.out}`);
    assert.match(dirty.out, /cannot read a staged bundle/,
        'and the refusal is the same one, because from a ref\'s point of view nothing '
        + 'changed');
}

// --- 3. Nothing to prepare is a real answer ------------------------------
{
    const repo = makeSource({ tagGate: 'real', headGate: 'real' });
    const r = prepare(repo, ['--tag', TAG, '--work-dir', join(work, 'unused-4')]);
    assert.equal(r.status, 3,
        `a tag whose own gate already reads staged bundles needs no re-sign tag; out: ${r.out}`);
    assert.match(r.out, /Nothing to prepare/,
        'and the run says so rather than cutting a commit the release did not have, '
        + 'which would weaken the provenance claim for nothing');
}

// --- 4. The tag itself ---------------------------------------------------
{
    const repo = makeSource({ tagGate: OLD_GATE, headGate: 'real' });
    const workDir = join(work, 'resign-work');
    const staged = stageAndroid(join(work, 'stage-android'));
    const before = git(repo, ['status', '--porcelain']);
    const tagsBefore = git(repo, ['tag', '--list']);

    const r = prepare(repo, ['--tag', TAG, '--work-dir', workDir, '--input', staged]);
    assert.equal(r.status, 0, `preparing the re-sign tag: ${r.out}`);
    assert.match(r.out, /OK - 2 bundle\(s\) scanned/,
        'the new tag is PROVED by running its own gate against the staged artifacts, '
        + `not by asserting that it would work:\n${r.out}`);
    assert.match(r.out, /gate proved: yes/, 'and the summary says which it was');

    const resign = `${TAG}-resign1`;
    assert.equal(git(workDir, ['rev-parse', `refs/tags/${resign}^{commit}`]),
        git(workDir, ['rev-parse', 'HEAD']),
        'the clone is left checked out AT the new tag, which is what sign.sh demands');
    assert.equal(git(workDir, ['status', '--porcelain']), '',
        'and clean: sign.sh refuses a dirty signing tree, correctly');

    // The diff is the whole provenance claim: this tag re-signs artifacts it
    // did not build, and that is only honest while nothing but the release
    // tooling differs from the tree that did.
    const changed = git(workDir, ['diff', '--name-only', `${TAG}`, resign])
        .split('\n').filter(Boolean);
    assert.deepEqual(changed, ['tools/build-reproduce/check-no-dev-mock.sh'],
        'a re-sign tag may differ from its release in the release TOOLING and nothing '
        + `else, or the manifest attests bytes to a tree that could not have built them; changed: ${changed}`);
    assert.equal(
        readFileSync(join(workDir, 'tools/build-reproduce/check-no-dev-mock.sh'), 'utf8'),
        readFileSync(REAL_GATE, 'utf8'),
        'and the file it does differ in is the corrected gate, byte for byte');

    // The tag object: annotated (every release tag here is) and UNSIGNED,
    // under a global config that sets tag.gpgsign = true.
    assert.equal(git(workDir, ['cat-file', '-t', resign]), 'tag',
        'the tag is annotated, like every release tag in this repo');
    assert.doesNotMatch(git(workDir, ['cat-file', 'tag', resign]), /BEGIN PGP SIGNATURE/,
        'and unsigned by default: signing it needs a passphrase at a pinentry, and a '
        + 'tool that pauses for a secret cannot be driven or run unattended');
    assert.match(r.out, /annotated and UNSIGNED/,
        'which the summary says out loud, with the command that re-cuts it signed');

    // Nothing happened to the checkout the operator was standing in.
    assert.equal(git(repo, ['status', '--porcelain']), before,
        'the source checkout is untouched - no commit, no stash, no index change');
    assert.equal(git(repo, ['tag', '--list']), tagsBefore,
        'and no tag was created in it: the new tag lives in the throwaway clone only');
}

// --- 5. Names that cannot work are refused BEFORE anything is cut --------
{
    const repo = makeSource({ tagGate: OLD_GATE, headGate: 'real' });
    // sign.sh compares every staged filename against the tag's X.Y.Z core, so
    // this name could not cover the artifacts it is about.
    const wrongVersion = prepare(repo, ['--tag', TAG, '--work-dir', join(work, 'unused-5'),
        '--resign-tag', 'v0.337.0-resign1']);
    assert.equal(wrongVersion.status, 1, 'a re-sign name carrying another version is refused');
    assert.match(wrongVersion.out, /does not carry v0\.336\.0's version/,
        'and the reason names sign.sh\'s version gate rather than a style rule');

    // A name outside the `-resign<N>` shape cannot be republished under the
    // release's own filename, which is the only place it is any use.
    const wrongShape = prepare(repo, ['--tag', TAG, '--work-dir', join(work, 'unused-6'),
        '--resign-tag', 'v0.336.0-rc1']);
    assert.equal(wrongShape.status, 1, 'a name outside the re-sign shape is refused');
    assert.match(wrongShape.out, /is not a re-sign name/, 'and says which rule it is outside');

    // A work dir somebody else is standing in.
    const occupied = join(work, 'occupied');
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, 'someone-elses-file'), 'x\n');
    const busy = prepare(repo, ['--tag', TAG, '--work-dir', occupied]);
    assert.equal(busy.status, 1, 'a non-empty work dir is refused rather than cloned into');
    assert.ok(existsSync(join(occupied, 'someone-elses-file')),
        'and its contents are left alone');
}

// --- 6. One rule, two languages ------------------------------------------
//
// `verify.sh` strips the suffix in bash (lib.sh `xr_release_tag_of`) and the
// feed sweep strips it in JS (`releaseTagOf`). They are read by different
// tools on different machines and they must agree, so both are driven over
// one table rather than inspected.
{
    const table = [
        ['v0.336.0-resign1', 'v0.336.0'],
        ['v0.336.0-resign12', 'v0.336.0'],
        ['v0.336.0', 'v0.336.0'],
        ['v0.336.0-rc1', 'v0.336.0-rc1'],
        ['v0.336.0-resign', 'v0.336.0-resign'],
        ['v0.336.0-resign1-resign2', 'v0.336.0-resign1'],
    ];
    for (const [input, expected] of table) {
        assert.equal(releaseTagOf(input), expected,
            `feed-sweep releaseTagOf(${input})`);
        const bash = execFileSync('bash', ['-c',
            `source "${join(root, 'tools/release/lib.sh')}"; xr_release_tag_of "${input}"`],
        { encoding: 'utf8' }).trim();
        assert.equal(bash, expected, `lib.sh xr_release_tag_of ${input}`);
    }
}

// --- 7. The corrected manifest anchors under the release's own name ------
//
// This is what makes the whole exercise publishable: the manifest goes back to
// RELEASE_HASHES/v0.336.0.txt, the name every existing link and every reader
// already has. ONE WAY ONLY - the superseded original must not satisfy a
// request for the re-signature, or fetching the correction by name and being
// handed the false record would verify.
{
    const dir = mkdtempSync(join(work, 'anchor-'));
    writeFileSync(join(dir, 'xchain-wallet-v0.336.0.apk'), 'payload\n');
    const sha = execFileSync('bash', ['-c',
        `cd "${dir}" && (command -v sha256sum >/dev/null && sha256sum xchain-wallet-v0.336.0.apk `
        + '|| shasum -a 256 xchain-wallet-v0.336.0.apk)'], { encoding: 'utf8' }).split(/\s+/)[0];
    const manifest = (tag) => [
        '# XChain Wallet release manifest',
        '# manifest-version: 2',
        `# tag: ${tag}`,
        '# tag-commit: 97ddc823707c66be6a066a654c7ba20ca2a8acb7',
        '# built: 2026-08-12T00:00:00Z',
        '# dev-mock-gate: enforced',
        '# artifacts: 1',
        '# coverage: partial',
        '# lanes: android',
        '# profile store: ./xchain-wallet-v0.336.0.apk',
        `${sha}  ./xchain-wallet-v0.336.0.apk`,
        '',
    ].join('\n');

    // verify.sh says everything on stderr, pass or fail, so both streams are
    // read: the anchor VERDICT is what these cases are about, and it is a
    // sentence rather than an exit code.
    const runVerify = (file) => execFileSyncPair(VERIFY,
        ['--input', dir, '--manifest', file, '--no-sig']);

    const published = join(dir, 'v0.336.0.txt');
    writeFileSync(published, manifest('v0.336.0-resign1'));
    const ok = runVerify(published);
    assert.equal(ok.status, 0,
        'a re-signature published under its release\'s own name must verify, or the '
        + `correction cannot be published at all:\n${ok.out}`);
    assert.match(ok.out, /RE-SIGNATURE of v0\.336\.0/,
        'and the reader is TOLD it is a re-signature superseding what was there before, '
        + 'rather than silently accepted');

    const other = join(dir, 'v0.337.0.txt');
    writeFileSync(other, manifest('v0.336.0-resign1'));
    assert.equal(runVerify(other).status, 1,
        'a manifest from another release still fails the anchor - that guard is the only '
        + 'thing this accommodation must not weaken');

    const reverse = join(dir, 'v0.336.0-resign1.txt');
    writeFileSync(reverse, manifest('v0.336.0'));
    const rev = runVerify(reverse);
    assert.equal(rev.status, 1,
        'the relation is ONE WAY: asking for the corrected manifest by name and being '
        + `handed the superseded original must NOT verify:\n${rev.out}`);
}

// --- 8. A check the release predates runs, instead of crashing -----------
//
// Found by driving the real thing: with the v0.336.0 re-sign tag in `--repo`,
// every gate passed - dev-mock, artifact set, arches, lanes, signatures - and
// then node exited with MODULE_NOT_FOUND on `launch-probe.mjs`, which landed
// after that tag was cut. The current signing path could not sign any tag
// older than its newest check, and said so in a language no ceremony runbook
// can act on.
{
    const repo = mkdtempSync(join(work, 'signrepo-'));
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    mkdirSync(join(repo, 'tools', 'build-reproduce'), { recursive: true });
    // Everything sign.sh reads out of --repo EXCEPT launch-probe.mjs, which
    // is the shape of a tag cut before that check existed.
    for (const f of ['lib.sh', 'sign.sh', 'expected-artifacts.txt', 'shipped-lanes.txt',
        'update-info.mjs', 'verify-signatures.mjs', 'store-profile-status.txt']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    cpSync(REAL_GATE, join(repo, 'tools/build-reproduce/check-no-dev-mock.sh'));
    git(repo, ['init', '-q', '-b', 'master', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'a tag predating the launch probe']);
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', TAG]);

    const staged = stageAndroid(join(work, 'stage-android-2'));
    let out = '';
    try {
        out = execFileSync('bash', [SIGN, '--tag', TAG, '--repo', repo,
            '--lane', 'android', '--input', staged], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...ENV, XCHAIN_RELEASE_GPG_KEY: '0'.repeat(40) },
            timeout: 120_000,
        });
    } catch (e) {
        out = `${String(e.stdout || '')}${String(e.stderr || '')}`;
    }
    assert.doesNotMatch(out, /MODULE_NOT_FOUND/,
        'sign.sh died on a check the tag predates instead of running it. A ceremony that '
        + `ends in a node stack trace tells its operator nothing to do:\n${out}`);
    assert.match(out, /predates tools\/release\/launch-probe\.mjs/,
        'the fallback is ANNOUNCED, naming both trees: which copy of a gate ran is the '
        + `fact this whole two-tree problem turns on:\n${out}`);
    assert.match(out, /launch probe:/,
        'and the check really runs - the alternative to this checkout\'s copy is no '
        + `check at all, not a safer one:\n${out}`);
}

rmSync(work, { recursive: true, force: true });

console.log('OK  release re-sign tag: prepare-resign-tag.sh cuts and PROVES a tag whose own '
    + 'dev-mock gate reads the staged artifacts (8 groups: caller errors, behavioural refusal, '
    + 'nothing-to-prepare, the tag and its one-file diff under a tag.gpgsign=true config, '
    + 'unusable names, the -resign rule in bash and JS, verify.sh anchoring one way only, '
    + 'and sign.sh running a check the release predates)');
