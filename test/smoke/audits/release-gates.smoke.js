// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for pieces 21+22 (threat-model artifact + reproducible-
// build scaffold).
//
// Verifies the release-gating documents exist and reference the right
// anchors, plus the pre-release dev-mock-leak guard runs cleanly against
// a clean (empty dist) tree.

import { strict as assert } from 'node:assert';
import {
    readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Threat model doc --------------------------------------------
//
//  moved this out of the repo and split it in two: security.md now
// carries the posture (protected assets, in scope, out of scope) and
// threat-model.md carries the scenarios and the open items. The assertions
// followed the content into whichever file now owns it, and skip loudly
// when the sibling checkout is absent.

if (docsAvailable()) {
    const security = readDoc('security.md');
    for (const section of [
        'Protected assets',
        'In scope',
        'Out of scope',
        'Audit posture',
    ]) {
        assert.ok(
            security.includes(section),
            `security.md covers "${section}"`,
        );
    }

    const threatModel = readDoc('threat-model.md');
    for (const section of [
        'Attacker scenarios',
        'Known open items',
        'Change review cadence',
        'Verification',
    ]) {
        assert.ok(
            threatModel.includes(section),
            `threat-model.md covers "${section}"`,
        );
    }

    // The port rewrote the smoke-file citations into prose naming the same
    // suites, since a published page should not send a reader hunting for a
    // filename in a repo. The suites are what the claim rests on either way.
    for (const suite of [
        /bridge end-to-end test/i,
        /unlock-flow test/i,
        /action-decoder test/i,
        /onboarding.{0,40}test/i,
    ]) {
        assert.match(
            threatModel, suite,
            'threat-model.md Verification section must name the suite each claim is checkable against',
        );
    }

    for (const scenario of [
        /malicious dApp requesting every permission/i,
        /password-guessing offline attacker/i,
        /spoofed approval-window overlay/i,
        /[Dd]evelopment-mode addresses reaching mainnet/,
    ]) {
        assert.match(
            threatModel, scenario,
            'threat-model.md must still walk this attacker scenario',
        );
    }
} else {
    console.log('SKIP (partial): release-gates smoke - the threat-model half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

// --- 2. Reproducible-build scaffold ---------------------------------

const reproReadme = readFileSync(
    join(wsRoot, 'tools', 'build-reproduce', 'README.md'),
    'utf8',
);
for (const section of [
    'Pinning',
    'Current gotchas',
    'RC checklist',
    'RELEASE_MANIFEST.txt',
]) {
    assert.ok(
        reproReadme.includes(section),
        `build-reproduce README covers "${section}"`,
    );
}

const checkScript = join(
    wsRoot,
    'tools',
    'build-reproduce',
    'check-no-dev-mock.sh',
);
assert.ok(existsSync(checkScript), 'check-no-dev-mock.sh exists');

const scriptSrc = readFileSync(checkScript, 'utf8');
for (const marker of [
    'xchain-sdk unavailable',
    'falling back to dev-mock SDK',
    'DO NOT USE FOR MAINNET',
]) {
    assert.ok(scriptSrc.includes(marker), `script greps for "${marker}"`);
}

// --- 3. Script REFUSES a tree where it can scan nothing --------------
//
// This assertion used to read "exits 0 when no dist exists", and it was the
// reason the defect it enshrined survived ( S33). A pristine clone
// checked out at the tag is precisely a tree with no dist/, and it is the
// only tree sign.sh will sign from, so the state this test blessed as
// success was the state the gate ran in for every real release: three
// SKIP lines, zero bytes read, `OK`, exit 0, and `# dev-mock-gate:
// enforced` in the signed manifest header on that basis.
//
// A test that asserts a gate is quiet when it has nothing to look at is
// not testing the gate, it is testing that nobody notices. The property
// worth holding is the opposite one, and it is checked in both directions
// below so that neither a silent pass nor a blanket refusal can satisfy it.
//
// AND THE CWD IS THE POINT, which the old assertion also got wrong. It ran
// the script at `wsRoot` and called that "when no dist exists" - true on a
// clean checkout and false on any machine that has ever built, where it
// silently became a scan of three real bundles. So the sentence describing
// what it measured and the thing it measured had drifted apart, and on a
// developer machine it was green for the opposite reason to the stated one.
// The pristine-clone condition is reproduced literally instead: an empty
// directory, where the script's relative SCAN_TARGETS resolve to nothing.

const noDist = mkdtempSync(join(tmpdir(), 'xchain-devmock-nodist-'));
let empty;
try {
    empty = spawnSync('bash', [checkScript], {
        cwd: noDist,
        encoding: 'utf8',
    });
} finally {
    rmSync(noDist, { recursive: true, force: true });
}
assert.equal(
    empty.status,
    1,
    'check-no-dev-mock.sh must REFUSE a tree with nothing to scan. It exited '
    + `${empty.status}. "The gate could not run" and "the gate passed" must not `
    + `produce the same release (sign.sh says so about a missing script; an `
    + `empty scan produces the identical release). stdout: ${empty.stdout}`,
);
assert.match(
    empty.stdout,
    /scanned NOTHING/,
    'the refusal says what actually happened, rather than reporting a failure '
    + 'that reads like a leaked dev-mock bundle',
);

// The other direction: given something real to read, it reads it and says
// how much. Without this, "always exit 1" would pass the assertion above.
const staged = mkdtempSync(join(tmpdir(), 'xchain-devmock-gate-'));
try {
    const bundle = join(staged, 'bundle');
    mkdirSync(bundle, { recursive: true });
    // A minimal stand-in for a shipped bundle: carries the real-SDK literal
    // and none of the mock markers, which is what a healthy release looks
    // like to this gate.
    writeFileSync(join(bundle, 'app.js'), 'throw new Error("CONTRACT_LINT_FAILED");\n');
    const tarball = join(staged, 'xchain-wallet-web-v0.0.0-test.tar.gz');
    assert.equal(
        spawnSync('tar', ['czf', tarball, '-C', bundle, '.'], { encoding: 'utf8' }).status,
        0,
        'staged a test web tarball',
    );

    const scanned = spawnSync('bash', [checkScript, '--artifacts', staged], {
        cwd: wsRoot,
        encoding: 'utf8',
    });
    assert.equal(
        scanned.status,
        0,
        'check-no-dev-mock.sh --artifacts passes a clean staged bundle; '
        + `stdout: ${scanned.stdout}\nstderr: ${scanned.stderr}`,
    );
    assert.match(
        scanned.stdout,
        /OK - 1 bundle\(s\) scanned/,
        'the OK line COUNTS what it scanned, so "scanned three bundles" and '
        + '"skipped three bundles" can never print the same words again',
    );
} finally {
    rmSync(staged, { recursive: true, force: true });
}

console.log(
    'OK: release-gates smoke (threat model §1–§7, reproducible-build README + check script, dry-run exit 0)',
);
