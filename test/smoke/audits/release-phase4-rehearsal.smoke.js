// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "Ceremony Phase 4 is rehearsed" is a claim about a tree,
// and this repo's trees move. This gate makes the claim expire on its own.
//
// THE HISTORY THAT BOUGHT IT. Phase 4 was rehearsed by hand at S38, S40, S41
// and S47, and at three of those four the previous rehearsal had already been
// invalidated by commits nobody connected to it:
//
//   S40 found S38's rehearsal had been driven against the wrong tree.
//   S41 (row 61) found "the commit a tag would now name rewrote the entire
//       signing path underneath that rehearsal".
//   S47 found the same decay six commits later - sign.sh +100 lines, lib.sh
//       +177, shipped-lanes.txt 28 lines changed - by diffing a ref out of a
//       frontier row's evidence cell, which is not a mechanism.
//
// WHAT THIS GATE DOES NOT DO, stated plainly because the alternative is a
// check people learn to ignore. It does NOT assert that Phase 4 passes: it
// cannot, because the signature step needs K1's passphrase at a pinentry and
// no CI run can supply one. It asserts something narrower and checkable: that
// the script side of the signing path the ceremony would run TODAY is
// byte-identical to the one last actually observed, and it reports the repo
// side's divergence from the rehearsed tag tree. When it goes red the answer is not to edit the pin
// (that turns an observation into an assertion) but to re-drive the rehearsal
// or to record why the change cannot reach the signing path.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    announcedGateFallback, classify, drift, EXECUTABLE_GATES, firstRefusal, gateFallbackFor,
    gateFallbackMismatch, LIB_SH_DEPENDENCIES, PIN_FORMAT, PIN_PATH, pinPathFiles, probeEnv, scopeMismatch,
    signingPathFiles, STEPS, uncoveredByPin,
} from '../../../tools/release/phase4-rehearsal.mjs';

assert.ok(existsSync(PIN_PATH),
    `no Phase 4 rehearsal pin at ${PIN_PATH}. Nothing would record which commit the signing path was `
    + 'last observed at, which is the state that let the anchor rot three times over four stages. '
    + 'Drive `node tools/release/phase4-rehearsal.mjs pin --repo <tree at the tag> --tag <vX.Y.Z> '
    + '--input <staged dir>` and commit what it writes.');

const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));
const { script: SCRIPT_PATH_FILES, repo: REPO_PATH_FILES } = pinPathFiles(pin);

// The pin must carry BOTH refs. A Phase 4 run reads its scripts from the
// invoking checkout and its lane roster from the --repo tree, and rows 40, 48
// and 57 were each one half of that split being mistaken for the whole.
assert.ok(pin.scriptRef && pin.repoRef,
    'the rehearsal pin names fewer than two refs. A Phase 4 signing run reads from two trees at once '
    + '(scripts from the invoking checkout, lane roster from the --repo tree at the tag, signing '
    + 'controls from whichever of the two the release set names), so a pin naming one of them describes half the run and hides the half that has broken '
    + 'before.');

// A pin nobody can act on is worse than none: it reads like proof.
assert.ok(typeof pin.reached === 'string' && pin.reached.length > 0,
    'the rehearsal pin does not say how deep the rehearsal got. "Rehearsed" has meant four different '
    + 'depths across this spec\'s stages, which is exactly why the depth is recorded rather than implied.');

assert.ok(Object.keys(pin.scriptPath || {}).length === SCRIPT_PATH_FILES.length,
    `the rehearsal pin records ${Object.keys(pin.scriptPath || {}).length} signing-path files, not the `
    + `${SCRIPT_PATH_FILES.length} this tool tracks. A file dropped from the pin is drift that nothing `
    + 'will ever see, and it fails silently in the direction that looks green.');

assert.ok(REPO_PATH_FILES.every((p) => typeof pin.repoPath?.[p] === 'string'),
    `the rehearsal pin records no hash for some of ${REPO_PATH_FILES.join(', ')}. The repo side is `
    + 'what the rehearsed tag tree declared, and a file missing from the pin cannot be reported as '
    + 'diverged. Re-drive the rehearsal and re-pin it rather than hand-editing the pin.');

// The signing controls follow sign.sh's per-release-set root: tag side for a release run,
// script side (hashed from this checkout and gated) for a --staging rehearsal.
{
    const gate = 'tools/build-reproduce/check-no-dev-mock.sh';
    const profile = 'tools/release/expected-artifacts.txt';
    const release = signingPathFiles('release');
    const staging = signingPathFiles('staging');
    assert.ok(release.repo.includes(gate) && release.repo.includes(profile) && !release.script.includes(gate),
        'a release run reads both signing controls from the tag tree, so they belong on the repo side.');
    assert.ok(staging.script.includes(gate) && staging.script.includes(profile) && !staging.repo.includes(gate),
        'a --staging rehearsal runs the invoking checkout\'s signing controls, so they must be hashed and gated there.');
    assert.throws(() => signingPathFiles('nightly'), /unknown release set/);

    const walletRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const head = spawnSync('git', ['-C', walletRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const hashes = Object.fromEntries(staging.script.map((p) => [p,
        createHash('sha256').update(readFileSync(join(walletRoot, p))).digest('hex')]));
    const work = mkdtempSync(join(tmpdir(), 'phase4-pin-'));
    try {
        const pinFile = join(work, 'pin.json');
        const write = (scriptPath) => writeFileSync(pinFile, JSON.stringify({
            pinFormat: 2, releaseSet: 'staging', tag: 'v0.0.0', reached: 'manifest-written',
            scriptRef: head, repoRef: head, scriptPath, repoPath: {},
        }));
        write(hashes);
        const clean = drift({ pinFile });
        assert.ok(clean.ok && clean.moved.length === 0,
            `a staging pin of today's bytes must read clean; moved: ${clean.moved.map((m) => m.path).join(', ')}`);
        for (const p of [gate, profile]) {
            write({ ...hashes, [p]: 'f'.repeat(64) });
            const stale = drift({ pinFile });
            assert.ok(!stale.ok && stale.moved.some((m) => m.path === p),
                `a staging pin must go STALE when ${p}, which the staging run executed, moves.`);
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

// The signature gate and the launch probe are steps of their own, between the artifact set and the
// manifest, and a refusal at either is classified at its own depth and quoted in the gate's own words.
{
    const at = (s) => STEPS.indexOf(s);
    assert.ok(at('artifact-set') < at('signature-gate') && at('signature-gate') < at('launch-probe')
        && at('launch-probe') < at('manifest-written'),
        `STEPS must order artifact-set < signature-gate < launch-probe < manifest-written; got ${STEPS.join(', ')}`);

    const sigRefused = 'release/lib.sh: artifact-set gate ok (5 artifact(s))\n'
        + '✗ X.exe: UNSIGNED: certificate table is empty\n'
        + 'verify-signatures: 1 artifact(s) are NOT signed.\n'
        + '  The release must not be manifest-signed in this state.\n';
    assert.equal(classify(sigRefused), 'artifact-set', 'a signature-gate refusal means the artifact set passed');
    assert.equal(firstRefusal(sigRefused), 'verify-signatures: 1 artifact(s) are NOT signed.',
        'the blocker of a signature-gate refusal is the gate\'s own refusal line');

    const launchFailed = 'signature gate ok (2 verified, 0 recorded-not-verified)\n'
        + 'launch probe: 3 file(s) in the release set, host darwin/arm64, 8s window\n'
        + 'release/lib.sh: artifact-set gate ok (5 artifact(s))\n'
        + 'launch-probe: 1 artifact(s) failed the launch probe.\n';
    assert.equal(classify(launchFailed), 'signature-gate', 'a launch-probe refusal means the signature gate passed');
    assert.equal(firstRefusal(launchFailed), 'launch-probe: 1 artifact(s) failed the launch probe.',
        'the blocker of a launch-probe refusal is the probe\'s own refusal line, never a progress line');

    const hostBlocked = 'launch-probe: 2 artifact(s) could NOT be probed because this host is missing a facility\n';
    assert.equal(classify(hostBlocked), 'signature-gate', 'the word "missing" in a launch-probe refusal is not lane scope');

    // A dev-mock gate refusal, framed the way sign.sh prints it, means only the GPG key was named.
    const devMockRefusal = (gateLines) => 'sign.sh: running pre-sign dev-mock gate against /tmp/stage ...\n'
        + '  gate (tool tree): /repo/tools/build-reproduce/check-no-dev-mock.sh\n'
        + gateLines
        + 'sign.sh: pre-sign dev-mock gate FAILED. Refusing to sign.\n';
    const devMockRefusals = [
        devMockRefusal('Pre-release gate FAILED - a required tool is missing.\n'),
        devMockRefusal('Pre-release gate FAILED - it scanned NOTHING (2 target(s) absent).\n'
            + 'A gate that could not run has not passed; sign.sh states that rule about\n'
            + 'a missing script and it holds identically for an empty scan.\n'),
        devMockRefusal('FAIL packages/desktop/main is missing\n'
            + 'Pre-release gate FAILED - desktop main-process source is absent; scanned NOTHING.\n'),
        devMockRefusal('Pre-release gate FAILED - dev-SDK stub leaked into a production bundle,\n'),
    ];
    for (const output of devMockRefusals) {
        assert.equal(classify(output), 'gpg-key-named',
            'a dev-mock gate refusal means only the GPG key was named; its word "missing" is not lane scope');
        assert.equal(firstRefusal(output), 'sign.sh: pre-sign dev-mock gate FAILED. Refusing to sign.',
            'the blocker of a dev-mock gate refusal is sign.sh\'s own refusal line');
    }

    const gpgAfterGates = 'signature gate ok (2 verified, 0 recorded-not-verified)\n'
        + 'launch probe ok (1 launched and still alive, 2 not probed on this host, 0 non-app file(s) ignored)\n'
        + 'gpg: signing failed: Inappropriate ioctl for device\n';
    assert.equal(classify(gpgAfterGates), 'manifest-written', 'gpg evidence still outranks both gates');

    assert.equal(classify('launch probe ok (1 launched and still alive)\nsign.sh: hashing artifacts in x ...\n'),
        'launch-probe', 'a passed launch probe with no later evidence reached the launch-probe step');
    assert.equal(classify('signature gate ok (1 verified, 0 recorded-not-verified)\n'), 'signature-gate');
    assert.equal(classify('signature gate ok (1 verified, 0 recorded-not-verified)\n'
        + '  ****  LAUNCH PROBE RAN NOTHING  ****\n'), 'signature-gate',
    'a launch probe that launched nothing proves no launch, so it claims no launch-probe depth');
    assert.equal(classify('sign.sh: tools/release/verify-signatures.mjs is in neither tree. Refusing to sign.\n'),
        'artifact-set');
    assert.equal(classify('sign.sh: tools/release/launch-probe.mjs is in neither tree. Refusing to sign.\n'),
        'signature-gate');

    // Lines that name a gate without proving it passed or refused claim no depth.
    for (const quiet of [
        'sign.sh: v0.339.0 predates tools/release/launch-probe.mjs - running this checkout\'s copy.\nboom\n',
        'sign.sh: v0.339.0 predates tools/release/verify-signatures.mjs - running this checkout\'s copy.\nboom\n',
        'launch probe: 3 file(s) in the release set, host darwin/arm64, 8s window\nboom\n',
    ]) {
        assert.equal(classify(quiet), 'invoked', `a non-refusal gate mention claimed depth: ${quiet.split('\n')[0]}`);
    }
    assert.equal(classify('something nobody recognises\n'), 'invoked', 'unrecognised output stays conservative');
    for (const output of [sigRefused, launchFailed, hostBlocked, gpgAfterGates, ...devMockRefusals]) {
        assert.ok(STEPS.includes(classify(output)), 'classify returned a step STEPS does not list');
    }
}

// The executable gates are tracked from format 3: tag side by default, script side (hashed and gated)
// where the tag predated a gate and sign.sh ran this checkout's copy. Formats 1 and 2 never list them.
{
    assert.ok(PIN_FORMAT >= 3, 'the gates entered the tracked set at pin format 3');
    for (const set of ['release', 'staging']) {
        const now = signingPathFiles(set);
        assert.ok(EXECUTABLE_GATES.every((g) => now.repo.includes(g) && !now.script.includes(g)),
            `a ${set} run executes the tag's copy of each gate, so both belong on the repo side`);
        for (const fmt of [1, 2]) {
            const old = signingPathFiles(set, fmt);
            assert.ok(EXECUTABLE_GATES.every((g) => !old.repo.includes(g) && !old.script.includes(g)),
                `format ${fmt} must keep the file lists it was recorded with`);
        }
    }
    const probeGate = 'tools/release/launch-probe.mjs';
    const sigGate = 'tools/release/verify-signatures.mjs';
    const fell = signingPathFiles('release', 3, { gateFallback: [probeGate] });
    assert.ok(fell.script.includes(probeGate) && !fell.repo.includes(probeGate) && fell.repo.includes(sigGate),
        'a gate the tag predated is hashed from this checkout, which is the copy sign.sh ran');
    assert.throws(() => signingPathFiles('release', 3, { gateFallback: ['tools/release/sign.sh'] }),
        /not an executable gate/);

    assert.deepEqual(announcedGateFallback(
        `sign.sh: v0.336.0 predates ${probeGate} - running this checkout's copy.\n`), [probeGate]);
    assert.deepEqual(gateFallbackMismatch({ computed: [probeGate], output: '', reached: 'artifact-set' }), [],
        'a run that never resolved the launch probe cannot contradict its fallback');
    assert.deepEqual(gateFallbackMismatch({ computed: [probeGate], output: '', reached: 'signature-gate' }),
        [probeGate], 'a computed fallback sign.sh never announced must refuse the pin');
    assert.deepEqual(gateFallbackMismatch({ computed: [], output: `sign.sh: v0.336.0 predates ${sigGate} - running this checkout's copy.\n`, reached: 'artifact-set' }),
        [sigGate], 'an announced fallback the tool did not compute must refuse the pin');

    const legacy = uncoveredByPin({ releaseSet: 'release' });
    assert.ok(EXECUTABLE_GATES.every((g) => legacy.includes(g)), 'check must name the gates a legacy pin never covered');
    assert.deepEqual(uncoveredByPin({ releaseSet: 'release', pinFormat: 3, gateFallback: [] }),
        LIB_SH_DEPENDENCIES, 'a format-3 pin predates exactly the files lib.sh loads from its own directory');
    assert.deepEqual(uncoveredByPin({ releaseSet: 'release', pinFormat: 4, gateFallback: [] }), []);

    const walletRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const work = mkdtempSync(join(tmpdir(), 'phase4-gates-'));
    try {
        mkdirSync(join(work, 'tools', 'release'), { recursive: true });
        writeFileSync(join(work, sigGate), '// tag copy\n');
        assert.deepEqual(gateFallbackFor(work), [probeGate], 'a tag tree without the probe falls back for it alone');

        const head = spawnSync('git', ['-C', walletRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
        const files = signingPathFiles('release', 3, { gateFallback: [probeGate] });
        const hashes = Object.fromEntries(files.script.map((p) => [p,
            createHash('sha256').update(readFileSync(join(walletRoot, p))).digest('hex')]));
        const pinFile = join(work, 'pin.json');
        const write = (scriptPath) => writeFileSync(pinFile, JSON.stringify({
            pinFormat: 3, releaseSet: 'release', gateFallback: [probeGate], tag: 'v0.0.0',
            reached: 'manifest-written', scriptRef: head, repoRef: head, scriptPath, repoPath: {},
        }));
        write(hashes);
        const clean = drift({ pinFile });
        assert.ok(clean.ok && clean.moved.length === 0,
            `a format-3 pin of today's bytes must read clean; moved: ${clean.moved.map((m) => m.path).join(', ')}`);
        write({ ...hashes, [probeGate]: 'f'.repeat(64) });
        const stale = drift({ pinFile });
        assert.ok(!stale.ok && stale.moved.some((m) => m.path === probeGate),
            'a pin must go STALE when a fallback gate, which the run executed from this checkout, moves');
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

// Every file lib.sh loads from its own directory is script side from format 4, for both release
// sets, because lib.sh is always the invoking checkout's copy. Formats 1 to 3 never list them.
{
    const walletRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const libText = readFileSync(join(walletRoot, 'tools', 'release', 'lib.sh'), 'utf8');
    const loaded = [...new Set([...libText.matchAll(/\$here\/([A-Za-z0-9._-]+)/g)]
        .map((m) => `tools/release/${m[1]}`))];
    assert.ok(loaded.length > 0, 'found no $here/ reference in lib.sh, so this guard scans nothing');
    for (const set of ['release', 'staging']) {
        for (const gateFallback of [[], ['tools/release/launch-probe.mjs']]) {
            const now = signingPathFiles(set, 4, { gateFallback });
            const untracked = loaded.filter((p) => !now.script.includes(p) || now.repo.includes(p));
            assert.deepEqual(untracked, [],
                `lib.sh loads ${untracked.join(', ')} from its own directory, so a ${set} run reads the `
                + 'invoking checkout\'s copy; untracked, `check` cannot see it drift.');
        }
        for (const fmt of [1, 2, 3]) {
            const old = signingPathFiles(set, fmt);
            assert.ok(LIB_SH_DEPENDENCIES.every((p) => !old.script.includes(p) && !old.repo.includes(p)),
                `format ${fmt} must keep the file lists it was recorded with`);
        }
    }

    const head = spawnSync('git', ['-C', walletRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const files = signingPathFiles('release', 4);
    const hashes = Object.fromEntries(files.script.map((p) => [p,
        createHash('sha256').update(readFileSync(join(walletRoot, p))).digest('hex')]));
    const work = mkdtempSync(join(tmpdir(), 'phase4-libdeps-'));
    try {
        const pinFile = join(work, 'pin.json');
        const write = (scriptPath) => writeFileSync(pinFile, JSON.stringify({
            pinFormat: 4, releaseSet: 'release', gateFallback: [], tag: 'v0.0.0',
            reached: 'manifest-written', scriptRef: head, repoRef: head, scriptPath, repoPath: {},
        }));
        write(hashes);
        assert.ok(drift({ pinFile }).ok, 'a format-4 pin of today\'s bytes must read clean');
        for (const p of LIB_SH_DEPENDENCIES) {
            write({ ...hashes, [p]: 'f'.repeat(64) });
            const stale = drift({ pinFile });
            assert.ok(!stale.ok && stale.moved.some((m) => m.path === p),
                `a format-4 pin must go STALE when ${p}, which lib.sh loads on the signing path, moves`);
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

// A pin records its scope from its own arguments, so sign.sh must not take a
// different one from the operator's environment, and a run that did anyway
// must not be pinned.
{
    const env = probeEnv({
        XCHAIN_RELEASE_LANES: 'mac,linux', SIGN_SKIP_DEV_MOCK_CHECK: '1',
        XCHAIN_RELEASE_GPG_KEY: 'K', PATH: '/bin',
    });
    assert.ok(!('XCHAIN_RELEASE_LANES' in env) && !('SIGN_SKIP_DEV_MOCK_CHECK' in env),
        'probe must not hand sign.sh an inherited lane scope or dev-mock skip');
    assert.equal(env.XCHAIN_RELEASE_GPG_KEY, 'K', 'probe must keep the signing key sign.sh requires');
    assert.equal(env.PATH, '/bin', 'probe must keep the rest of the environment');
    assert.equal(probeEnv({}, { SIGN_SKIP_DEV_MOCK_CHECK: '1' }).SIGN_SKIP_DEV_MOCK_CHECK, '1',
        'an override the caller passes explicitly still reaches sign.sh');

    const partial = 'sign.sh: PARTIAL release - gating against lane(s): mac linux\n';
    assert.equal(scopeMismatch({ output: partial, lane: null }).length, 1,
        'a PARTIAL run with no --lane must not be pinned as a full release');
    assert.deepEqual(scopeMismatch({ output: partial, lane: 'mac,linux' }), [],
        'a PARTIAL run the operator asked for is consistent');
    assert.equal(scopeMismatch({ output: 'sign.sh: SIGN_SKIP_DEV_MOCK_CHECK=1 - dev-mock gate SKIPPED.\n', lane: null })
        .length, 1, 'a run that skipped the dev-mock gate must not be pinned');
    assert.deepEqual(scopeMismatch({ output: 'sign.sh: hashing artifacts in <input> ...\n', lane: null }), [],
        'a full-scope run with the gate in place is consistent');
}

const d = drift();

assert.ok(!d.missing, 'the pin vanished between two reads of the same file.');

if (d.behind) {
    console.log('SKIP: release phase4-rehearsal smoke - this checkout does not contain '
        + `${String(pin.scriptRef).slice(0, 8)}, the commit the rehearsal was observed at, so its signing `
        + 'path is the OLDER one rather than a changed one. Pull and re-run. The CI venue always tests the '
        + 'pushed commit, where this cannot arise.');
    process.exit(0);
}

assert.equal(d.moved.length, 0,
    'the release signing path has moved since the last observed Phase 4 rehearsal:\n  '
    + d.moved.map((m) => m.path).join('\n  ')
    + `\n\nThe rehearsal pinned at ${String(pin.scriptRef).slice(0, 8)} (reached '${pin.reached}', `
    + `observed ${pin.observedAt}) no longer describes the tooling ceremony Phase 4 would run, so any `
    + 'claim that Phase 4 is rehearsed is a claim about a tree that has moved on. Re-drive the rehearsal '
    + 'and re-pin it, or record in the release record why these changes cannot affect signing. Do NOT '
    + 'hand-edit the pin: the whole value of that file is that only an observation can set it.');

// Reported, not gated: the repo side is the tag's copy, and only a rehearsal at
// a newer tag can re-pin it, so failing here would stay red on correct work.
if (d.repoDiverged.length) {
    console.log(`NOTE: release phase4-rehearsal smoke - ${d.repoDiverged.length} of `
        + `${REPO_PATH_FILES.length} repo-side files differ from the ${pin.tag} tree the rehearsal read: `
        + `${d.repoDiverged.map((m) => m.path).join(', ')}. The next tag's ceremony reads these copies, `
        + 'which no rehearsal has run against; re-pin against that tag once it is cut.');
}

console.log(`OK: release phase4-rehearsal smoke (row 89: the ${SCRIPT_PATH_FILES.length} script-side `
    + `signing-path files at HEAD are byte-identical to the rehearsal observed ${pin.observedAt}; `
    + `pinned at script ${String(pin.scriptRef).slice(0, 8)} / repo ${String(pin.repoRef).slice(0, 8)}, `
    + `tag ${pin.tag}, lane ${pin.lane || 'all'}, reached '${pin.reached}'`
    + `${pin.reachedSignature ? '' : ' - short of the signature, which needs K1 at a pinentry'}; `
    + `${REPO_PATH_FILES.length - d.repoDiverged.length} of ${REPO_PATH_FILES.length} repo-side files `
    + 'match the tag tree, reported and not gated)');
