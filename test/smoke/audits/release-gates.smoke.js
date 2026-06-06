// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
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
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Threat model doc --------------------------------------------

const threatModel = readFileSync(join(wsRoot, 'docs', 'THREAT_MODEL.md'), 'utf8');
for (const section of [
    'Protected tokens',
    'Explicitly in scope',
    'Explicitly out of scope',
    'Attacker scenarios',
    'Known open items',
    'Change review cadence',
    'Verification',
]) {
    assert.ok(
        threatModel.includes(section),
        `THREAT_MODEL.md covers "${section}"`,
    );
}
for (const pointer of [
    'bridge-e2e.smoke.js',
    'unlock-flow.smoke.js',
    'action-decoder.smoke.js',
    'web-onboarding.smoke.js',
]) {
    assert.ok(
        threatModel.includes(pointer),
        `THREAT_MODEL.md cites ${pointer}`,
    );
}
for (const scenario of [
    'Malicious dApp requesting every permission',
    'Password-guessing offline attacker',
    'Malicious approval-window spoof',
    'Dev-SDK-mock addresses reach mainnet',
]) {
    assert.ok(
        threatModel.includes(scenario),
        `THREAT_MODEL.md details "${scenario}"`,
    );
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
    'OK — release-gates smoke (threat model §1–§7, reproducible-build README + check script, dry-run exit 0)',
);
