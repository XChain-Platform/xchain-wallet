// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 16 (Playwright harness).
//
// Playwright itself can't run here (no workspace-installed browsers),
// so this smoke verifies the harness is wired correctly: config,
// specs exist and reference the expected symbols, workspace + CI know
// about the new package.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const e2e = join(wsRoot, 'test', 'e2e');

// --- 1. Workspace + package.json ------------------------------------

const workspace = readFileSync(
    join(wsRoot, 'pnpm-workspace.yaml'),
    'utf8',
);
assert.ok(/^\s*-\s*['"]?test\/e2e['"]?\s*$/m.test(workspace), 'pnpm-workspace.yaml includes test/e2e');

const e2ePkg = JSON.parse(readFileSync(join(e2e, 'package.json'), 'utf8'));
assert.equal(e2ePkg.name, '@xchain-wallet/e2e');
assert.match(e2ePkg.scripts?.test ?? '', /^playwright test/, 'test script runs playwright test');
assert.ok(e2ePkg.devDependencies?.['@playwright/test'], 'declares @playwright/test');
assert.ok(e2ePkg.scripts?.['install:browsers'], 'has install:browsers script');

// --- 2. playwright.config.js ----------------------------------------

const cfg = readFileSync(join(e2e, 'playwright.config.js'), 'utf8');
assert.ok(/testDir:\s*'\.\/tests'/.test(cfg), 'testDir points at ./tests');
assert.ok(/workers:\s*1/.test(cfg), 'workers=1 (single vault per run)');
assert.ok(
    /command:\s*'pnpm -C \.\.\/\.\.\/packages\/web dev'/.test(cfg),
    'webServer spawns the web Vite dev server',
);
assert.ok(/url:\s*'http:\/\/localhost:5173'/.test(cfg), 'webServer url is 5173');
assert.ok(/retries:\s*process\.env\.CI \? 2 : 0/.test(cfg), 'retries only on CI');
assert.ok(
    /trace:\s*'retain-on-failure'/.test(cfg),
    'trace retained on failure',
);

// --- 3. Specs exist + cover the documented flows --------------------

const specs = {
    onboarding: join(e2e, 'tests', 'onboarding', 'onboarding.spec.js'),
    licenseGate: join(e2e, 'tests', 'onboarding', 'license-gate.spec.js'),
    send: join(e2e, 'tests', 'send', 'send-form.spec.js'),
    a11y: join(e2e, 'tests', 'a11y', 'a11y.spec.js'),
};
for (const [name, file] of Object.entries(specs)) {
    assert.ok(existsSync(file), `${name} spec exists`);
}

// --- 5. Every spec drives the app through the SHARED fixture --------
//
// This is the invariant that keeps the suite alive. Onboarding is the
// most-churned surface in the wallet: it grew a license gate, a
// recovery-phrase verification stage and a donation-consent screen, and
// because all 15 specs had each inlined their own copy of the create-
// wallet walk, every one of them broke at the first click. The walk now
// lives in exactly one place. A spec that re-implements it is a spec
// that will rot on the next onboarding change.
//
// Deliberately NOT asserted here: individual test titles or UI copy. The
// previous version of this smoke grepped for phrases like "review + back
// preserves form state" and a list of button labels, which is why it
// stayed green while every spec it was guarding was broken -- it pinned
// the suite's prose, not its behaviour. Whether the specs actually pass
// is the E2E job's business (see below), not a source-scanner's.
// (The onboarding and a11y specs still drive the creation screens
// directly -- one tests that walk, the other scans its intermediate
// stages -- so "never touch onboarding" is not the rule. The rule is
// that the walk has ONE canonical implementation and every spec that
// just needs a wallet calls it.)
for (const [name, file] of Object.entries(specs)) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
        /from '\.\.\/\.\.\/fixtures\/wallet\.js'/.test(src),
        `${name} spec imports the shared wallet fixture`,
    );
}
const sendSrc = readFileSync(specs.send, 'utf8');
assert.ok(
    /createWallet\(/.test(sendSrc),
    'send spec seeds its wallet through the fixture helper, not an inlined walk',
);

// --- 6. The license-gate bypass tracks the app's own constant -------
//
// The fixture seeds the acceptance keys so specs land on Welcome. That
// bypass MUST derive the version from buildInfo.js: acceptance is
// version-bound, so a hardcoded literal would silently stop matching on
// the next terms bump and the gate would re-fire in front of every spec
// -- resurrecting exactly the failure this suite just recovered from.
const fixture = readFileSync(join(e2e, 'fixtures', 'wallet.js'), 'utf8');
assert.ok(
    /import \{ LICENSE_VERSION \} from '.*buildInfo\.js'/.test(fixture),
    'fixture imports LICENSE_VERSION from the app rather than hardcoding it',
);
assert.ok(
    /acceptLicense/.test(fixture),
    'fixture exposes an acceptLicense option so the gate itself stays testable',
);

// --- 7. CI actually RUNS the suite ----------------------------------
//
// The root cause of the rot. The specs, the config and the browsers were
// all present and correct; nothing executed them, so they decayed into
// 15/15 failing without a single red build. A suite that no job runs is
// not a safety net, it is a claim of one.
const ci = readFileSync(join(wsRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
assert.ok(/^\s{2}e2e:/m.test(ci), 'ci.yml defines an e2e job');
assert.ok(/pnpm test:e2e/.test(ci), 'ci.yml runs the e2e suite');
assert.ok(
    /playwright install/.test(ci),
    'ci.yml installs the browser binaries the suite needs',
);

// --- 8. Artifacts do not leak into the repo -------------------------

const gitignore = readFileSync(join(wsRoot, '.gitignore'), 'utf8');
assert.ok(
    /test\/e2e\/test-results/.test(gitignore),
    '.gitignore covers Playwright test-results (traces, videos, screenshots)',
);

const readme = readFileSync(join(e2e, 'README.md'), 'utf8');
assert.ok(readme.length > 200, 'README is non-trivial');
assert.ok(/playwright/i.test(readme), 'README mentions playwright');

console.log(
    'OK: e2e harness smoke (workspace + config wiring, 4 specs on the shared fixture, '
    + 'license bypass tracks buildInfo, CI runs the suite, artifacts gitignored)',
);
