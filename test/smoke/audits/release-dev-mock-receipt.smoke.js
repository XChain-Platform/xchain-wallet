// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sign.sh writes `# dev-mock-gate: enforced` into the SIGNED manifest, and
// the desktop updater refuses any release whose header is not exactly that
// word. This file holds that word to a gate that actually read something.
//
//  S38, and the finding is about WHICH TREE runs. sign.sh comes from
// the checkout that invoked it; the gate script it runs comes from --repo,
// the tree at the release tag. Those are routinely different, by design:
// --repo is what lets a current sign.sh sign an older tag's artifacts, and
// it is how the only signed manifest this project has published was made
// (v0.336.0, --lane android, by a sign.sh that tag does not contain).
//
// The empty-scan refusal built for the gate in S33 therefore lives in the
// TAG's copy, and every tag cut before it has a copy that does not take
// --artifacts. Driven against v0.336.0: the flag is ignored, the pristine
// clone's absent dist/ trees are scanned, `OK` comes back, exit 0, and
// `enforced` is written on a scan that read zero bytes.
//
// So the check is the gate's RECEIPT, not its exit status: only a gate that
// really opened staged bundles can say how many it opened. Every case below
// drives the real sign.sh against a stub gate, because the point is what
// sign.sh does with an answer it did not write.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
    chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const SIGN = join(root, 'tools/release/sign.sh');
const TAG = 'v9.9.9';

const work = mkdtempSync(join(tmpdir(), 'xc997-devmock-receipt-'));

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A --repo fixture: a pristine clone at the tag, exactly what sign.sh
// demands, carrying ONLY the files it reads out of that tree. The gate
// script is a stub, because what is under test is sign.sh's reading of the
// gate's answer rather than the real gate's own behaviour (release-gates
// .smoke.js owns that).
const makeRepo = (gateBody) => {
    const repo = mkdtempSync(join(work, 'repo-'));
    mkdirSync(join(repo, 'tools', 'release'), { recursive: true });
    mkdirSync(join(repo, 'tools', 'build-reproduce'), { recursive: true });
    for (const f of ['lib.sh', 'sign.sh', 'expected-artifacts.txt',
        'shipped-lanes.txt', 'update-info.mjs', 'verify-signatures.mjs',
        'store-profile-status.txt']) {
        cpSync(join(root, 'tools/release', f), join(repo, 'tools/release', f));
    }
    const gate = join(repo, 'tools/build-reproduce/check-no-dev-mock.sh');
    writeFileSync(gate, gateBody);
    chmodSync(gate, 0o755);
    git(repo, ['init', '-q', '.']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.email=smoke@test.invalid', '-c', 'user.name=smoke',
        'commit', '-qm', 'init']);
    // tag.gpgsign=false: this throwaway repo must not inherit the operator's
    // global git config, which turns a lightweight tag into a signed one and
    // fails it. The same guard release-tools.smoke.js documents.
    git(repo, ['-c', 'tag.gpgsign=false', 'tag', TAG]);
    return repo;
};

// The staged input. Deliberately NOT a valid release set: the dev-mock gate
// runs before the artifact-set gate, so a case that gets past the receipt
// check fails later and differently, and that difference is what the green
// guards below assert. A fixture that also satisfied the later gates would
// make "passed the receipt check" and "signed a release" the same result.
const stage = () => {
    const dir = mkdtempSync(join(work, 'stage-'));
    writeFileSync(join(dir, `xchain-wallet-extension-${TAG}.zip`), 'not a real zip\n');
    return dir;
};

// Runs the REAL sign.sh. XCHAIN_RELEASE_GPG_KEY is set to a fingerprint no
// keyring holds, because sign.sh refuses outright without one and that
// refusal comes BEFORE the dev-mock gate: without it every case here would
// stop for the wrong reason and assert nothing. Nothing is ever signed - a
// run that gets that far fails at gpg, later than anything asserted below.
const runSign = (repo, extraEnv = {}) => {
    try {
        const out = execFileSync('bash', [SIGN, '--tag', TAG,
            '--repo', repo, '--input', stage()], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                XCHAIN_RELEASE_GPG_KEY: '0000000000000000000000000000000000000000',
                ...extraEnv,
            },
            timeout: 60_000,
        });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: `${String(e.stdout || '')}${String(e.stderr || '')}` };
    }
};

const RECEIPT_REFUSAL = 'exited 0 without saying it read anything';

// --- 1. The real defect: a pre---artifacts gate, exactly as v0.336.0 -----
//
// Reproduces the tag's gate verbatim: it does not know the flag, scans the
// repo's (absent) dist trees, prints the old OK line, exits 0.
{
    const repo = makeRepo([
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo "SKIP packages/web/dist (not built)"',
        'echo "SKIP packages/extension/dist (not built)"',
        'echo "OK - no dev-SDK markers in dist/, real xchain-sdk present"',
        '',
    ].join('\n'));

    const r = runSign(repo);
    assert.ok(!r.ok, 'sign.sh must refuse when the gate reports OK having read nothing');
    assert.match(r.out, new RegExp(RECEIPT_REFUSAL),
        'sign.sh accepted an OK line from a gate that never opened a staged bundle. That is how '
        + 'the v0.336.0 manifest came to say `dev-mock-gate: enforced` on a scan of zero bytes, and '
        + 'the desktop updater reads that word as proof the gate ran:\n' + r.out);
    assert.doesNotMatch(r.out, /artifact-set gate/,
        'the refusal must happen AT the dev-mock gate, before any later gate. If a later gate is '
        + 'reached, sign.sh accepted the empty scan and something else stopped the release.');
}

// --- 2. Green guard: a gate that says what it read gets past this ---------
//
// The one case that must NOT be refused here. It still fails, later and for
// a different reason (the fixture is not a real release), which is the
// assertion: the receipt check is not a way to fail everything.
{
    const repo = makeRepo([
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo "OK - 2 bundle(s) scanned, no dev-SDK markers, real xchain-sdk present"',
        '',
    ].join('\n'));

    const r = runSign(repo);
    assert.doesNotMatch(r.out, new RegExp(RECEIPT_REFUSAL),
        'sign.sh refused a gate that reported reading two bundles. This check exists to catch a '
        + 'gate that read NOTHING; firing on one that read something makes every release '
        + 'unsignable, and a check that is red when nothing is wrong is one people waive:\n' + r.out);
}

// --- 3. Zero is not a number of bundles ----------------------------------
//
// The receipt has to be counted, not just matched. A gate reporting a clean
// scan of nothing is the same claim as case 1 in tidier words.
{
    const repo = makeRepo([
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'echo "OK - 0 bundle(s) scanned, clean; 3 not built and not scanned"',
        '',
    ].join('\n'));

    const r = runSign(repo);
    assert.match(r.out, new RegExp(RECEIPT_REFUSAL),
        'sign.sh accepted a receipt of zero bundles. `enforced` would then mean "a gate ran and '
        + 'looked at nothing", which is the state this whole check exists to name:\n' + r.out);
}

// --- 4. A gate that FAILS still stops the release ------------------------
//
// The receipt check sits after the exit-status check and must not have
// swallowed it: the output is captured now rather than streamed, and a
// captured failure is easy to lose.
{
    const repo = makeRepo([
        '#!/usr/bin/env bash',
        'echo "FAIL packages/extension/dist contains dev-SDK marker"',
        'echo "Pre-release gate FAILED - dev-SDK stub leaked into a production bundle,"',
        'exit 1',
        '',
    ].join('\n'));

    const r = runSign(repo);
    assert.ok(!r.ok, 'a failing dev-mock gate must stop the signing run');
    assert.match(r.out, /dev-mock gate FAILED/,
        'a gate that exits non-zero must be reported as a FAILED gate, not as a missing receipt. '
        + 'The two are different diagnoses and the operator acts differently on each:\n' + r.out);
    assert.match(r.out, /dev-SDK marker/,
        "the gate's own output must reach the operator. It is captured rather than streamed now, "
        + 'so a release refused for a real leak must still say what leaked:\n' + r.out);
}

// --- 5. The deliberate skip is still deliberate --------------------------
//
// SIGN_SKIP_DEV_MOCK_CHECK exists for artifact sets with no dist tree and
// records SKIPPED in the header. The receipt check must not turn it into a
// second, silent way to demand a gate that was deliberately not run.
{
    const repo = makeRepo([
        '#!/usr/bin/env bash',
        'echo "this gate must never run"',
        'exit 1',
        '',
    ].join('\n'));

    const r = runSign(repo, { SIGN_SKIP_DEV_MOCK_CHECK: '1' });
    assert.doesNotMatch(r.out, new RegExp(RECEIPT_REFUSAL),
        'the documented skip must not be blocked by the receipt check. It has its own honest '
        + 'header word (SKIPPED) and refusing it here would push operators toward the escape '
        + 'hatch this check is meant to keep visible:\n' + r.out);
    assert.match(r.out, /dev-mock gate SKIPPED/,
        'the skip must still announce itself:\n' + r.out);
}

// --- 6. The receipt this file demands is the one the real gate prints ----
//
// Cases 1-5 drive stubs, so on their own they would keep passing if the
// real gate's wording changed and nothing could ever produce a receipt
// again. This is the one assertion tying the contract to the shipped gate.
{
    const gate = join(root, 'tools/build-reproduce/check-no-dev-mock.sh');
    const src = execFileSync('cat', [gate], { encoding: 'utf8' });
    assert.match(src, /OK - \$scanned bundle\(s\) scanned/,
        'check-no-dev-mock.sh no longer prints the "N bundle(s) scanned" receipt that sign.sh '
        + 'requires before it will write `enforced`. Change both together: as it stands, no gate '
        + 'can satisfy sign.sh and no release can be signed at all.');
}

rmSync(work, { recursive: true, force: true });

console.log('OK  release dev-mock receipt: sign.sh writes `enforced` only for a gate that read '
    + 'the staged bundles (6 cases, --repo and the invoking checkout being different trees)');
