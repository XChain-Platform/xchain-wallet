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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

// --- 8. Nothing waits on the far side of the KDF with a bare number -
//
// The donation-consent screen renders only AFTER the Argon2id derivation
// that "Create wallet" starts, so any fixed budget in front of it is a bet
// on how fast the runner derives, not on how fast a component paints. That
// bet was lost on roughly a quarter of CI runs: `acknowledgeDonationConsent`
// waited a bare 10s, gave up SILENTLY (it returns false to stay usable on
// the extension popup, which has no consent step), and `createWallet` then
// spent its whole 180s KDF budget waiting for a shell parked behind an
// unanswered screen. The run blamed `unlockedShell` and read as a slow KDF.
// All nine failing and flaky tests of run 30930194072 died on that screen.
//
// The fix is structural rather than a bigger number: race the consent
// button against the unlocked shell, so whichever outcome this shell has
// ends the wait. These assertions pin the two halves that make it work --
// the race, and the absence of a literal - because a future edit that
// reintroduces `timeout: 10_000` here would restore a failure whose symptom
// points at an entirely different line.
const consentFn = fixture.slice(fixture.indexOf('export async function acknowledgeDonationConsent'));
const consentBody = consentFn.slice(0, consentFn.indexOf('\n}\n') + 2);
assert.ok(consentBody.length > 100, 'located acknowledgeDonationConsent in the fixture');
assert.ok(
    /\.or\(unlockedShell\(page\)\)/.test(consentBody),
    'donation-consent wait races the consent button against the unlocked shell',
);
assert.ok(
    /timeout:\s*KDF_STEP_MS/.test(consentBody),
    'donation-consent wait is bounded by the shared KDF budget',
);
assert.ok(
    !/timeout:\s*[0-9]/.test(consentBody),
    'donation-consent wait carries no literal timeout (it sits behind the KDF)',
);

// The a11y spec scans that same screen directly rather than through the
// helper, so it waits on the identical post-derivation render and needs the
// identical budget. It carried a bare 90_000, which is only bigger, not
// correct: the CI budget is 180s.
const a11ySrc = readFileSync(specs.a11y, 'utf8');
assert.ok(
    /kdfStepTimeout/.test(a11ySrc),
    'a11y spec waits on the consent screen with the shared KDF budget',
);
assert.ok(
    !/Support XChain development[\s\S]{0,200}?timeout:\s*[0-9]/.test(a11ySrc),
    'a11y spec pins no literal timeout on the consent heading',
);

// And the invariant those two are instances OF, because pinning instances is
// how this got here. `unlockedShell` is BY DEFINITION the far side of an
// Argon2id derivation - it is what a create or an unlock resolves to - so no
// wait on it may carry a hand-picked number. When was found, five
// of the six call sites did anyway, all at a bare 90_000, which is HALF what
// the budget computes on CI; one of the five (add-wallet-activation) was in
// the flaky set of the same run that produced the hard failure. The budget
// module was extracted for exactly this assertion and only one caller ever
// used it.
const shellWaits = [];
for (const dir of ['fixtures', 'tests']) {
    const stack = [join(e2e, dir)];
    while (stack.length) {
        const at = stack.pop();
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const full = join(at, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.name.endsWith('.js')) shellWaits.push(full);
        }
    }
}
const offenders = [];
for (const file of shellWaits) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!/unlockedShell\(/.test(line)) continue;
        // A named constant or a call is the budget; a digit is a guess.
        if (/timeout:\s*[0-9]/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
}
assert.equal(
    offenders.length, 0,
    `no wait on unlockedShell may pin a literal timeout; use the shared KDF `
    + `budget (kdfStepTimeout / KDF_STEP_MS):\n  ${offenders.join('\n  ')}`,
);

// --- 9. Artifacts do not leak into the repo -------------------------

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
    + 'license bypass tracks buildInfo, no bare timeout behind the KDF, '
    + 'CI runs the suite, artifacts gitignored)',
);
