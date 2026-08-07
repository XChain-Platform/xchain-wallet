// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The §6 step-1 gate must tell a red CI run apart from a CI that never
// ran ( S41, ).
//
// The verdict was never the problem. verify-validated-commit.mjs refuses
// anything that is not a green run and always did, fail-closed. What it
// said UNDER the verdict was one sentence - "Make CI green on this exact
// commit" - which silently assumes the suite ran and something in it
// failed.
//
// On 2026-08-07 the tip of xchain-wallet `master` refused here while
// every one of the run's six jobs had died inside two seconds having
// executed ZERO steps: GitHub had stopped starting jobs on the account
// over a billing failure. Nothing was wrong with the commit, no test had
// run, and the gate pointed the operator at a suite to debug. The run
// logs had already expired; the reason was in the check-run annotations,
// one API call away, which nothing in this project had ever read.
//
// Those two failures print identically and mean opposite things: one is
// "fix the commit", the other is "the commit is not the subject, fix the
// account". So the gate now measures which it is - a job that executed
// no steps did no work, whatever its conclusion says - and quotes
// GitHub's own annotation rather than paraphrasing it.
//
// This DRIVES the tool against a stub API rather than reading its
// source, for the reason release-verify-signer.smoke.js does: the defect
// this replaces was invisible to every source-reading assertion in the
// repo, and a test that greps for a string would have gone green on the
// broken version too. GITHUB_API_URL is the tool's own documented
// override, so the stub is the same seam CI uses.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const TOOL = join(repoRoot, 'tools', 'release', 'verify-validated-commit.mjs');
const SHA = 'a'.repeat(40);
const REPO = 'XChain-Platform/xchain-wallet';

const BILLING = "The job was not started because recent account payments have failed "
    + "or your spending limit needs to be increased. Please check the 'Billing & plans' "
    + 'section in your settings';

// One stub, three worlds. `jobs` is the shape that decides everything:
// steps.length === 0 on every job is the never-started signature.
//
// The stub runs in its OWN PROCESS, and that is not a style choice: the
// first cut ran it in this one and deadlocked. execFileSync blocks the
// event loop it is called on, so an in-process server can never answer
// the request the blocked process is waiting for. The suite hung with
// every assertion already satisfied, which is the failure mode a test
// must not have.
const SERVER = `
const http = require('http');
// node -e <script> <arg> puts the argument at argv[1], not argv[2].
const world = JSON.parse(process.argv[1]);
const REPO = ${JSON.stringify(REPO)};
const routes = {
    ['/repos/' + REPO + '/actions/runs']: {
        workflow_runs: [{
            id: 999,
            path: '.github/workflows/ci.yml',
            status: 'completed',
            conclusion: world.conclusion,
            created_at: '2026-08-07T06:39:33Z',
            html_url: 'https://example.invalid/run/999',
        }],
    },
    ['/repos/' + REPO + '/actions/runs/999/jobs']: { jobs: world.jobs },
};
for (const job of world.jobs) {
    routes['/repos/' + REPO + '/check-runs/' + job.id + '/annotations'] = world.annotations || [];
}
const server = http.createServer((req, res) => {
    const body = routes[req.url.split('?')[0]];
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

function run(port) {
    try {
        const out = execFileSync('node', [TOOL, '--repo', REPO, '--sha', SHA], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                GITHUB_TOKEN: 'stub-token',
                GITHUB_API_URL: `http://127.0.0.1:${port}`,
            },
        });
        return { code: 0, text: out };
    } catch (e) {
        return { code: e.status ?? 1, text: String(e.stdout || '') + String(e.stderr || '') };
    }
}

async function withServer(world, fn) {
    const server = await serve(world);
    try {
        return fn(run(server.port));
    } finally {
        server.stop();
    }
}

const NEVER_RAN = 'THE SUITE NEVER RAN';

// 1. The defect itself: a failed run whose jobs executed nothing. The
//    gate must still refuse (the verdict never moves) AND must say the
//    suite never ran, quoting GitHub's reason verbatim rather than
//    summarising it - the operator is going to a billing console on the
//    strength of this line and a paraphrase is not evidence.
await withServer({
    conclusion: 'failure',
    jobs: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `job${id}`, conclusion: 'failure', steps: [] })),
    annotations: [{ annotation_level: 'failure', message: BILLING }],
}, (r) => {
    assert.equal(r.code, 1, 'a run that is not success must still be refused; the diagnosis '
        + 'changes the advice, never the verdict');
    assert.ok(r.text.includes(NEVER_RAN),
        'a failed run whose every job executed zero steps must be reported as a suite that '
        + 'never ran. Without this the operator is sent to debug tests that did not execute.');
    assert.ok(r.text.includes('all 6 job(s) executed ZERO steps'),
        'the gate must state the measurement it made (jobs with no steps), not just its '
        + 'conclusion, or the next reader cannot check it');
    assert.ok(r.text.includes(BILLING),
        "GitHub's own annotation must be quoted verbatim: it is the only durable record "
        + 'once the run logs expire, and it names the account, not the commit');
});

// 2. The other side, and it is the one that keeps this honest: a run
//    that genuinely failed after executing steps must NOT be described
//    as never having run. A diagnosis that fires on everything is worse
//    than none, because it excuses a red suite. One skipped job with
//    zero steps is deliberately included, since that is the ordinary
//    shape of a real run and an over-eager check trips on it.
await withServer({
    conclusion: 'failure',
    jobs: [
        { id: 11, name: 'test', conclusion: 'failure', steps: new Array(9).fill({}) },
        { id: 12, name: 'coverage', conclusion: 'skipped', steps: [] },
    ],
    annotations: [{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }],
}, (r) => {
    assert.equal(r.code, 1, 'a genuinely red suite is still a refusal');
    assert.ok(!r.text.includes(NEVER_RAN),
        'a run whose jobs executed steps DID run, so the never-ran diagnosis must stay '
        + 'silent. Firing here would tell an operator to go fix billing while their tests '
        + 'are red, which is the mirror of the defect this exists to fix.');
    assert.ok(r.text.includes('Make CI green on this exact commit'),
        'the original advice must survive for the case it was written for');
});

// 3. Green is still green. The diagnostic path adds API calls, and a
//    gate that starts refusing valid commits because a helper threw is
//    a worse outage than the one it explains.
await withServer({
    conclusion: 'success',
    jobs: [{ id: 21, name: 'test', conclusion: 'success', steps: new Array(9).fill({}) }],
}, (r) => {
    assert.equal(r.code, 0, 'a green run must still pass the gate');
    assert.ok(r.text.includes('the tag commit has a green run of every required workflow'),
        'the pass message must be unchanged');
});

// 4. The diagnosis is best-effort and the verdict is not. If the jobs
//    endpoint is unreachable the gate must still refuse, with its
//    original advice, rather than crash while explaining itself - the
//    fail-closed posture in this tool's header applies to its own
//    helpers too.
{
    const server = await serve({
        conclusion: 'failure',
        jobs: [{ id: 31, name: 'test', conclusion: 'failure', steps: [] }],
    });
    server.stop();
    const r = run(server.port);
    assert.equal(r.code, 1, 'an unreachable API during diagnosis must still refuse');
    assert.ok(r.text.includes('RELEASE GATE REFUSED'),
        'the gate must fail as a gate, not as a stack trace');
}

console.log('OK: release gate-diagnosis smoke ( S41 / : verify-validated-commit.mjs '
    + 'separates a suite that failed from a suite that never started, measured by jobs that '
    + 'executed zero steps, quotes GitHub\'s own annotation verbatim so the reason survives the '
    + 'logs expiring, leaves a genuinely red run\'s advice alone, still passes green, and still '
    + 'refuses rather than crashing when the diagnostic call cannot be made)');
