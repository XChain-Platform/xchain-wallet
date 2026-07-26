// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 18 (axe-core a11y gate).
//
// Playwright + axe can't run here, so verify:
//   1. `@axe-core/playwright` is declared as a dev dep on the e2e package.
//   2. the shared scan harness (`fixtures/a11y.js`) exists and imports
//      AxeBuilder, and `tests/a11y/a11y.spec.js` covers every Phase-1
//      screen (onboarding, create password + mnemonic, import, home,
//      locked, send).
//   3. Each scan asserts `violations` is empty (not just "no crash").
//   6. The confirm surface is scanned on the REGTEST venue, in both §4.2
//      verdict states at both widths ( §8.6). It cannot live in the
//      dev suite: the confirm page needs a successful compose, which the
//      dev shell can no longer do .
//   4. WCAG 2.1 A + AA tags are the target severity.
//   5. README documents the a11y spec.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const e2e = join(wsRoot, 'test', 'e2e');

// --- 1. dev dep -----------------------------------------------------

const pkg = JSON.parse(readFileSync(join(e2e, 'package.json'), 'utf8'));
assert.ok(
    pkg.devDependencies?.['@axe-core/playwright'],
    'e2e declares @axe-core/playwright as a dev dep',
);

// --- 2. a11y spec ---------------------------------------------------

const spec = readFileSync(join(e2e, 'tests', 'a11y', 'a11y.spec.js'), 'utf8');
// The scan itself lives in a fixture so the dev-server and regtest a11y
// suites cannot drift on what counts as a violation or how it is reported.
const harness = readFileSync(join(e2e, 'fixtures', 'a11y.js'), 'utf8');
assert.ok(
    /import AxeBuilder from '@axe-core\/playwright'/.test(harness),
    'the shared scan harness imports AxeBuilder',
);
assert.ok(
    /from '\.\.\/\.\.\/fixtures\/a11y\.js'/.test(spec),
    'a11y.spec.js drives the shared harness rather than its own copy',
);

// Every screen the onboarding walk reaches should have a scan case. The
// license gate, the recovery-phrase verification stage and the donation
// consent screen all shipped UNSCANNED because this list was never
// updated and nothing ran the suite; they are required here now.
const requiredCases = [
    'license gate',
    'onboarding welcome',
    'create wallet: password stage',
    'create wallet: mnemonic display stage',
    'create wallet: recovery-phrase verification stage',
    'donation consent',
    'import wallet',
    'home (unlocked)',
    'locked',
    'send: form stage',
];
for (const name of requiredCases) {
    assert.ok(
        spec.includes(`'${name}'`) || spec.includes(`"${name}"`),
        `a11y.spec.js covers "${name}"`,
    );
}

// --- 3. Every case asserts zero violations --------------------------

// The shared scan helper still asserts an EMPTY violation set...
assert.ok(
    /\.toEqual\(\[\]\)/.test(harness),
    'scan helper expects an empty violations array',
);

// The  palette contrast debt this suite used to quarantine is fixed
// (tokens.css default light theme now clears AA), so the quarantine and its
// self-retiring anchor test are gone. Guard against a silent regression
// back to a wholesale rule bypass instead.
assert.ok(
    !/KNOWN_CONTRAST_DEBT/.test(harness + spec),
    'the  contrast quarantine was removed once the palette was fixed',
);
assert.ok(
    !/disableRules|withRules\(/.test(harness + spec),
    'a11y spec does not switch off axe rules wholesale',
);

// A scan racing a CSS fade reads blended colours and reports phantom
// contrast failures, so the paint must be settled before axe runs.
assert.ok(
    /freezeMotion/.test(harness),
    'scan settles animations before analysing (no mid-fade phantom colours)',
);

// --- 4. WCAG 2.1 A + AA -------------------------------------------

for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']) {
    assert.ok(harness.includes(tag), `the scan harness targets ${tag}`);
}

// --- 6. The confirm surface ( §8.6 "axe-core popup + full") ----

// This is the screen every signature passes through, and it went unscanned
// while coverage stopped at the Send FORM. Both verdict states matter: only
// the fail state renders the error list, the per-finding override checkboxes
// and aria-live="assertive".
const confirmScan = readFileSync(
    join(e2e, 'tests', 'a11y', 'confirm-a11y.regtest.spec.js'), 'utf8',
);
assert.ok(
    /from '\.\.\/\.\.\/fixtures\/a11y\.js'/.test(confirmScan),
    'the confirm scan uses the same harness as every other screen',
);
for (const state of ['Looks good', 'Will likely fail']) {
    assert.ok(confirmScan.includes(state), `the confirm scan covers the "${state}" verdict`);
}
// A mid-test resize does not re-mount the responsive shell, so the narrow
// arm has to be its own context or it is not testing the popup layout.
assert.ok(
    /test\.use\(\{ viewport: POPUP \}\)/.test(confirmScan),
    'the popup-width arm sets its viewport before mounting, not by resizing',
);
assert.ok(
    !/setViewportSize/.test(confirmScan),
    'the confirm scan does not resize an already-mounted page',
);

// --- 5. README --------------------------------------------------

const readme = readFileSync(join(e2e, 'README.md'), 'utf8');
assert.ok(
    /@axe-core\/playwright/.test(readme),
    'README mentions @axe-core/playwright',
);
assert.ok(/WCAG/.test(readme), 'README names the WCAG target');

console.log(
    `OK: a11y harness smoke (dev dep, ${requiredCases.length} screens covered, violations=[] assertion, WCAG 2.1 A/AA tags, README)`,
);
