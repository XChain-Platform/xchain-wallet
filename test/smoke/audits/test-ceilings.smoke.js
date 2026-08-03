// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  / : the suite's time ceilings must be sized by the
// machine running them, not by the machine they were written on.
//
// WHAT THIS IS DEFENDING. `ci.yml` was red on master for its last forty runs,
// and `tools/release/verify-validated-commit.mjs` refuses to cut a signed
// release unless CI concluded SUCCESS on the tag commit - deliberately, with
// no skip switch. So a suite that only passes on one laptop is a release
// blocker. When it was finally measured (run 30827175941, 2026-08-03) the
// seven failing tests turned out to be five ceiling overruns and were not
// seven defects:
//
//   test/unit/import-exports.test.js       timed out at its explicit 60s
//   test/unit/routes/PairPartnerWallet     timed out at the 20s default
//   test/unit/crypto/{kdf,backup,walletBlob}  timed out at the argon2id 120s
//
// The 120s was itself a fix, from the round before, and it closed the `test`
// job while leaving `coverage` red - because it was derived from coverage
// numbers measured on the DEV BOX. On ubuntu-latest a single Argon2id
// derivation took 104s against 5.0s for the same derivation instrumented
// here. A bigger constant would have been the same mistake a third time.
//
// So three mechanisms have to stay wired, and this smoke fails if any of them
// is quietly removed:
//
//   1. Every vitest config takes its fork count from test/vitest/poolSize.js,
//      which sizes the pool from availableParallelism(). The literal 8 that
//      used to be in all eight configs is a good-citizen CAP on a 32-core dev
//      box and OVERSUBSCRIPTION by 2-4x on a hosted runner, with each fork
//      running memory-hard work. That is most of the 20x.
//   2. unit.config.js detects `--coverage` and exports it to the test
//      processes, because a test file cannot see the command line.
//   3. The ceilings that bound real CPU work go through slowTimeout(), so
//      they scale on an instrumented run instead of being restated.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vitestDir = resolve(repoRoot, 'test/vitest');
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8');

// ---------------------------------------------------------------------------
// 1. No config may carry its own fork count.
// ---------------------------------------------------------------------------
const configs = readdirSync(vitestDir).filter((f) => f.endsWith('.config.js'));
assert.ok(
    configs.length >= 8,
    `expected the eight per-suite vitest configs, found ${configs.length}. If a suite was `
    + 'removed update this smoke; if the directory moved, this check is no longer looking at '
    + 'anything.',
);

const hardcoded = [];
const unwired = [];
for (const f of configs) {
    const src = read(`test/vitest/${f}`);
    if (/maxForks:\s*\d/.test(src)) hardcoded.push(f);
    if (!src.includes("from './poolSize.js'")) unwired.push(f);
}

assert.deepEqual(
    hardcoded, [],
    'a vitest config sets a NUMERIC maxForks again. A literal fork count is a statement about '
    + 'one machine: 8 caps a 32-core dev box and oversubscribes a hosted runner 2-4x, which is '
    + 'what made an Argon2id derivation cost 104s in CI against 5.0s here, and what kept ci.yml '
    + `red. Import { maxForks } from './poolSize.js' instead. Offenders: ${hardcoded.join(', ')}`,
);

assert.deepEqual(
    unwired, [],
    'a vitest config does not take its fork count from test/vitest/poolSize.js, so its pool is '
    + `whatever vitest defaults to (one worker per core). Offenders: ${unwired.join(', ')}`,
);

// ---------------------------------------------------------------------------
// 2. The unit config must still tell the test processes it is instrumented.
// ---------------------------------------------------------------------------
const unitConfig = read('test/vitest/unit.config.js');

// Anchored to the DETECTION EXPRESSION, not to the string appearing anywhere.
// A bare /--coverage/ matched the explanatory comment above it, so breaking
// the actual check left this assertion green - which is the same class of
// defect as the ceilings themselves: a guard that looks like it is checking.
assert.match(
    unitConfig, /process\.argv[\s\S]{0,300}?['"]--coverage['"]/,
    'unit.config.js no longer inspects process.argv for `--coverage`. Only the config sees the '
    + 'command line; a test file sees only its environment, so without this detection every '
    + 'CPU-bound ceiling silently reverts to its dev-box value on the one run that needs it '
    + 'most.',
);

assert.match(
    unitConfig, /XCHAIN_TEST_INSTRUMENTED/,
    'unit.config.js no longer exports XCHAIN_TEST_INSTRUMENTED into `test.env`. Detection '
    + 'without propagation is worse than neither: the config looks correct and every ceiling '
    + 'downstream reads "not instrumented".',
);

assert.match(
    unitConfig, /testTimeout:\s*scale\(/,
    "the unit suite's default testTimeout is a bare number again. At a flat 20s the coverage "
    + "job failed PairPartnerWallet's QR-chunking case on work that is correct and merely "
    + 'slower under V8 precise coverage.',
);

// ---------------------------------------------------------------------------
// 3. The multiplier lives in exactly one place, and the ceilings go through it.
// ---------------------------------------------------------------------------
const envSpeed = read('test/helpers/testEnvSpeed.js');
const factorMatch = /SPEED_FACTOR_WHEN_INSTRUMENTED\s*=\s*(\d+)/.exec(envSpeed);
assert.ok(
    factorMatch,
    'test/helpers/testEnvSpeed.js no longer exports SPEED_FACTOR_WHEN_INSTRUMENTED. That '
    + 'constant is the single home of the multiplier; unit.config.js reads it rather than '
    + 'keeping a second copy, which is the drift this whole mechanism exists to avoid.',
);
assert.ok(
    Number(factorMatch[1]) >= 5,
    `the instrumentation multiplier dropped to ${factorMatch[1]}x. It is 5x on measurement, not `
    + 'taste: instrumentation alone is a measured 3x on identical hardware, and the runner\'s '
    + 'worst observed case was a 204s test against a 120s ceiling.',
);

for (const [file, what] of [
    ['test/helpers/argon2idTimeout.js', 'the argon2id ceiling'],
    ['test/unit/import-exports.test.js', "import-exports' whole-tree AST walk"],
    ['test/setup.js', "testing-library's findBy/waitFor ceiling"],
]) {
    assert.match(
        read(file), /slowTimeout\(/,
        `${what} (${file}) no longer goes through slowTimeout(), so it is back to a single `
        + 'machine\'s number. Every one of these overran in CI while passing locally.',
    );
}

console.log(
    `OK: test-ceilings smoke (: ${configs.length} vitest config(s) take their fork count `
    + 'from poolSize.js rather than a literal; unit.config.js detects --coverage and exports '
    + 'XCHAIN_TEST_INSTRUMENTED; the multiplier is defined once at '
    + `${factorMatch[1]}x; and the argon2id, import-exports and testing-library ceilings all `
    + 'derive from it. Guards the fix for seven CI failures that were five ceiling overruns '
    + 'sized on a dev box, on a suite the release gate requires to be green)',
);
