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

// Every Phase-1 screen should have a scan case.
const requiredCases = [
    'onboarding welcome',
    'create wallet - password stage',
    'create wallet - mnemonic display stage',
    'import wallet',
    'home (unlocked)',
    'locked',
    'send - form stage',
];
for (const name of requiredCases) {
    assert.ok(
        spec.includes(`'${name}'`) || spec.includes(`"${name}"`),
        `a11y.spec.js covers "${name}"`,
    );
}

// --- 3. Every case asserts zero violations --------------------------

// The shared scan helper does this; confirm its shape.
assert.ok(
    /expect\(\s*results\.violations/.test(spec),
    'scan helper asserts on results.violations',
);
assert.ok(
    /\.toEqual\(\[\]\)/.test(spec),
    'scan helper expects empty violations array',
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
