// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every master commit must be able to REACH a verdict, and every red must be
// able to SAY what it found.
//
// Part 1 (the policy). The release gate
// (tools/release/verify-validated-commit.mjs, §6 step 1) requires a run
// of ci.yml on the EXACT tag commit that is both `completed` and `success`. It
// has no skip switch, by design. A cancelled run is therefore not a neutral
// outcome: it leaves that commit permanently unreleasable, because a tag names
// bytes and the bytes cannot be re-validated later under a new run.
//
// ci.yml used to carry a blanket `cancel-in-progress: true`, which applies to
// master pushes exactly as it applies to pull requests. Several sessions push to
// this repo, so pushes routinely arrive faster than CI completes and each one
// killed the previous commit's verdict. Measured 2026-08-03 across the last 40
// master runs: 30 cancelled, 9 failed, 1 success. Finding a green commit to tag
// had become luck rather than process, and spent days reading as "CI is
// red" when a large part of it was "CI was never allowed to finish".
//
// Cancellation is still correct off master, where only the newest push matters
// and runner minutes are the only thing at stake.
//
// Part 2 (the reading). Fixing the policy did not fix the reading. A
// run's `conclusion` aggregates its jobs, so a job that never reached a runner
// still paints the run `failure` in the same shade a broken test does:
//
//   - run 31122248576 (a07ad0a4): four jobs passed, `build` and `test`
//     concluded `cancelled` with EMPTY steps arrays and identical 15m02s
//     durations. Read as two failing jobs; it was one cancellation signal.
//   - run 31267045090 (9f9f1f5a): all six jobs `failure` in two seconds, every
//     steps array empty, no logs, the whole finding in a check-run annotation
//     about an account spending limit.
//
// Neither red named an assertion. That is the reading that costs most in the
// wrong direction, because once a genuine red and an infrastructural red look
// alike, every red gets assumed spurious.
//
// So this gate now covers both: the policy that lets a run finish, and the
// `verdict` job plus classifier that make what it found legible. The
// classifier is exercised against the two real runs above, captured verbatim
// under test/fixtures/ci-runs/, so "a cancelled job is reported as cancelled"
// is evaluated here rather than asserted.
//
// This gate is deliberately about the POLICY and the REPORTING, not about any
// one run's colour.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRun, JOB_STATE, VERDICT } from '../../../tools/release/run-verdict.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const workflows = join(repoRoot, '.github', 'workflows');
const ci = readFileSync(join(workflows, 'ci.yml'), 'utf8');

// ---------------------------------------------------------------------------
// Part 1: the concurrency policy that lets a master run finish at all.
// ---------------------------------------------------------------------------

// Read the concurrency block rather than grepping the whole file, so an
// unrelated `cancel-in-progress` elsewhere can never satisfy or break this.
const block = ci.match(/^concurrency:\n((?:[ \t]+.*\n|[ \t]*\n)*)/m);

assert.ok(block,
    'ci.yml has no top-level `concurrency:` block. It needs one: without a concurrency group, '
    + 'every push to a branch runs in parallel with its predecessors and the runner bill grows '
    + 'without bound. The fix is to add the group back with master exempted from cancellation, '
    + 'not to leave it absent.');

// Strip comments before matching. The block is heavily commented precisely
// because this setting keeps being got wrong, and the first cut of this gate
// then matched the word `cancel-in-progress:` inside its own explanatory
// comment instead of the setting, reporting the prose as the value.
const body = block[1]
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const cancel = body.match(/cancel-in-progress:\s*(.+)/);

assert.ok(cancel,
    'ci.yml\'s concurrency block no longer sets `cancel-in-progress`. GitHub defaults it to false, '
    + 'which is safe for the release gate but wasteful on pull requests. Set it explicitly so the '
    + 'master-versus-branch distinction is stated rather than inherited.');

const value = cancel[1].trim();

assert.notEqual(value, 'true',
    'ci.yml sets `cancel-in-progress: true`, which cancels superseded runs ON MASTER TOO. That is '
    + 'the exact configuration that made 30 of 40 master runs cancel and left with no'
    + 'releasable commit: the release gate requires a COMPLETED, SUCCESSFUL ci.yml run on the tag '
    + 'commit, and a cancelled run can never become one. Gate the flag on the ref instead:\n'
    + "  cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}");

// The flag must be conditional on the ref, and the condition must actually
// exempt master. Checking the shape rather than one exact string, so an
// equivalent spelling (a different default branch name, an `inputs`-driven
// expression) is free to differ without failing on correct writing.
assert.match(value, /\$\{\{.*github\.ref.*\}\}/,
    `ci.yml sets \`cancel-in-progress: ${value}\`, which is neither \`true\` nor an expression on `
    + '`github.ref`. This flag has to distinguish master (never cancel, so every commit reaches a '
    + 'verdict the release gate can read) from everything else (cancel freely). A constant cannot.');

assert.match(value, /refs\/heads\/master/,
    `ci.yml's \`cancel-in-progress\` expression (${value}) does not mention refs/heads/master, so `
    + 'nothing in it exempts the branch the release gate reads. If the default branch was renamed, '
    + 'update this gate in the same change.');

// Falsifiable in the useful direction: the expression must evaluate FALSE for
// master and TRUE for a pull request. Evaluated here rather than trusted,
// because the whole defect class this repo keeps finding is a rule asserted
// with nothing deriving it.
const evaluate = (ref) => {
    const inner = value.replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
    // A conjunction of simple comparisons ("!= master && != develop", the shape
    // the develop protection added) evaluates clause-by-clause; anything richer
    // than that still refuses loudly rather than guessing.
    return inner.split('&&').map((clause) => {
        const m = clause.trim().match(/^github\.ref\s*(!=|==)\s*'([^']+)'$/);
        assert.ok(m,
            `the \`cancel-in-progress\` expression (${inner}) is no longer a conjunction of simple `
            + 'github.ref comparisons, so this gate can no longer evaluate it. Extend the evaluator '
            + 'in the same change rather than deleting the assertions below: they are what proves '
            + 'the protected branches are exempt.');
        return m[1] === '!=' ? ref !== m[2] : ref === m[2];
    }).reduce((a, b) => a && b);
};

assert.equal(evaluate('refs/heads/master'), false,
    'the `cancel-in-progress` expression evaluates TRUE on refs/heads/master, so master runs would '
    + 'still be cancelled and the release gate would still have no completed run to read.');

assert.equal(evaluate('refs/heads/develop'), false,
    'the `cancel-in-progress` expression evaluates TRUE on refs/heads/develop, which the develop '
    + 'gate protection exists to prevent: a develop run cancelled by the next push leaves that '
    + 'commit with no verdict either.');

assert.equal(evaluate('refs/pull/42/merge'), true,
    'the `cancel-in-progress` expression evaluates FALSE for pull requests, so superseded PR runs '
    + 'would pile up. Master is the exemption; everything else should still cancel.');

// The group must be per-COMMIT on master, not merely per-ref.
//
// This assertion exists because the first version of this gate passed on a
// configuration that was measured failing hours later. `cancel-in-progress:
// false` protects a RUNNING job; GitHub separately keeps only one PENDING run
// per concurrency group, and a newer push evicts a queued one regardless of
// that flag. Run 30864080980 on c4008051 was evicted while queued, 0 jobs ever
// started, by a later push that already carried the flag fix.
//
// Grouping per commit removes the contention instead of arbitrating it. There
// is then no such thing as two master runs in one group, so nothing can evict
// anything and every commit reaches a verdict.
const group = body.match(/group:\s*(.+)/);

assert.ok(group,
    'ci.yml\'s concurrency block sets no `group`. Without one the block does nothing at all.');

const groupValue = group[1].trim();

assert.match(groupValue, /github\.sha/,
    `ci.yml's concurrency group (${groupValue}) does not vary by github.sha, so every master commit `
    + 'shares one group and a newer push evicts whichever run is still QUEUED. `cancel-in-progress: '
    + 'false` does not prevent that: it only protects a run that has already started. A commit whose '
    + 'run was evicted while queued can never satisfy the release gate. Group per commit on master:\n'
    + "  group: ci-${{ github.ref }}-${{ github.ref == 'refs/heads/master' && github.sha || 'ref' }}");

assert.match(groupValue, /refs\/heads\/master/,
    `ci.yml's concurrency group (${groupValue}) uses github.sha unconditionally, which would give `
    + 'every pull-request push its own group too and defeat superseding entirely. The sha must be '
    + 'conditional on master.');

// A push to master must still be a trigger, or the gate above guards nothing.
// The branch list may carry develop beside master (the develop/master model
// runs the gate on both) and comment lines above it; what this asserts is that
// master itself is in the push trigger.
assert.match(ci, /on:\n(?:.*\n)*?\s*push:\n(?:\s*#.*\n)*\s*branches:\s*\[[^\]]*\bmaster\b[^\]]*\]/,
    'ci.yml no longer runs on pushes to master. The release gate reads a ci.yml run on the tag '
    + 'commit, and tags are cut from master, so without this trigger no commit is ever releasable.');

// ---------------------------------------------------------------------------
// Part 2a: ci.yml declares a `verdict` job, and nothing can escape it.
// ---------------------------------------------------------------------------

// Split the `jobs:` mapping into per-job source blocks. Regex rather than a
// YAML parser on purpose: this repo has no YAML dependency it is willing to
// make a test-gate load-bearing, and every assertion below is about text a
// human wrote at a known indent.
function jobBlocks(source) {
    const jobsSection = source.match(/^jobs:\n([\s\S]*)$/m);
    assert.ok(jobsSection, 'ci.yml has no top-level `jobs:` mapping.');
    const out = new Map();
    const re = /^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm;
    const starts = [...jobsSection[1].matchAll(re)];
    starts.forEach((m, i) => {
        const from = m.index + m[0].length;
        const to = i + 1 < starts.length ? starts[i + 1].index : jobsSection[1].length;
        out.set(m[1], jobsSection[1].slice(from, to));
    });
    return out;
}

const jobs = jobBlocks(ci);
const verdict = jobs.get('verdict');

assert.ok(verdict,
    'ci.yml has no `verdict` job. Without it a red run says only "failure", which is the same word '
    + 'for a broken assertion and for a job the runner never started (measured on runs 31122248576 '
    + 'and 31267045090, neither of which named a single failing step). The job reads its own run '
    + 'and classifies each job from its steps; see tools/release/run-verdict.mjs.');

assert.match(verdict, /run:\s*node tools\/release\/run-verdict\.mjs\b/,
    'the `verdict` job no longer runs tools/release/run-verdict.mjs. That module is the only thing '
    + 'in this repo that distinguishes a cancelled job from a failed one; a hand-rolled substitute '
    + 'in YAML would not be testable here.');

assert.match(verdict, /--run \$\{\{ github\.run_id \}\}/,
    'the `verdict` job does not pass `--run ${{ github.run_id }}`, so it is not classifying the run '
    + 'it belongs to.');

assert.match(verdict, /--exclude verdict\b/,
    'the `verdict` job does not exclude ITSELF from the classification. It is still in progress '
    + 'while it reads, so including itself makes every run classify as PENDING and the job reports '
    + 'nothing, forever.');

assert.match(verdict, /^\s*if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/m,
    'the `verdict` job is not `if: ${{ always() }}`. Gating it on the other jobs succeeding '
    + 'silences it in exactly the case it exists for: a run that went red without saying why.');

assert.match(verdict, /^\s*actions: read\s*$/m,
    'the `verdict` job does not grant itself `actions: read`. Listing any permission drops the '
    + 'rest, so a job that lists `contents: read` alone cannot list its own run\'s jobs and the '
    + 'classifier exits 2 on a 403 rather than reporting anything.');

assert.match(verdict, /^\s*checks: read\s*$/m,
    'the `verdict` job does not grant itself `checks: read`. A job that never started keeps its '
    + 'whole finding in a check-run annotation - "the job was not started because ... your '
    + 'spending limit needs to be increased" - and without this permission the verdict can say '
    + 'that the job did not start but never why.');

// The `needs:` list is what makes the verdict LAST. A job missing from it can
// still be running when the verdict is read, and a run whose verdict was taken
// early is worse than one with no verdict at all.
const needs = verdict.match(/^\s*needs:\s*\[([^\]]*)\]/m);
assert.ok(needs, 'the `verdict` job has no inline `needs: [...]` list, so this gate cannot check '
    + 'that it waits for every other job. Keep the inline-array form.');

const needed = new Set(needs[1].split(',').map((s) => s.trim()).filter(Boolean));
const others = [...jobs.keys()].filter((n) => n !== 'verdict');
const missing = others.filter((n) => !needed.has(n));

assert.deepEqual(missing, [],
    `the \`verdict\` job does not wait for: ${missing.join(', ')}. Every job in ci.yml has to be in `
    + 'its `needs:` list, or the verdict is taken while that job is still running and reports a '
    + 'partial run as if it were the whole one. Add the job there in the same change that adds it '
    + 'to the workflow.');

// ---------------------------------------------------------------------------
// Part 2b: the classifier, against the real runs that motivated it.
// ---------------------------------------------------------------------------

const fixture = (name) => JSON.parse(
    readFileSync(join(repoRoot, 'test', 'fixtures', 'ci-runs', name), 'utf8'));

const stateOf = (result, jobName) => {
    const job = result.jobs.find((j) => j.name === jobName);
    assert.ok(job, `run classification has no job named \`${jobName}\``);
    return job.state;
};

// Run 31122248576: the run this item was raised on. `build` and `test`
// concluded `cancelled` with empty steps arrays; everything else passed.
const cancelledRun = classifyRun(fixture('31122248576-cancelled-jobs.json'));

assert.equal(stateOf(cancelledRun, 'build'), JOB_STATE.CANCELLED,
    'run 31122248576\'s `build` job concluded `cancelled` with an EMPTY steps array and must be '
    + 'reported as cancelled. Reporting it as a failure is the whole defect: it invents a finding '
    + 'in a job where no step ever ran.');

assert.equal(stateOf(cancelledRun, 'test'), JOB_STATE.CANCELLED,
    'run 31122248576\'s `test` job concluded `cancelled` with an EMPTY steps array and must be '
    + 'reported as cancelled, not as a failed assertion.');

assert.equal(stateOf(cancelledRun, 'e2e'), JOB_STATE.PASSED,
    'run 31122248576\'s `e2e` job passed 11 steps; a classifier that cannot still see the green '
    + 'jobs on a red run is no more use than the colour it replaces.');

assert.deepEqual(cancelledRun.assertions, [],
    'run 31122248576 is classified as carrying stated assertions. It carries none: every step that '
    + 'ran in it passed. That is precisely why its red was unreadable.');

assert.equal(cancelledRun.verdict, VERDICT.NO_VERDICT,
    'run 31122248576 must classify as NO VERDICT. GitHub calls it `failure`; no assertion produced '
    + 'that, so the honest answer is that the run reached no finding and wants re-running.');

// Run 31267045090: red in two seconds, no job ever assigned a runner, the
// finding entirely in an account-level check-run annotation.
const notStartedRun = classifyRun(fixture('31267045090-never-started.json'));

for (const name of ['test', 'build', 'e2e', 'audit', 'coverage', 'drift-guards']) {
    assert.equal(stateOf(notStartedRun, name), JOB_STATE.NOT_STARTED,
        `run 31267045090's \`${name}\` job concluded \`failure\` in two seconds with no steps and `
        + 'no runner. It must be reported as not-started: nothing in it ran, so nothing in this '
        + 'repo can be what broke.');
}

assert.deepEqual(notStartedRun.assertions, [],
    'run 31267045090 is classified as carrying stated assertions. Six jobs concluded `failure` and '
    + 'not one of them executed a step.');

assert.equal(notStartedRun.verdict, VERDICT.NO_VERDICT,
    'run 31267045090 must classify as NO VERDICT, not RED. Every job was refused a runner over an '
    + 'account spending limit; reading that as a test failure sends someone to debug code that '
    + 'never ran.');

assert.match(notStartedRun.jobs[0].detail, /spending limit/,
    'the not-started detail no longer carries the check-run annotation. The annotation IS the '
    + 'finding for this class of red - it names the billing condition - and dropping it leaves the '
    + 'verdict correct but unactionable.');

// The inverse, and the assertion that keeps this gate honest: a run with a
// genuinely failing step must still be RED, and must name the step.
const redRun = classifyRun(fixture('31059553709-stated-assertion.json'));

assert.equal(redRun.verdict, VERDICT.RED,
    'run 31059553709 has a `test` job whose `Run test gate` step concluded `failure`. A classifier '
    + 'that softens that into NO VERDICT would be worse than the colour it replaces: it would hide '
    + 'real findings behind an infrastructure excuse.');

assert.equal(stateOf(redRun, 'test'), JOB_STATE.FAILED,
    'run 31059553709\'s `test` job has a failing step and must be reported as failed.');

assert.deepEqual(redRun.assertions, ['test / Run test gate'],
    'a RED verdict must NAME the assertion that produced it. "Something failed" is the reading this '
    + 'whole gate exists to replace.');

// And a green run stays green, with no infrastructure asterisk.
const greenRun = classifyRun(fixture('31152887714-green.json'));

assert.equal(greenRun.verdict, VERDICT.GREEN,
    'run 31152887714 passed every job and must classify as GREEN.');

// A job still running is not an outcome. Taken from the verdict job's own
// position: it reads its run while it is itself in progress, which is why it
// passes `--exclude verdict`.
const selfReading = [
    {
        name: 'test',
        status: 'completed',
        conclusion: 'success',
        steps: [{ name: 'Run test gate', status: 'completed', conclusion: 'success' }],
    },
    { name: 'verdict', status: 'in_progress', conclusion: null, steps: [] },
];

assert.equal(classifyRun({ id: 0, jobs: selfReading }).verdict, VERDICT.PENDING,
    'a run with a job still in progress must classify as PENDING, never as a finished verdict.');

assert.equal(classifyRun({ id: 0, jobs: selfReading }, { exclude: ['verdict'] }).verdict, VERDICT.GREEN,
    'excluding the reading job by name must leave the rest classifiable. Without this the `verdict` '
    + 'job can only ever report PENDING, because it is always mid-run when it looks.');

// Drive the CLI against a local stub API: a refused annotation must leave the
// verdict and exit code exactly as the offline form gives them, and a refused
// jobs call must still exit 2, because without jobs there is nothing to classify.
{
    const { createServer } = await import('node:http');
    const { spawn } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const meta = { id: 1, status: 'completed', conclusion: 'failure', path: '.github/workflows/ci.yml' };
    const stubJobs = [{
        name: 'test', status: 'completed', conclusion: 'failure', steps: [],
        check_run_url: 'https://api.example/repos/o/r/check-runs/77',
    }];
    let jobsStatus = 200;
    const server = createServer((req, res) => {
        const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.url.startsWith('/repos/o/r/actions/runs/1/jobs')) return send(jobsStatus, { jobs: stubJobs });
        if (req.url === '/repos/o/r/actions/runs/1') return send(200, meta);
        if (req.url.startsWith('/repos/o/r/check-runs/77/annotations')) return send(403, { message: 'Resource not accessible' });
        return send(404, {});
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const apiUrl = `http://127.0.0.1:${server.address().port}`;
    const cli = (args) => new Promise((ok) => {
        const env = { ...process.env, GITHUB_API_URL: apiUrl, GITHUB_TOKEN: 'dummy' };
        delete env.GITHUB_STEP_SUMMARY;
        const child = spawn(process.execPath, [join(here, '../../../tools/release/run-verdict.mjs'), ...args], { env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (status) => ok({ status, stdout, stderr }));
    });
    const work = mkdtempSync(join(tmpdir(), 'run-verdict-cli-'));
    try {
        const offlineFile = join(work, 'run.json');
        writeFileSync(offlineFile, JSON.stringify({ ...meta, jobs: stubJobs }));
        const offline = await cli(['--from', offlineFile, '--json']);
        const online = await cli(['--run', '1', '--repo', 'o/r', '--json']);
        assert.notEqual(online.status, 2,
            `a refused annotation must not make the run unreadable (exit 2); stderr: ${online.stderr}`);
        assert.equal(online.status, offline.status,
            'a refused annotation changed the exit code; the annotation is optional and must change nothing.');
        assert.equal(JSON.parse(online.stdout).verdict, JSON.parse(offline.stdout).verdict,
            'a refused annotation changed the verdict; the classification stands on the empty steps array.');
        assert.match(online.stderr, /checks: read/,
            'a refused annotation must name the missing `checks: read` scope on stderr.');
        jobsStatus = 500;
        const broken = await cli(['--run', '1', '--repo', 'o/r', '--json']);
        assert.equal(broken.status, 2, 'a refused jobs call must still exit 2: there is nothing to classify.');
    } finally {
        server.close();
        rmSync(work, { recursive: true, force: true });
    }
}

// Run the CLI through a symlinked directory: a silent exit 0 there reads as
// "no finding" from a classifier that never ran.
{
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, symlinkSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const work = mkdtempSync(join(tmpdir(), 'run-verdict-link-'));
    try {
        const linked = join(work, 'release');
        symlinkSync(join(repoRoot, 'tools', 'release'), linked, 'dir');
        const run = spawnSync(process.execPath, [join(linked, 'run-verdict.mjs'), '--help'], { encoding: 'utf8' });
        assert.match(run.stdout, /Usage:/,
            `run-verdict.mjs invoked through a symlink printed no usage (exit ${run.status}); `
            + 'its entry-point check must compare realpaths, or the CLI is silently skipped.');
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Part 3: bin/ci-full.sh, the local twin of ci.yml, carries every job.
// ---------------------------------------------------------------------------

// Each ci.yml job needs a `# --- job: <name>` section in the twin, in workflow
// order: a job with no section is a job the pre-push gate never runs.
const ciFull = readFileSync(join(repoRoot, 'bin', 'ci-full.sh'), 'utf8');
const twinJobs = [...ciFull.matchAll(/^# --- job: ([A-Za-z0-9_-]+) -/gm)].map((m) => m[1]);
assert.deepEqual(twinJobs, [...jobs.keys()],
    `bin/ci-full.sh's job sections (${twinJobs.join(', ')}) do not match ci.yml's jobs `
    + `(${[...jobs.keys()].join(', ')}). The script prints "same set GitHub CI runs", so a job `
    + 'it lacks gates green locally and red on GitHub. Add a `# --- job: <name>` section that '
    + 'runs the job\'s steps, or prints SKIPPED-BY-DESIGN for each step that cannot run locally.');

console.log('OK: ci master-verdict smoke (concurrency exempts refs/heads/master from '
    + 'cancel-in-progress, evaluated both ways; push-to-master trigger intact; `verdict` job waits '
    + `on all ${others.length} jobs and classifies from steps; cancelled/not-started jobs report as `
    + 'themselves on runs 31122248576 and 31267045090, a real step failure still reports RED)');
