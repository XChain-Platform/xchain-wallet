#!/usr/bin/env node
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

// §6 step 1, as a gate instead of a sentence.
//
// WHY THIS EXISTS. The rails say a release tag is pinned to a commit that
// green CI plus a green prod-build regtest e2e already validated. That was
// written as procedure and enforced by nothing, so the first release this
// project ever cut - v0.334.0, 2026-08-01 - was tagged on a commit whose CI
// run was CANCELLED with `build`, `test`, `audit` and `drift-guards` all
// red. Every other control behaved perfectly and none of them was looking
// at this: `verify-tag` checks who signed the tag, not whether anyone
// validated what it points at. A correctly signed tag on an unvalidated
// commit is precisely the input the signing machinery is not supposed to
// accept.
//
// WHAT IT CHECKS. That the tag's commit has a CONCLUDED, SUCCESSFUL run of
// the required workflow(s). Not "a check exists", not "nothing failed":
// a cancelled run has no conclusion of success and is the exact shape that
// slipped through, because cancellation is what a concurrency group does to
// the previous push and it looks like nothing went wrong.
//
// FAIL-CLOSED, and this matters more than the happy path. Every way of not
// knowing - no run, run still in progress, API unreachable, token without
// `actions: read` - is a refusal. A release gate that defaults to "allow"
// when it cannot see is not a gate, which is the same posture as the pinned
// tag-signing key and the pinned update key.
//
// NOT BYPASSABLE BY A FLAG, deliberately, matching publish.sh's refusal to
// take a skip switch: the one thing a bypass is always available for is the
// release someone is in a hurry to cut. If CI was red for a reason that
// does not matter, the fix is to make CI green and re-run this workflow,
// which re-evaluates from scratch.
//
// WAITING IS NOT WEAKENING (--wait, added for the develop/master flow).
// Under `release-management.md` a release tag is cut on master's MERGE
// commit, and that commit's CI does not exist until the merge happens: the
// ceremony merges, then tags. Run without --wait at that moment the gate
// answers "no run exists for this commit at all" or "still in_progress",
// both correct and both useless as a ceremony step, because the operator
// is then told to re-run a workflow by hand at a time nobody can predict.
// --wait polls until every required workflow CONCLUDES, so the wallet
// ceremony's wait-for-master-CI-green step is a command rather than a
// sentence. The verdict is untouched: a concluded non-success refuses
// immediately without waiting the clock out, and a timeout is a refusal.
// Waiting changes WHEN the gate answers, never WHAT it accepts.
//
// Usage:
//   node tools/release/verify-validated-commit.mjs --sha <sha> [--repo owner/name]
//                                                  [--wait [--wait-timeout <s>] [--poll <s>]]
//
// Env:
//   GITHUB_TOKEN        required; needs `actions: read`
//   GITHUB_API_URL      optional, defaults to https://api.github.com
//   XCHAIN_REQUIRED_WORKFLOWS  optional, comma-separated workflow file
//                       names; defaults to `ci.yml`
//   XCHAIN_GATE_WAIT_SECONDS   optional, default for --wait-timeout

const REQUIRED_DEFAULT = 'ci.yml';
const WAIT_SECONDS_DEFAULT = 1800;
const POLL_SECONDS_DEFAULT = 20;

function fail(message) {
    process.stderr.write(`\nRELEASE GATE REFUSED (§6 step 1)\n\n${message}\n\n`);
    process.exit(1);
}

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

// Answered before any validation, because every refusal this tool prints opens
// with "RELEASE GATE REFUSED". Without this, `--help` fell through to the
// missing-sha branch and printed exactly that, so an operator asking how to
// invoke the gate was told, in the loudest words the tool owns, that their
// release had been rejected. During a release that is not a cosmetic
// difference.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(`Release gate (§6 step 1): refuse a tag whose commit has no green
run of every required workflow.

Usage:
  GITHUB_TOKEN=<token> node tools/release/verify-validated-commit.mjs \\
    --sha <full-40-char-sha> [--repo owner/name] [--wait]

  --sha           REQUIRED, and must be the full 40 characters. A short SHA
                  is refused on purpose: this gate names exactly one commit.
  --repo          owner/name. Defaults to \$GITHUB_REPOSITORY.
  --wait          Poll until every required workflow CONCLUDES, instead of
                  refusing a run that has not started or has not finished.
                  This is the release ceremony's wait-for-master-CI-green
                  step: after the release PR merges, master's merge commit
                  has no run yet, and the tag is cut on that commit. Waiting
                  does not soften the verdict - a concluded run that is not
                  \`success\` refuses at once, and running out of time
                  refuses too.
  --wait-timeout  Seconds to wait with --wait. Default
                  \$XCHAIN_GATE_WAIT_SECONDS, else ${WAIT_SECONDS_DEFAULT}.
  --poll          Seconds between polls with --wait. Default ${POLL_SECONDS_DEFAULT}.

Env:
  GITHUB_TOKEN               required; needs \`actions: read\`. Not knowing
                             whether a commit was validated is a refusal,
                             never a pass.
  GITHUB_API_URL             optional, defaults to https://api.github.com
  XCHAIN_REQUIRED_WORKFLOWS  optional, comma-separated workflow file names;
                             defaults to \`${REQUIRED_DEFAULT}\`
  XCHAIN_GATE_WAIT_SECONDS   optional, default for --wait-timeout

Exit codes: 0 the commit has a green run of every required workflow; 1 refused
(including "cannot tell" and "ran out of time"). A refusal is not a tool fault.`);
    process.exit(0);
}

const sha = arg('sha');
const repo = arg('repo') || process.env.GITHUB_REPOSITORY;
const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const token = process.env.GITHUB_TOKEN;
const required = (process.env.XCHAIN_REQUIRED_WORKFLOWS || REQUIRED_DEFAULT)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const wait = process.argv.slice(2).includes('--wait');
const waitSeconds = Number(arg('wait-timeout')
    ?? process.env.XCHAIN_GATE_WAIT_SECONDS
    ?? WAIT_SECONDS_DEFAULT);
const pollSeconds = Number(arg('poll') ?? POLL_SECONDS_DEFAULT);

if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    fail('--sha must be a full 40-character commit SHA. A short SHA is not accepted: '
        + 'the whole point of this gate is to name exactly one commit.');
}
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    fail('--repo (or GITHUB_REPOSITORY) must be owner/name.');
}
if (!token) {
    fail('GITHUB_TOKEN is not set, so this gate cannot see whether the commit was '
        + 'validated. Not knowing is a refusal, never a pass.');
}
// A wait bounded by a value nobody can read is not bounded. An unparseable
// or non-positive budget refuses here rather than resolving to a default,
// because the two plausible defaults - wait forever, or do not wait - are
// opposite behaviours and the operator meant one of them.
if (wait && (!Number.isFinite(waitSeconds) || waitSeconds <= 0)) {
    fail('--wait-timeout (or XCHAIN_GATE_WAIT_SECONDS) must be a positive number of '
        + `seconds; got "${arg('wait-timeout') ?? process.env.XCHAIN_GATE_WAIT_SECONDS}".`);
}
if (wait && (!Number.isFinite(pollSeconds) || pollSeconds <= 0)) {
    fail(`--poll must be a positive number of seconds; got "${arg('poll')}".`);
}

async function api(path) {
    let res;
    try {
        res = await fetch(`${apiUrl}${path}`, {
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'xchain-release-gate',
            },
        });
    } catch (e) {
        // The header above promises that "API unreachable" is a refusal.
        // It was not: an unreachable host threw out of fetch and the gate
        // died with a stack trace, which in a workflow reads as the tool
        // being broken rather than the release being refused. S41.
        fail(`Cannot reach the GitHub API at ${apiUrl} (${e.message}).\n\n`
            + 'Not knowing whether a commit was validated is a refusal, never a\n'
            + 'pass, so this is a REFUSAL and not a tool fault. Check network\n'
            + 'reachability and GITHUB_API_URL, then run it again.');
    }
    if (!res.ok) {
        fail(`GitHub API ${res.status} on ${path}.\n\n`
            + (res.status === 403 || res.status === 404
                ? 'A 403/404 here is usually a token without `actions: read`. The job\n'
                  + 'running this needs that permission explicitly; `contents: read`\n'
                  + 'alone cannot list workflow runs.'
                : 'The gate refuses rather than guessing.'));
    }
    return res.json();
}

const diagnoses = [];

// S41. The verdict below was always right and the ADVICE under it was
// not. A red run got one sentence - "make CI green on this exact commit" -
// which assumes the suite ran and something in it failed. On 2026-08-07 the
// tip of wallet `master` refused here while every one of the run's six jobs
// had died inside two seconds having executed ZERO steps, because GitHub had
// stopped starting jobs on the account over a billing failure. Nothing about
// the commit was wrong, nothing in the suite had run, and the gate sent the
// operator to debug tests that never executed. The logs were already expired;
// the reason was sitting in the check-run annotations, one API call away,
// which nothing in this project had ever read.
//
// So the gate now separates two failures that print identically and mean
// opposite things: the suite ran and something failed (fix the commit), or
// the suite never ran at all (fix the account, the commit is not the
// subject). It changes no verdict - a run that is not `success` is still a
// refusal, fail-closed as ever - only what the operator is told to do next.
//
// Never-started is measured, not guessed: a job that executed no steps did
// no work, whatever its conclusion says. Every diagnostic call is wrapped,
// because a gate must not turn a refusal into a crash while explaining it.
async function tryApi(path) {
    try {
        const res = await fetch(`${apiUrl}${path}`, {
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'xchain-release-gate',
            },
        });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

async function diagnose(runId) {
    const jobs = (await tryApi(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`))?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return null;

    const ran = jobs.filter((j) => Array.isArray(j.steps) && j.steps.length > 0);
    if (ran.length > 0) return null;

    // Every job executed nothing. Ask the check-run annotations why: this is
    // where GitHub puts "the job was not started because ...", and it is the
    // only place that survives the logs expiring.
    const reasons = new Set();
    for (const job of jobs.slice(0, 3)) {
        const notes = await tryApi(`/repos/${repo}/check-runs/${job.id}/annotations`);
        for (const n of Array.isArray(notes) ? notes : []) {
            if (n.message) reasons.add(String(n.message).trim());
        }
    }

    return `run ${runId}: all ${jobs.length} job(s) executed ZERO steps, so the suite `
        + 'never ran and this is not a failure of the commit.'
        + (reasons.size > 0
            ? `\n    GitHub's own reason:\n${[...reasons].map((r) => `      "${r}"`).join('\n')}`
            : '\n    GitHub gave no annotation for it; check the run page and the '
              + 'account\'s Actions billing and runner availability.');
}

// One pass over the API's answer. Split out of the top level so --wait can
// ask again: the state it reports is the whole verdict, and PENDING is kept
// apart from PROBLEMS because only pending is worth waiting on. A concluded
// non-success never becomes success by waiting; it becomes a different run,
// which is a new question and a fresh invocation of this gate.
async function evaluate() {
    const runs = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
    const all = runs.workflow_runs || [];

    const problems = [];
    const evidence = [];
    const pending = [];
    const failedRuns = [];

    for (const wanted of required) {
        // Match on the workflow's FILE PATH, not its display name: the name is
        // a human label that can be edited in the same commit that would sneak
        // past a name-matched gate.
        const mine = all.filter((r) => (r.path || '').endsWith(`/${wanted}`) || r.path === wanted);

        if (mine.length === 0) {
            problems.push(`no run of \`${wanted}\` exists for this commit at all`);
            pending.push(`${wanted}: no run yet`);
            continue;
        }

        // Newest first. A re-run after a fix is the answer that counts, and it
        // is the one with the highest run_number / most recent creation.
        mine.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const newest = mine[0];

        evidence.push(`${wanted}: run ${newest.id} status=${newest.status} `
            + `conclusion=${newest.conclusion ?? 'null'} (${newest.html_url})`);

        if (newest.status !== 'completed') {
            problems.push(`\`${wanted}\` run ${newest.id} is still ${newest.status}. `
                + 'Wait for it, then re-run this workflow'
                + (wait ? '' : ' (or pass --wait and let this gate wait for it)'));
            pending.push(`${wanted}: run ${newest.id} ${newest.status}`);
            continue;
        }
        if (newest.conclusion !== 'success') {
            problems.push(`\`${wanted}\` run ${newest.id} concluded \`${newest.conclusion}\`, `
                + 'not `success`');
            failedRuns.push(newest.id);
        }
    }

    return { problems, evidence, pending, failedRuns };
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

let state = await evaluate();
let timedOut = false;

// The wait loop. It exits the moment nothing is pending (green, or a real
// failure to report) and never sits through a failure: a run that concluded
// anything but success is answered now, because the operator's next act is
// to fix CI, not to keep watching it.
if (wait && state.pending.length > 0 && state.failedRuns.length === 0) {
    const deadline = Date.now() + waitSeconds * 1000;
    process.stdout.write(`Waiting up to ${waitSeconds}s for CI to conclude on ${sha}\n`
        + `  (${state.pending.join('; ')})\n`);
    while (state.pending.length > 0 && state.failedRuns.length === 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            timedOut = true;
            break;
        }
        await sleep(Math.min(pollSeconds * 1000, remaining));
        state = await evaluate();
        if (state.pending.length > 0) {
            process.stdout.write(`  still waiting: ${state.pending.join('; ')}\n`);
        }
    }
    process.stdout.write('\n');
}

const { problems, evidence } = state;

process.stdout.write(`Commit ${sha}\nRepo   ${repo}\nRequired workflows: ${required.join(', ')}\n\n`);
for (const line of evidence) process.stdout.write(`  ${line}\n`);
process.stdout.write('\n');

if (problems.length > 0) {
    for (const runId of state.failedRuns) {
        const why = await diagnose(runId);
        if (why) diagnoses.push(why);
    }
    fail(`This tag points at a commit that was never validated:\n\n`
        + problems.map((p) => `  - ${p}`).join('\n')
        + '\n\n'
        + (timedOut
            ? `WAITED ${waitSeconds}s AND CI DID NOT CONCLUDE. Running out of time is a\n`
              + 'refusal, exactly like every other way of not knowing: this gate has\n'
              + 'not seen a green run of this commit, so it has nothing to certify.\n'
              + 'Nothing here says the commit is bad. Check that the push actually\n'
              + 'triggered CI (a merge commit on a protected branch does trigger it),\n'
              + 'then run this gate again, with a longer --wait-timeout if the suite\n'
              + 'is simply slower than the budget.\n\n'
            : '')
        + (diagnoses.length > 0
            ? 'THE SUITE NEVER RAN, so nothing here is evidence about this commit:\n\n'
              + diagnoses.map((d) => `  - ${d}`).join('\n')
              + '\n\nFix that first. Re-running CI or cutting a different tag changes\n'
              + 'nothing while jobs cannot start, and the advice below is about a\n'
              + 'suite that failed, which is not what happened.\n\n'
            : '')
        + 'A `cancelled` conclusion is the common one and is not benign: the CI\n'
        + 'concurrency group cancels the previous push\'s run, so a commit that\n'
        + 'was superseded before its suite finished looks untroubled and was\n'
        + 'never actually tested. That is how v0.334.0 was cut.\n\n'
        + 'There is no skip switch. Make CI green on this exact commit, then\n'
        + 're-run this workflow - it re-evaluates from scratch. If the commit\n'
        + 'needs changing, it needs a new tag, because the tag names the bytes.');
}

process.stdout.write('Step 1 gate: the tag commit has a green run of every required workflow.\n');
