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

// Turns a CI run's colour into a VERDICT, which is not the same thing.
//
// A run's `conclusion` aggregates its jobs, so one job that never reached a
// runner paints the whole run `failure` in exactly the shade a broken assertion
// does. Twice now that reading has cost days in the wrong direction:
//
//   - run 31122248576 (a07ad0a4, 2026-08-06): e2e, drift-guards, audit and
//     coverage all PASSED; `build` and `test` concluded `cancelled` with an
//     EMPTY steps array and identical 15m02s durations. Read as "master is
//     red", it named two failing jobs. It named none: no step ever ran.
//   - run 31267045090 (9f9f1f5a, 2026-08-08): all six jobs `failure` in two
//     seconds, every steps array empty, runner_id 0, no logs. The check-run
//     annotation carried the whole finding, and it was a billing one - "The
//     job was not started because recent account payments have failed or your
//     spending limit needs to be increased".
//
// In both, the red carried no finding and the jobs that would have carried one
// never completed. The cost is asymmetric: once a genuine red and an
// infrastructural red look alike, every red gets assumed spurious, which is the
// reading that ships a broken commit.
//
// So the rule this module encodes: a job's state comes from its STEPS, not
// from its colour. A step that concluded `failure` is a stated assertion and
// makes the run red. No steps at all means the job never got to state
// anything, and that is reported as `cancelled` or `not-started` - never as a
// failed assertion.
//
// Pure classifier plus a thin CLI, so the same logic serves the `verdict` job
// in ci.yml, an operator asking about master, and the smoke that gates it.
//
// Usage:
//   node tools/release/run-verdict.mjs --run <run-id> [--repo owner/name]
//   node tools/release/run-verdict.mjs --branch master [--repo owner/name]
//   node tools/release/run-verdict.mjs --from <jobs.json>
//
// Env:
//   GITHUB_TOKEN   needed for any network form; needs `actions: read`
//   GITHUB_API_URL optional, defaults to https://api.github.com

/** A job's state, derived from its steps rather than from its colour. */
export const JOB_STATE = {
    /** Every step concluded success or skipped. */
    PASSED: 'passed',
    /** At least one step concluded `failure`. This is a stated assertion. */
    FAILED: 'failed',
    /** Ran, then stopped mid-flight. Carries no finding. */
    CANCELLED: 'cancelled',
    /** Never assigned a runner: no steps, no logs. Carries no finding. */
    NOT_STARTED: 'not-started',
    /** Red overall, but no step said so. A finding nobody can read. */
    UNATTRIBUTED: 'unattributed',
    /** Conditioned out by an `if:`. */
    SKIPPED: 'skipped',
    /** Queued or in progress. Not an outcome yet. */
    RUNNING: 'running',
};

/** Verdicts a whole run can reach. Only `red` names an assertion. */
export const VERDICT = {
    GREEN: 'green',
    RED: 'red',
    /** Not green, and no step anywhere stated why. */
    NO_VERDICT: 'no-verdict',
    /** Still running, or nothing to read. */
    PENDING: 'pending',
};

/** States that mean the job produced no finding either way. */
const INCONCLUSIVE = new Set([
    JOB_STATE.CANCELLED,
    JOB_STATE.NOT_STARTED,
    JOB_STATE.UNATTRIBUTED,
]);

/**
 * Classify one job from the REST `/actions/runs/:id/jobs` shape.
 *
 * @param {object} job raw job payload
 * @returns {{name: string, state: string, detail: string, assertions: string[]}}
 */
export function classifyJob(job) {
    const name = job?.name ?? '(unnamed job)';
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    const status = job?.status ?? 'completed';
    const conclusion = job?.conclusion ?? null;

    if (status !== 'completed') {
        return { name, state: JOB_STATE.RUNNING, detail: `still ${status}`, assertions: [] };
    }

    // An empty steps array is the whole tell. GitHub records a step row for
    // every step it starts, including the implicit setup/teardown ones, so a
    // completed job with none of them never reached a runner. Nothing in it
    // can have asserted anything, whatever colour the job carries.
    if (steps.length === 0) {
        if (conclusion === 'cancelled') {
            return {
                name,
                state: JOB_STATE.CANCELLED,
                detail: 'cancelled before any step ran (queued, never started)',
                assertions: [],
            };
        }
        if (conclusion === 'skipped') {
            return { name, state: JOB_STATE.SKIPPED, detail: 'skipped by an `if:` condition', assertions: [] };
        }
        if (conclusion === 'success') {
            return { name, state: JOB_STATE.PASSED, detail: 'no steps to run', assertions: [] };
        }
        // Red, no steps, and usually no runner either. The finding lives in the
        // check-run annotation (billing, spending limit, no runner available),
        // never in a log this repo owns.
        return {
            name,
            state: JOB_STATE.NOT_STARTED,
            detail: neverStartedDetail(job, conclusion),
            assertions: [],
        };
    }

    const failedSteps = steps
        .filter((s) => s?.conclusion === 'failure')
        .map((s) => s?.name ?? '(unnamed step)');

    if (failedSteps.length > 0) {
        return {
            name,
            state: JOB_STATE.FAILED,
            detail: `step failed: ${failedSteps.join(', ')}`,
            assertions: failedSteps.map((s) => `${name} / ${s}`),
        };
    }

    if (conclusion === 'cancelled') {
        const stopped = steps.find((s) => s?.conclusion === 'cancelled' || s?.status !== 'completed');
        return {
            name,
            state: JOB_STATE.CANCELLED,
            detail: stopped
                ? `cancelled during: ${stopped.name ?? '(unnamed step)'}`
                : 'cancelled mid-run',
            assertions: [],
        };
    }

    if (conclusion === 'success') {
        return { name, state: JOB_STATE.PASSED, detail: `${steps.length} step(s) passed`, assertions: [] };
    }

    if (conclusion === 'skipped') {
        return { name, state: JOB_STATE.SKIPPED, detail: 'skipped by an `if:` condition', assertions: [] };
    }

    // Red with every step green. Real, and previously mistaken for a test
    // failure: run 30786270270's `drift-guards` went red on the setup-node
    // POST cache step, which GitHub does not always record as a step row.
    return {
        name,
        state: JOB_STATE.UNATTRIBUTED,
        detail: `concluded \`${conclusion ?? 'null'}\` but no step reported failure `
            + '(post-step or runner-side; read the check-run annotation)',
        assertions: [],
    };
}

/** Best available sentence for a job that never reached a runner. */
function neverStartedDetail(job, conclusion) {
    const annotation = typeof job?.annotation === 'string' ? job.annotation.trim() : '';
    const base = `concluded \`${conclusion ?? 'null'}\` with no steps and no runner assigned, `
        + 'so no assertion produced it';
    return annotation ? `${base}: ${annotation}` : base;
}

/**
 * Classify a whole run.
 *
 * @param {{jobs: object[], conclusion?: string|null, status?: string, id?: number|string,
 *          head_sha?: string, head_branch?: string, html_url?: string}} run
 * @param {{exclude?: string[]}} [options] job names to leave out (the verdict
 *   job itself is still running when it reads its own run)
 */
export function classifyRun(run, options = {}) {
    const exclude = new Set(options.exclude ?? []);
    const jobs = (run?.jobs ?? [])
        .filter((j) => !exclude.has(j?.name))
        .map(classifyJob);

    const assertions = jobs.flatMap((j) => j.assertions);
    const running = jobs.filter((j) => j.state === JOB_STATE.RUNNING);
    const inconclusive = jobs.filter((j) => INCONCLUSIVE.has(j.state));

    let verdict;
    let headline;

    if (assertions.length > 0) {
        verdict = VERDICT.RED;
        headline = `RED for ${assertions.length} stated assertion(s): ${assertions.join('; ')}`;
    } else if (jobs.length === 0) {
        verdict = VERDICT.PENDING;
        headline = 'NO JOBS to read. The run exists but reported nothing.';
    } else if (running.length > 0) {
        verdict = VERDICT.PENDING;
        headline = `PENDING: ${running.length} job(s) still running (${running.map((j) => j.name).join(', ')}).`;
    } else if (inconclusive.length > 0) {
        verdict = VERDICT.NO_VERDICT;
        headline = `NO VERDICT. ${inconclusive.length} job(s) reached no finding `
            + `(${inconclusive.map((j) => `${j.name}: ${j.state}`).join(', ')}) and no step `
            + 'anywhere stated an assertion. This run\'s colour is infrastructure, not a test result; '
            + 're-run it rather than reading it as a failure.';
    } else {
        verdict = VERDICT.GREEN;
        headline = `GREEN: ${jobs.length} job(s) passed.`;
    }

    return {
        id: run?.id ?? null,
        sha: run?.head_sha ?? null,
        branch: run?.head_branch ?? null,
        url: run?.html_url ?? null,
        runConclusion: run?.conclusion ?? null,
        verdict,
        headline,
        assertions,
        jobs,
    };
}

/** One human-readable block. Used by the CI job, the CLI and an operator alike. */
export function formatVerdict(result) {
    const lines = [];
    const where = [result.branch, result.sha ? result.sha.slice(0, 8) : null].filter(Boolean).join(' @ ');
    lines.push(`CI run ${result.id ?? '(unknown)'}${where ? ` (${where})` : ''}`);
    lines.push(`  GitHub says: ${result.runConclusion ?? 'null'}`);
    lines.push(`  Verdict:     ${result.verdict.toUpperCase()}`);
    lines.push(`  ${result.headline}`);
    lines.push('');
    const width = Math.max(0, ...result.jobs.map((j) => j.name.length));
    for (const job of result.jobs) {
        lines.push(`  ${job.name.padEnd(width)}  ${job.state.padEnd(13)} ${job.detail}`);
    }
    if (result.url) {
        lines.push('');
        lines.push(`  ${result.url}`);
    }
    return lines.join('\n');
}

/** Exit code for a verdict: 0 readable-and-not-red, 1 red, 2 cannot tell. */
export function exitCodeFor(verdict) {
    if (verdict === VERDICT.RED) return 1;
    if (verdict === VERDICT.PENDING) return 2;
    return 0;
}

// ---------------------------------------------------------------------------
// CLI. Everything below runs only when this file is the entry point, so the
// classifier above stays importable by tests with no side effects.
// ---------------------------------------------------------------------------

// Compared as resolved paths rather than as a `file://` string, so a checkout
// under a path with a space still imports cleanly instead of silently running
// the CLI inside a test process.
const { fileURLToPath } = await import('node:url');
const { resolve } = await import('node:path');
const isEntryPoint = Boolean(process.argv[1])
    && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
    const { readFileSync, appendFileSync } = await import('node:fs');

    const arg = (name) => {
        const i = process.argv.indexOf(`--${name}`);
        return i === -1 ? undefined : process.argv[i + 1];
    };
    const argAll = (name) => process.argv
        .map((v, i) => (v === `--${name}` ? process.argv[i + 1] : null))
        .filter(Boolean);

    if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
        console.log(`Classify a CI run into a verdict.

Usage:
  node tools/release/run-verdict.mjs --run <run-id>    [--repo owner/name]
  node tools/release/run-verdict.mjs --branch <name>   [--repo owner/name]
  node tools/release/run-verdict.mjs --from <jobs.json>

  --exclude <job>  leave a job out; repeatable. The \`verdict\` job passes its
                   own name, because it is still running while it reads.
  --json           machine-readable output.

Exit: 0 the run is green or carries no finding, 1 red for a stated assertion,
2 the run cannot be read yet. A NO VERDICT run is exit 0 on purpose: it says
nothing about the code, so failing on it would relabel infrastructure as a
test result, which is the exact confusion this tool exists to end.`);
        process.exit(0);
    }

    const fail = (message) => {
        process.stderr.write(`run-verdict: ${message}\n`);
        process.exit(2);
    };

    const exclude = argAll('exclude');
    const asJson = process.argv.includes('--json');
    const from = arg('from');

    let run;

    if (from) {
        // Offline form: a saved `/actions/runs/:id/jobs` payload, optionally
        // wrapped with the run's own fields. Keeps the classifier exercisable
        // against a real captured run with no token and no network.
        const raw = JSON.parse(readFileSync(from, 'utf8'));
        run = Array.isArray(raw) ? { jobs: raw } : { ...raw, jobs: raw.jobs ?? [] };
    } else {
        const repo = arg('repo') || process.env.GITHUB_REPOSITORY;
        const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
        const token = process.env.GITHUB_TOKEN;
        if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) fail('--repo (or GITHUB_REPOSITORY) must be owner/name.');
        if (!token) fail('GITHUB_TOKEN is not set; reading a run needs `actions: read`.');

        const api = async (path) => {
            const res = await fetch(`${apiUrl}${path}`, {
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: 'application/vnd.github+json',
                    'x-github-api-version': '2022-11-28',
                    'user-agent': 'xchain-run-verdict',
                },
            });
            if (!res.ok) fail(`GitHub API ${res.status} on ${path}. A 403/404 here is usually a token without \`actions: read\`.`);
            return res.json();
        };

        let runId = arg('run');
        if (!runId) {
            const branch = arg('branch') || 'master';
            const list = await api(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}`
                + '&per_page=20');
            const ci = (list.workflow_runs || []).filter((r) => (r.path || '').endsWith('/ci.yml'));
            if (ci.length === 0) fail(`no ci.yml run found on ${branch}.`);
            ci.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            runId = ci[0].id;
        }

        const meta = await api(`/repos/${repo}/actions/runs/${runId}`);
        const jobsPayload = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
        const jobs = jobsPayload.jobs || [];

        // A job that never started keeps its whole finding in the check-run
        // annotation (billing, spending limit, no runner). Fetch it for those
        // jobs only: it is the difference between "not-started" and
        // "not-started because the account is over its spending limit", and
        // the second one is actionable in one click.
        for (const job of jobs) {
            if ((job.steps ?? []).length !== 0) continue;
            if (job.conclusion === 'success' || job.conclusion === 'skipped') continue;
            const id = String(job.check_run_url ?? '').split('/').pop();
            if (!id) continue;
            try {
                const notes = await api(`/repos/${repo}/check-runs/${id}/annotations`);
                const first = (notes || []).find((n) => n?.message);
                if (first) job.annotation = first.message;
            } catch {
                // An annotation is a nicety; its absence must never change the
                // classification, which already stands on the empty steps array.
            }
        }

        run = { ...meta, jobs };
    }

    const result = classifyRun(run, { exclude });
    const text = asJson ? JSON.stringify(result, null, 2) : formatVerdict(result);
    process.stdout.write(`${text}\n`);

    // GitHub renders this on the run page, which is where someone asking "is
    // master red?" actually looks.
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `## CI verdict: ${result.verdict.toUpperCase()}\n\n${result.headline}\n\n`
            + '```\n' + formatVerdict(result) + '\n```\n');
    }

    process.exit(exitCodeFor(result.verdict));
}
