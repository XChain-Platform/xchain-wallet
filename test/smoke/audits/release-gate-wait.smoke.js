// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The §6 step-1 gate must be able to WAIT, and waiting must not soften it.
//
// WHY. Under the platform release policy (claude/specs/living/
// release-management.md) the wallet's release tag is cut on master's MERGE
// commit, and that commit does not exist until the release PR is merged.
// Its CI therefore starts at merge time, seconds before the operator wants
// to tag. Run at that moment the gate answers "no run of `ci.yml` exists
// for this commit at all", which is correct and useless: the ceremony had
// no step between "merge" and "tag" other than a human guessing when to
// re-run a workflow by hand. That guess is exactly the shape of the miss
// that cut v0.334.0 on an unvalidated commit in the first place.
//
// WHAT MUST HOLD, and the second half matters more than the first:
//
//   - --wait polls until every required workflow CONCLUDES, so the wallet
//     ceremony's wait-for-master-CI-green step is a command;
//   - waiting changes WHEN the gate answers, never WHAT it accepts. A
//     timeout is a refusal. A commit with no run at all is a refusal even
//     after a full wait, because silence is not success. A concluded
//     non-success is refused AT ONCE rather than waited out, since the
//     operator's next act is to fix CI, not to keep watching it.
//
// This DRIVES the tool against a stub API rather than reading its source,
// for the reason release-gate-diagnosis.smoke.js does: a source-reading
// assertion goes green on a --wait that quietly returns 0 when it runs out
// of time, which is the one bug in this feature worth having a test for.
// GITHUB_API_URL is the tool's own documented override.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const TOOL = join(repoRoot, 'tools', 'release', 'verify-validated-commit.mjs');
const SHA = 'b'.repeat(40);
const REPO = 'XChain-Platform/xchain-wallet';

// A stub whose answer CHANGES between polls, which is the whole subject: a
// single fixed answer can prove nothing about a loop. `sequence` is consumed
// one entry per request to the runs endpoint and the last entry repeats, so
// [none, in_progress, success] is "the merge commit's run appears, then
// finishes" and [in_progress] alone is "CI that never concludes".
//
// It runs in its OWN PROCESS for the reason recorded in
// release-gate-diagnosis.smoke.js: execFileSync blocks the event loop it is
// called on, so an in-process server can never answer the request the
// blocked process is waiting for.
const SERVER = `
const http = require('http');
const world = JSON.parse(process.argv[1]);
const REPO = ${JSON.stringify(REPO)};
let n = 0;
const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    let body;
    if (path === '/repos/' + REPO + '/actions/runs') {
        const step = world.sequence[Math.min(n, world.sequence.length - 1)];
        n += 1;
        body = {
            workflow_runs: step.kind === 'none' ? [] : [{
                id: 777,
                path: '.github/workflows/ci.yml',
                status: step.status,
                conclusion: step.conclusion,
                created_at: '2026-08-14T10:00:00Z',
                html_url: 'https://example.invalid/run/777',
            }],
        };
    } else if (path === '/repos/' + REPO + '/actions/runs/777/jobs') {
        body = { jobs: world.jobs || [] };
    } else if (path.startsWith('/repos/' + REPO + '/check-runs/')) {
        body = [];
    }
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body === undefined ? { message: 'not found' } : body));
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT=' + server.address().port + '\\n'));
`;

function serve(world) {
    const child = spawn('node', ['-e', SERVER, JSON.stringify(world)], {
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return new Promise((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('stub server never announced a port')), 10000);
        child.stdout.on('data', (d) => {
            buf += d;
            const m = buf.match(/PORT=(\d+)/);
            if (m) {
                clearTimeout(timer);
                resolve({ port: Number(m[1]), stop: () => child.kill('SIGKILL') });
            }
        });
    });
}

function run(port, extraArgs) {
    const started = Date.now();
    try {
        const out = execFileSync('node', [TOOL, '--repo', REPO, '--sha', SHA, ...extraArgs], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
            env: {
                ...process.env,
                GITHUB_TOKEN: 'stub-token',
                GITHUB_API_URL: `http://127.0.0.1:${port}`,
            },
        });
        return { code: 0, text: out, ms: Date.now() - started };
    } catch (e) {
        return {
            code: e.status ?? 1,
            text: String(e.stdout || '') + String(e.stderr || ''),
            ms: Date.now() - started,
        };
    }
}

async function withServer(world, args, fn) {
    const server = await serve(world);
    try {
        return fn(run(server.port, args));
    } finally {
        server.stop();
    }
}

const RAN = [
    { id: 1, name: 'test', conclusion: 'failure', steps: new Array(9).fill({}) },
];

// 1. The ceremony case, end to end: at merge time there is no run, then
//    there is one and it is running, then it is green. The gate must sit
//    through all of that and pass, having polled rather than guessed.
await withServer({
    sequence: [
        { kind: 'none' },
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'success' },
    ],
}, ['--wait', '--poll', '1', '--wait-timeout', '60'], (r) => {
    assert.equal(r.code, 0,
        `--wait must pass once CI concludes green on the commit, which is the whole point of the `
        + `wait-for-master-CI-green ceremony step.\n${r.text}`);
    assert.ok(/Waiting up to 60s for CI to conclude/.test(r.text),
        'the gate must announce that it is waiting and for how long; an operator watching a silent '
        + 'terminal during a release cannot tell a wait from a hang');
    assert.ok(/still waiting/.test(r.text),
        'each poll must report what it is still waiting on, or the wait is indistinguishable from a '
        + 'process that stopped making requests');
    assert.ok(r.text.includes('the tag commit has a green run of every required workflow'),
        'the pass message must be the same one the no-wait path prints');
});

// 2. THE BUG WORTH TESTING FOR. A wait that runs out of time must REFUSE.
//    A gate that waits and then shrugs is worse than one that never waited,
//    because the ceremony now has a step that looks like it proved
//    something.
await withServer({
    sequence: [{ status: 'in_progress', conclusion: null }],
}, ['--wait', '--poll', '1', '--wait-timeout', '2'], (r) => {
    assert.equal(r.code, 1,
        'CI that never concludes inside the budget is a refusal. Not knowing is a refusal, never a '
        + 'pass, and running out of time is a way of not knowing');
    assert.ok(/RELEASE GATE REFUSED/.test(r.text),
        'a timeout must fail as a gate, not as a stack trace or a warning');
    assert.ok(/WAITED 2s AND CI DID NOT CONCLUDE/.test(r.text),
        'the refusal must say the wait expired, because that reason has a different remedy from '
        + 'every other refusal this tool prints: a longer budget, not a fix to the commit');
});

// 3. Silence is not success, even after a full wait. The merge commit whose
//    push never triggered CI at all is the case that most looks like
//    "nothing is wrong", and it is the one the fail-closed posture exists
//    for.
await withServer({
    sequence: [{ kind: 'none' }],
}, ['--wait', '--poll', '1', '--wait-timeout', '2'], (r) => {
    assert.equal(r.code, 1, 'a commit with no run at all is refused however long the gate waits for one');
    assert.ok(/no run of `ci\.yml` exists for this commit at all/.test(r.text),
        'the refusal must name the absence rather than reporting a generic timeout: a commit CI never '
        + 'ran on and a commit CI is slow on need different fixes');
});

// 4. Waiting must not wait out a verdict. Once a run concludes anything but
//    success the answer is known, and a gate that kept polling would burn
//    the operator's budget on a question already answered - during a
//    release, with a merged PR sitting on master.
await withServer({
    sequence: [
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'failure' },
    ],
    jobs: RAN,
}, ['--wait', '--poll', '1', '--wait-timeout', '120'], (r) => {
    assert.equal(r.code, 1, 'a red run is refused in wait mode exactly as it is without it');
    assert.ok(r.ms < 60_000,
        `the gate must answer as soon as the run concludes, not wait out its budget; it took ${r.ms}ms `
        + 'of a 120s budget');
    assert.ok(!/WAITED 120s/.test(r.text),
        'a run that concluded is not a timeout, and telling the operator to raise the budget would '
        + 'send them away from the red suite that is the actual finding');
    assert.ok(/Make CI green on this exact commit/.test(r.text),
        'the standing advice for a red run must survive in wait mode');
});

// 5. The default posture is unchanged, deliberately. release.yml runs this
//    gate with no --wait and must keep failing fast: by then the tag is
//    pushed and the ceremony has already done its waiting, so a workflow
//    that sat and polled would only burn runner minutes.
await withServer({
    sequence: [{ status: 'in_progress', conclusion: null }],
}, [], (r) => {
    assert.equal(r.code, 1, 'without --wait an unfinished run is refused immediately, as before');
    assert.ok(r.ms < 30_000, `the no-wait path must not poll at all; it took ${r.ms}ms`);
    assert.ok(/pass --wait and let this gate wait for it/.test(r.text),
        'the refusal must point at --wait, since an operator who hits this mid-ceremony has been '
        + 'given a manual re-run to time by hand and that is the habit being replaced');
});

// 6. A wait budget nobody can read is not a budget. Both plausible
//    defaults - wait forever, or do not wait - are opposite behaviours, so
//    an unparseable one refuses rather than picking.
await withServer({
    sequence: [{ status: 'completed', conclusion: 'success' }],
}, ['--wait', '--wait-timeout', 'soon'], (r) => {
    assert.equal(r.code, 1, 'an unparseable --wait-timeout is refused, not defaulted');
    assert.ok(/must be a positive number of\s+seconds/.test(r.text),
        'the refusal must say what a valid budget looks like');
});

console.log('OK: release gate-wait smoke (verify-validated-commit.mjs --wait polls a merge '
    + 'commit\'s CI to a conclusion so the wallet ceremony has a wait-for-master-CI-green step, '
    + 'refuses on timeout, refuses a commit with no run at all however long it waits, answers a '
    + 'red run at once instead of waiting out the budget, leaves the no-wait posture release.yml '
    + 'depends on unchanged, and refuses an unreadable budget)');
