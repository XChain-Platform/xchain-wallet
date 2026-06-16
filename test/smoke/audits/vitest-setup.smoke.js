// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 15 (Vitest in core).
//
// Can't execute Vitest itself without `pnpm install` — this smoke
// verifies the harness is wired correctly. Once CI runs, the real
// `pnpm -C packages/core test` step exercises the suites.
//
// Asserts:
//   1. vitest.config.js exists with the right env + plugin + include pattern.
//   2. setup.js loads jest-dom + webcrypto polyfill.
//   3. Every .test.{js,jsx} under test/ references vitest (not node:assert).
//   4. Every test file references at least one symbol from the module
//      under test.
//   5. Existing *.smoke.js files are excluded from the Vitest include.
//   6. core/package.json declares test + test:coverage scripts and the
//      Vitest devDep set.
//   7. The _run-smokes.js runner picks up every *.smoke.js.
//   8. .gitignore excludes /packages/*/coverage so local coverage runs
//      don't leak into git.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = join(here, '..', '..', '..');
const wsRoot = join(corePkg, '..', '..');

// --- 1. vitest.config.js -------------------------------------------

const vitestCfg = readFileSync(join(corePkg, 'vitest.config.js'), 'utf8');
assert.ok(/environment:\s*'jsdom'/.test(vitestCfg), 'jsdom test env declared');
assert.ok(
    /import react from '@vitejs\/plugin-react'/.test(vitestCfg),
    'vitest config pulls in @vitejs/plugin-react',
);
assert.ok(
    /include:\s*\[\s*'test\/\*\*\/\*\.test\.\{js,jsx\}'/.test(vitestCfg),
    'include pattern scopes to *.test.{js,jsx}',
);
assert.ok(
    /exclude:\s*\[\s*'test\/\*\*\/\*\.smoke\.js'/.test(vitestCfg),
    'excludes *.smoke.js so Node-script smokes stay independent',
);
assert.ok(/setupFiles:\s*\['\.\/test\/setup\.js'\]/.test(vitestCfg), 'setup file wired');
assert.ok(/provider:\s*'v8'/.test(vitestCfg), 'uses v8 coverage provider');

// --- 2. test/setup.js ----------------------------------------------

const setup = readFileSync(join(corePkg, 'test', 'setup.js'), 'utf8');
assert.ok(
    /@testing-library\/jest-dom\/vitest/.test(setup),
    'setup imports jest-dom Vitest matchers',
);
assert.ok(/webcrypto/.test(setup), 'setup polyfills webcrypto for Node 18');

// --- 3/4. Every *.test.{js,jsx} is a Vitest suite with module references -

const testDir = join(corePkg, 'test');
const testFiles = collectRecursive(testDir).filter(
    (p) => /\.test\.(js|jsx)$/.test(p),
);
assert.ok(testFiles.length >= 5, `expected ≥5 Vitest suites, got ${testFiles.length}`);

const sourceModules = {
    'decoder.test.js': 'decodeAction',
    'Button.test.jsx': 'Button',
    'Input.test.jsx': 'Input',
    'ChainBadge.test.jsx': 'ChainBadge',
    'CopyButton.test.jsx': 'CopyButton',
};

for (const file of testFiles) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
        /from ['"]vitest['"]|from ['"]vitest\//.test(src),
        `${file} imports from vitest`,
    );
    const baseName = file.split('/').pop();
    const symbol = sourceModules[baseName];
    if (symbol) {
        assert.ok(
            new RegExp(`\\b${symbol}\\b`).test(src),
            `${baseName} references ${symbol}`,
        );
    }
}

// --- 5. *.smoke.js files are still present alongside .test files ----

const smokeFiles = collectRecursive(testDir).filter((p) =>
    p.endsWith('.smoke.js'),
);
assert.ok(
    smokeFiles.length >= 10,
    `expected ≥10 Node-script smokes, got ${smokeFiles.length}`,
);

// --- 6. core/package.json scripts + devDeps ------------------------

const pkg = JSON.parse(readFileSync(join(corePkg, 'package.json'), 'utf8'));
assert.equal(pkg.scripts?.test, 'vitest run');
assert.equal(pkg.scripts?.['test:coverage'], 'vitest run --coverage');
assert.equal(pkg.scripts?.['test:smoke'], 'node test/_run-smokes.js');
for (const dep of [
    'vitest',
    '@vitest/coverage-v8',
    'jsdom',
    '@testing-library/react',
    '@testing-library/jest-dom',
    '@vitejs/plugin-react',
]) {
    assert.ok(
        pkg.devDependencies?.[dep],
        `core devDependencies declare ${dep}`,
    );
}

// --- 7. _run-smokes.js picks up *.smoke.js -------------------------

assert.ok(
    existsSync(join(testDir, '_run-smokes.js')),
    '_run-smokes.js runner present',
);
const runner = readFileSync(join(testDir, '_run-smokes.js'), 'utf8');
assert.ok(/\.smoke\.js/.test(runner), 'runner targets *.smoke.js');

// --- 8. .gitignore coverage ---------------------------------------

const gitignore = readFileSync(join(wsRoot, '.gitignore'), 'utf8');
assert.ok(
    /packages\/\*\/coverage/.test(gitignore),
    '.gitignore excludes per-package coverage directories',
);

console.log(
    `OK — vitest setup smoke (config, setup, ${testFiles.length} test suite(s), ${smokeFiles.length} smoke(s), devDeps, runner, gitignore)`,
);

// ---------------------------------------------------------------------

function collectRecursive(root) {
    const out = [];
    (function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(full);
        }
    })(root);
    return out;
}
