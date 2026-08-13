// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the automated Windows swap CHECK (§7.5, DD4).
//
// THE THING BEING PROTECTED IS A DISTINCTION, not a feature. DD4 puts both
// Windows lanes on one Parallels VM, where `win-x64` runs under emulation, so
// a hosted `windows-latest` runner - free, and native x64 - is worth having
// perform the same swap. The danger in having it is not that it fails: it is
// that its result starts reading as the rehearsal. `rehearse.mjs attest`
// demands `--by <who watched it>` because whether the downloaded artifact
// replaced the RUNNING app is an OS-level fact no process can observe about
// itself, and a job attesting its own swap removes that control rather than
// automating it.
//
// So the properties driven here are, in order of how much they matter:
//
//   1. An automated check can NEVER satisfy the swap requirement. A record
//      carrying a passing check and no attestation still fails `assert`.
//   2. A machine cannot become the witness: `attest` refuses to run in CI,
//      refuses a CI-shaped `--by`, and `assert` refuses a record where one
//      got in anyway.
//   3. A check that observed the swap NOT happening stops a publish. Evidence
//      that can only ever be good news is not evidence.
//   4. The drill refuses every host it was not deliberately pointed at, and
//      its pairing/silicon logic is right - including that it reports
//      EMULATED silicon as emulated, since a check that ran under emulation
//      closes nothing the attestation does not already cover.
//
// The drill's Windows half cannot run here (this suite runs on macOS and
// Linux). Its pure halves are imported and driven; the parts that install
// software are covered by their refusals, the same way the deb drill's are.

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import {
    assertRecord, makeSwapCheck, validateSwapCheck, inCi, RECORD_VERSION, SWAP_CHECK_VERSION,
} from '../../../tools/release/rehearse.mjs';
import {
    pairFromArtifacts, siliconOf, disposabilityVerdict, positionalOf,
} from '../../../tools/release/drills/win-update-swap.mjs';
import { LANES, laneById } from '../../../tools/release/rehearsal-matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const DRILL = join(root, 'tools/release/drills/win-update-swap.mjs');
const REHEARSE = join(root, 'tools/release/rehearse.mjs');

const work = mkdtempSync(join(tmpdir(), 'xchain-win-swap-'));

// A shell with no CI variables in it. The suite itself runs in CI, and
// `attest`'s refusal is keyed to exactly those variables, so without this
// every "attest accepts" case below would pass on a developer machine and
// fail on the runner.
const noCiEnv = { ...process.env };
for (const k of ['GITHUB_ACTIONS', 'CI', 'BUILDKITE', 'GITLAB_CI']) delete noCiEnv[k];

const cli = (args, env = noCiEnv) => spawnSync(process.execPath, [REHEARSE, ...args],
    { encoding: 'utf8', env });

// ------------------------------------------------------ 1. the drill exists

{
    assert.ok(existsSync(DRILL), 'the Windows swap drill is where the workflow says');

    const help = spawnSync(process.execPath, [DRILL, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, '--help exits 0');
    assert.match(help.stdout, /win-update-swap\.mjs/);
    assert.match(help.stdout, /not an attestation/i,
        'the usage screen says what this is not, because that is the confusable part');

    const noArgs = spawnSync(process.execPath, [DRILL], { encoding: 'utf8' });
    assert.equal(noArgs.status, 1, 'no artifact directory is a refusal');
    assert.match(noArgs.stderr, /usage:/);

    // Pointed at a real directory on a host it was not meant for, it must
    // stop before installing anything. Off Windows the platform guard
    // answers; on a Windows workstation the disposability guard does.
    const anyway = spawnSync(process.execPath, [DRILL, work], {
        encoding: 'utf8',
        env: { ...noCiEnv, XCHAIN_DRILL_DISPOSABLE: '' },
    });
    assert.equal(anyway.status, 1, 'a run on an undeclared host is refused');
    assert.ok(!anyway.stdout.includes('installed '),
        'and it refuses BEFORE installing anything');

    // `--silicon` answers everywhere, deliberately: what a runner really is
    // should never need a full drill run to ask.
    const silicon = spawnSync(process.execPath, [DRILL, '--silicon'], { encoding: 'utf8' });
    assert.equal(silicon.status, 0);
    assert.ok(silicon.stdout.trim().length > 0, '--silicon says something');
}

// -------------------------------------------------- 2. the drill's pure half

{
    const pointer = (v) => `version: ${v}\nfiles:\n  - url: x\n    sha512: y\n`;

    const pair = pairFromArtifacts([
        'xchain-wallet-setup-0.337.0-x64.exe',
        'xchain-wallet-setup-0.337.1-x64.exe',
        'stable.yml',
    ], pointer('0.337.1'));
    assert.equal(pair.from, 'xchain-wallet-setup-0.337.0-x64.exe');
    assert.equal(pair.to, 'xchain-wallet-setup-0.337.1-x64.exe');
    assert.equal(pair.lane, 'win-x64');
    assert.equal(pair.arch, 'x64');

    // THE DIRECTION COMES FROM THE POINTER, NOT FROM SORTING. `0.9.0` sorts
    // after `0.10.0` as a string, so a drill that ordered by filename would
    // install the pair backwards here and report a DOWNGRADE as a passing
    // swap - which is the one result this check must never produce.
    const tricky = pairFromArtifacts([
        'xchain-wallet-setup-0.9.0-x64.exe',
        'xchain-wallet-setup-0.10.0-x64.exe',
        'stable.yml',
    ], pointer('0.10.0'));
    assert.equal(tricky.fromVersion, '0.9.0');
    assert.equal(tricky.toVersion, '0.10.0');

    assert.equal(pairFromArtifacts([
        'xchain-wallet-setup-0.337.0-arm64.exe',
        'xchain-wallet-setup-0.337.1-arm64.exe',
        'stable.yml',
    ], pointer('0.337.1')).lane, 'win-arm64', 'the arm64 pair is its own lane');

    const refuses = (names, text, re, why) => assert.throws(
        () => pairFromArtifacts(names, text), re, why,
    );
    refuses(['xchain-wallet-setup-0.337.0-x64.exe', 'stable.yml'], pointer('0.337.0'),
        /exactly two \.exe/, 'one installer is not a pair');
    refuses(['xchain-wallet-setup-0.337.0-x64.exe', 'xchain-wallet-setup-0.337.1-x64.exe'], '',
        /no channel pointer/, 'without a pointer there is nothing to offer the update from');
    refuses(['xchain-wallet-setup-0.337.0-x64.exe', 'xchain-wallet-setup-0.337.1-arm64.exe',
        'stable.yml'], pointer('0.337.1'),
    /different architectures/, 'a cross-arch pair would prove nothing about either lane');
    refuses(['xchain-wallet-setup-0.337.0-x64.exe', 'xchain-wallet-setup-0.337.1-x64.exe',
        'stable.yml'], pointer('0.339.0'),
    /neither installer is that version/, 'a pointer offering a third version is a wrong feed');
    refuses(['setup.exe', 'other.exe', 'stable.yml'], pointer('0.337.1'),
        /cannot read a version and arch/, 'un-suffixed names are the DD4 selection defect again');
}

{
    // The silicon question this whole lane turns on. `process.arch` reports
    // what the BINARY is; an x64 process on Windows-on-ARM reports x64 and is
    // being emulated, which is precisely the DD4 device for win-x64.
    assert.equal(siliconOf({ PROCESSOR_ARCHITECTURE: 'AMD64' }, 'win32', 'x64').native, true);
    const emulated = siliconOf(
        { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_ARCHITEW6432: 'ARM64' }, 'win32', 'x64',
    );
    assert.equal(emulated.native, false, 'x64-on-ARM64 is emulated, not native');
    assert.match(emulated.label, /emulated/);
    // Cannot tell must not read as native: the label is copied into the
    // evidence, and "native x64" is the entire claim being made.
    assert.equal(siliconOf({}, 'win32', 'x64').native, null);
    assert.equal(siliconOf({}, 'darwin', 'arm64').native, null);
}

{
    assert.equal(disposabilityVerdict({ GITHUB_ACTIONS: 'true' }).ok, true);
    assert.equal(disposabilityVerdict({ XCHAIN_DRILL_DISPOSABLE: '1' }).ok, true);
    assert.equal(disposabilityVerdict({}).ok, false);
    assert.match(disposabilityVerdict({}).reason, /willing to lose/);

    // `--runner "a box"` must not donate its value as the directory the drill
    // installs from. Same family as the deb drill's `--help` becoming an
    // artifact directory.
    assert.equal(positionalOf(['--runner', 'some box', 'swap-check']), 'swap-check');
    assert.equal(positionalOf(['--out', 'r.json', '--runner', 'box']), undefined);
    assert.equal(positionalOf(['swap-check', '--out', 'r.json']), 'swap-check');
}

// ------------------------------------------- 3. the evidence cannot lie flat

{
    const good = makeSwapCheck({
        lane: 'win-x64', from: '0.337.0', to: '0.337.1', result: 'pass',
        runner: 'GitHub-hosted windows-latest runner (X64)', silicon: 'native amd64',
    });
    assert.equal(validateSwapCheck(good).ok, true);
    assert.equal(good['check-version'], SWAP_CHECK_VERSION);

    const bad = (over, re, why) => {
        const v = validateSwapCheck({ ...good, ...over });
        assert.equal(v.ok, false, why);
        assert.match(v.reason, re, why);
    };
    bad({ runner: '  ' }, /no runner named/, 'an unlocated machine result is no better than an unlocated attestation');
    bad({ lane: 'win-x86' }, /unknown lane/, 'evidence for a lane that does not exist');
    bad({ result: 'probably' }, /result is/, 'a result outside the enum');
    bad({ to: '0.337.0' }, /nothing was swapped/, 'from == to is not a swap');
    bad({ kind: 'swap' }, /not "automated-swap-check"/, 'the kind is what keeps the two evidences apart');

    // THE THREE FIELDS THAT WOULD TURN A MACHINE'S REPORT INTO A PERSON'S.
    for (const field of ['attested-by', 'device', 'witness']) {
        bad({ [field]: 'someone' }, /removed the control/,
            `${field} in an automated check is the substitution this whole design refuses`);
    }
}

// --------------------------------- 4. the record: a check is not a rehearsal

const MANIFEST_SHA = 'a'.repeat(64);
const TAG = 'v0.337.1';
const baseRecord = {
    'record-version': RECORD_VERSION,
    tag: TAG,
    'prod-manifest-sha256': MANIFEST_SHA,
    'swap-requirement': 'one-os',
    'requirement-reason': 'test',
    'pinned-key-override': null,
    lanes: LANES.map((l) => ({ id: l.id, ok: true })),
    swaps: [],
    'automated-checks': [],
};
const check = (over) => assertRecord({
    record: { ...baseRecord, ...over }, tag: TAG, prodManifestSha256: MANIFEST_SHA,
});
const passing = makeSwapCheck({
    lane: 'win-x64', from: '0.337.0', to: '0.337.1', result: 'pass',
    runner: 'GitHub-hosted windows-latest runner (X64)', silicon: 'native amd64',
});

{
    // THE PROPERTY THAT MATTERS MOST. A passing automated check on the very
    // lane the release needs, and the release still cannot go out: §7.5 asks
    // for a swap a PERSON observed, and no number of machine results is one.
    const only = check({ 'automated-checks': [passing] });
    assert.ok(!only.ok, 'an automated check must not satisfy the swap requirement');
    assert.match(only.problems.join(' '), /no observed swap on any OS/);

    // ...and it says so rather than passing the check over in silence: the
    // note names the DD4 device that still owes the attestation.
    assert.match(only.notes.join(' '), /NOT an attestation|not an attestation/);
    assert.ok(only.notes.join(' ').includes(laneById('win-x64').device),
        'the note names the device the human half is still owed on');

    // With a real attestation present the record passes, and the check rides
    // along as extra evidence rather than as the thing that unblocked it.
    const withHuman = check({
        swaps: [{ lane: 'win-x64', device: laneById('win-x64').device, from: '0.337.0',
            'attested-by': 'J-Dog' }],
        'automated-checks': [passing],
    });
    assert.ok(withHuman.ok, `a human attestation plus a check passes: ${withHuman.problems.join(' ')}`);

    // The all-OS requirement is not moved either: three OSes still owe a
    // human swap even with a Windows check in hand.
    const strict = check({ 'swap-requirement': 'all-os', 'automated-checks': [passing] });
    assert.match(strict.problems.join(' '), /win32 has none/,
        'an automated check on win-x64 does not make win32 a swapped OS');

    // Evidence that can only ever be good news is not evidence.
    const failed = check({
        'automated-checks': [makeSwapCheck({
            lane: 'win-x64', from: '0.337.0', to: '0.337.1', result: 'fail',
            runner: 'GitHub-hosted windows-latest runner (X64)',
            notes: ['the app is still 0.337.0'],
        })],
    });
    assert.match(failed.problems.join(' '), /automated swap check on win-x64 reported fail/);
    assert.match(failed.problems.join(' '), /the app is still 0\.337\.0/,
        'and the reason travels with it, so the publish log says what broke');

    // A malformed entry is a problem, not something skipped. Skipping is how
    // a check disappears from a record that still claims to carry one.
    const malformed = check({ 'automated-checks': [{ lane: 'win-x64', result: 'pass' }] });
    assert.match(malformed.problems.join(' '), /automated swap check for lane "win-x64"/);

    // The last door: an attestation whose witness is a CI system. `attest`
    // refuses to produce one, so this can only arrive by hand, and the gate
    // that runs at publish time refuses it too.
    for (const by of ['github-actions', 'GitHub Actions', 'CI', 'ci runner', 'automation']) {
        const forged = check({
            swaps: [{ lane: 'win-x64', device: laneById('win-x64').device, from: '0.337.0',
                'attested-by': by }],
        });
        assert.ok(!forged.ok, `"${by}" must not read as a witness`);
        assert.match(forged.problems.join(' '), /names a CI system rather than a person/);
    }
}

// --------------------------------------------- 5. the CLI, over real files

{
    assert.equal(inCi({ GITHUB_ACTIONS: 'true' }), true);
    assert.equal(inCi({}), false);

    const recordPath = join(work, 'REHEARSAL-v0.337.1.json');
    const fresh = () => writeFileSync(recordPath, `${JSON.stringify(baseRecord, null, 2)}\n`);
    const read = () => JSON.parse(readFileSync(recordPath, 'utf8'));

    // `attest` from a CI job is refused, and the refusal points at the
    // command that IS for machines rather than just saying no.
    fresh();
    const inCiAttest = spawnSync(process.execPath, [REHEARSE, 'attest', '--record', recordPath,
        '--lane', 'win-x64', '--from', '0.337.0', '--by', 'J-Dog'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    assert.equal(inCiAttest.status, 1, 'a CI job may not attest');
    assert.match(inCiAttest.stderr, /refusing to attest from CI/);
    assert.match(inCiAttest.stderr, /rehearse\.mjs check/);
    assert.deepEqual(read().swaps, [], 'and nothing was written');

    // Off CI, a CI-shaped name is refused too: the environment check is the
    // fence, and this is the gate for whoever climbs it.
    const forged = cli(['attest', '--record', recordPath, '--lane', 'win-x64',
        '--from', '0.337.0', '--by', 'github-actions[bot]']);
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /names a CI system, not a person/);

    // A person on the named device still works, unchanged.
    const human = cli(['attest', '--record', recordPath, '--lane', 'win-x64',
        '--from', '0.337.0', '--by', 'J-Dog']);
    assert.equal(human.status, 0, `attest failed: ${human.stderr}`);
    assert.equal(read().swaps.length, 1);
    assert.equal(read().swaps[0]['attested-by'], 'J-Dog');

    // `check` files a result, and files it in the OTHER array.
    fresh();
    const resultPath = join(work, 'swap-check-result.json');
    writeFileSync(resultPath, `${JSON.stringify(passing, null, 2)}\n`);
    const filed = cli(['check', '--record', recordPath, '--from-result', resultPath]);
    assert.equal(filed.status, 0, `check failed: ${filed.stderr}`);
    assert.equal(read()['automated-checks'].length, 1);
    assert.deepEqual(read().swaps, [],
        'a check never lands in swaps, whatever it says about itself');
    assert.match(filed.stderr, /NOT an attestation/,
        'and it says so on every invocation, because that is the confusable part');

    // The flag form refuses `--by` outright rather than ignoring it, so
    // somebody reaching for the attestation vocabulary is told where it went.
    fresh();
    const withBy = cli(['check', '--record', recordPath, '--lane', 'win-x64', '--from', '0.337.0',
        '--runner', 'windows-latest', '--result', 'pass', '--by', 'J-Dog']);
    assert.equal(withBy.status, 1);
    assert.match(withBy.stderr, /takes --runner, never --by/);

    // A failing check exits non-zero, so a CI step that files one goes red.
    fresh();
    const failing = cli(['check', '--record', recordPath, '--lane', 'win-x64', '--from', '0.337.0',
        '--runner', 'windows-latest', '--result', 'fail']);
    assert.equal(failing.status, 1, 'filing a failed check is not a success');
    assert.equal(read()['automated-checks'][0].result, 'fail',
        'and it is recorded anyway: a swap that did not happen is the finding');

    // Evidence is bound to the release it was produced against, the same way
    // the record is bound to its manifest.
    fresh();
    const stale = join(work, 'stale.json');
    writeFileSync(stale, `${JSON.stringify(makeSwapCheck({
        lane: 'win-x64', from: '0.330.0', to: '0.331.0', result: 'pass', runner: 'windows-latest',
    }), null, 2)}\n`);
    const mismatched = cli(['check', '--record', recordPath, '--from-result', stale]);
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /this record is for v0\.337\.1/);
    assert.deepEqual(read()['automated-checks'], []);

    // A result file edited to claim a witness is refused at the filing step,
    // before it is ever in a record for `assert` to catch.
    fresh();
    const dressed = join(work, 'dressed-up.json');
    writeFileSync(dressed, `${JSON.stringify({ ...passing, 'attested-by': 'the runner' }, null, 2)}\n`);
    const refused = cli(['check', '--record', recordPath, '--from-result', dressed]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not a usable swap check/);
}

// ------------------------------------------------------------ 6. coverage

{
    // A lane with a passing automated check and no attestation must still
    // report ⬜ and must still fail. This is property 1 again, at the place
    // an operator actually looks before launch.
    const records = join(work, 'records');
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, 'REHEARSAL-v0.337.1.json'), `${JSON.stringify({
        ...baseRecord, 'automated-checks': [passing],
    }, null, 2)}\n`);

    const coverage = cli(['coverage', '--records', records]);
    assert.equal(coverage.status, 1, 'a machine check does not make a lane covered');
    assert.match(coverage.stdout, /⬜ win-x64/);
    assert.match(coverage.stdout, /automated swap check: pass/,
        'the check is reported, because hiding it would waste the evidence');
    assert.match(coverage.stdout, /NOT an attestation/,
        'on the same line as the box, where it cannot be read as the box being ticked');
    assert.doesNotMatch(coverage.stdout, /✅ win-x64/);
}

// ---------------------------------------------------- 7. the workflow itself

{
    const path = join(root, '.github/workflows/windows-swap-check.yml');
    assert.ok(existsSync(path), 'the windows-latest swap-check workflow exists');
    const wf = readFileSync(path, 'utf8');

    assert.match(wf, /runs-on:\s*windows-latest/,
        'the entire point is a NATIVE x64 Windows machine, which is what windows-latest is');
    assert.match(wf, /drills\/win-update-swap\.mjs swap-check/,
        'and it runs the drill rather than describing it');
    assert.match(wf, /--silicon/,
        'it records what silicon the runner really is, since that is the claim being made');

    // THE ASSERTION THIS FILE EXISTS FOR. A job that called `attest` would
    // look like more coverage and would be less: it would replace the one
    // control §7.5 has with a machine's opinion of itself.
    //
    // Comments are stripped first, and that is not a loophole: the file
    // EXPLAINS why it does not attest, at length, and a check that could not
    // tell an explanation from an invocation would push that explanation out
    // of the file it belongs in.
    const executable = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(executable, /\battest\b/,
        'the workflow must never attest: a CI job cannot be the witness');

    // No secrets and no signing material: this lane is meant to cost nothing
    // and to be safe to run on every tag.
    assert.doesNotMatch(wf, /secrets\./,
        'the swap check needs no secrets, and a workflow that reads them is a different risk');
    assert.doesNotMatch(wf, /XCHAIN_REQUIRE_WIN_SIGNING/,
        'it builds unsigned throwaway installers on purpose; the signed pair is the release lane');

    // It must not publish the installers it builds. They are unsigned twins
    // of a release artifact, and the only thing worth taking out of this job
    // is the evidence.
    const uploads = wf.split('upload-artifact').slice(1);
    assert.ok(uploads.length >= 1, 'the evidence is uploaded');
    for (const block of uploads) {
        assert.doesNotMatch(block.split('\n').slice(0, 10).join('\n'), /\.exe/,
            'no upload step may publish the unsigned installers this job builds');
    }
    assert.match(wf, /swap-check-result\.json/, 'the evidence file is what leaves the job');
}

rmSync(work, { recursive: true, force: true });
process.stdout.write('windows-swap-check.smoke.js: ok\n');
