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

//  §6 step 1, as a gate instead of a sentence. .
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
// Usage:
//   node tools/release/verify-validated-commit.mjs --sha <sha> [--repo owner/name]
//
// Env:
//   GITHUB_TOKEN        required; needs `actions: read`
//   GITHUB_API_URL      optional, defaults to https://api.github.com
//   XCHAIN_REQUIRED_WORKFLOWS  optional, comma-separated workflow file
//                       names; defaults to `ci.yml`

const REQUIRED_DEFAULT = 'ci.yml';

function fail(message) {
    process.stderr.write(`\nRELEASE GATE REFUSED ( §6 step 1)\n\n${message}\n\n`);
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
    console.log(`Release gate ( §6 step 1): refuse a tag whose commit has no green
run of every required workflow.

Usage:
  GITHUB_TOKEN=<token> node tools/release/verify-validated-commit.mjs \\
    --sha <full-40-char-sha> [--repo owner/name]

  --sha    REQUIRED, and must be the full 40 characters. A short SHA is
           refused on purpose: this gate names exactly one commit.
  --repo   owner/name. Defaults to $GITHUB_REPOSITORY.

Env:
  GITHUB_TOKEN               required; needs \`actions: read\`. Not knowing
                             whether a commit was validated is a refusal,
                             never a pass.
  GITHUB_API_URL             optional, defaults to https://api.github.com
  XCHAIN_REQUIRED_WORKFLOWS  optional, comma-separated workflow file names;
                             defaults to \`${REQUIRED_DEFAULT}\`

Exit codes: 0 the commit has a green run of every required workflow; 1 refused
(including "cannot tell"). A refusal is not a tool fault.`);
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

async function api(path) {
    const res = await fetch(`${apiUrl}${path}`, {
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'xchain-release-gate',
        },
    });
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

const runs = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
const all = runs.workflow_runs || [];

const problems = [];
const evidence = [];

for (const wanted of required) {
    // Match on the workflow's FILE PATH, not its display name: the name is
    // a human label that can be edited in the same commit that would sneak
    // past a name-matched gate.
    const mine = all.filter((r) => (r.path || '').endsWith(`/${wanted}`) || r.path === wanted);

    if (mine.length === 0) {
        problems.push(`no run of \`${wanted}\` exists for this commit at all`);
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
            + 'Wait for it, then re-run this workflow');
        continue;
    }
    if (newest.conclusion !== 'success') {
        problems.push(`\`${wanted}\` run ${newest.id} concluded \`${newest.conclusion}\`, `
            + 'not `success`');
    }
}

process.stdout.write(`Commit ${sha}\nRepo   ${repo}\nRequired workflows: ${required.join(', ')}\n\n`);
for (const line of evidence) process.stdout.write(`  ${line}\n`);
process.stdout.write('\n');

if (problems.length > 0) {
    fail(`This tag points at a commit that was never validated:\n\n`
        + problems.map((p) => `  - ${p}`).join('\n')
        + '\n\n'
        + 'A `cancelled` conclusion is the common one and is not benign: the CI\n'
        + 'concurrency group cancels the previous push\'s run, so a commit that\n'
        + 'was superseded before its suite finished looks untroubled and was\n'
        + 'never actually tested. That is how v0.334.0 was cut.\n\n'
        + 'There is no skip switch. Make CI green on this exact commit, then\n'
        + 're-run this workflow - it re-evaluates from scratch. If the commit\n'
        + 'needs changing, it needs a new tag, because the tag names the bytes.');
}

process.stdout.write('Step 1 gate: the tag commit has a green run of every required workflow.\n');
