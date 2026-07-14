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
//   2. `tests/a11y.spec.js` exists, imports AxeBuilder, and covers every
//      Phase-1 screen (onboarding, create password + mnemonic, import,
//      home, locked, send).
//   3. Each scan asserts `violations` is empty (not just "no crash").
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
assert.ok(
    /import AxeBuilder from '@axe-core\/playwright'/.test(spec),
    'spec imports AxeBuilder',
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
    /\.toEqual\(\[\]\)/.test(spec),
    'scan helper expects an empty violations array',
);

// ...minus a bounded quarantine for the known palette contrast debt.
// The quarantine is only legitimate while it is (a) narrow and (b) able
// to expire, so pin both properties rather than the helper's variable
// names, which are free to change.
assert.ok(
    /KNOWN_CONTRAST_DEBT/.test(spec),
    'contrast debt is declared explicitly, not silently disabled via axe rule config',
);
assert.ok(
    !/disableRules|withRules\(/.test(spec),
    'a11y spec does not switch off axe rules wholesale',
);
assert.ok(
    /no longer\s*\n?\s*.{0,40}reproduces|delete the exception/i.test(spec),
    'a self-retiring check fails once the debt is fixed, forcing the exception out',
);

// A scan racing a CSS fade reads blended colours and reports phantom
// contrast failures, so the paint must be settled before axe runs.
assert.ok(
    /freezeMotion/.test(spec),
    'scan settles animations before analysing (no mid-fade phantom colours)',
);

// --- 4. WCAG 2.1 A + AA -------------------------------------------

for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']) {
    assert.ok(spec.includes(tag), `a11y.spec targets ${tag}`);
}

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
