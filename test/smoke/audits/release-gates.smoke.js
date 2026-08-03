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
import { readFileSync, existsSync } from 'node:fs';
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

// --- 3. Script runs + exits 0 against a clean (no-dist) tree --------

const result = spawnSync('bash', [checkScript], {
    cwd: wsRoot,
    encoding: 'utf8',
});
assert.equal(
    result.status,
    0,
    `check-no-dev-mock.sh exits 0 when no dist exists; stdout: ${result.stdout}`,
);
assert.match(
    result.stdout,
    /no dev-SDK markers in dist/,
    'script reports success cleanly',
);

console.log(
    'OK: release-gates smoke (threat model §1–§7, reproducible-build README + check script, dry-run exit 0)',
);
