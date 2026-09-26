// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest config for the xchain-wallet workspace.
//
// All tests live at the workspace root under `test/` (matching the
// per-component test layout used across the XChain Platform).
// Each test type owns its own subdir + its own setup file:
//
//   test/unit/          fast pure-logic tests (this config)
//   test/smoke/         Node-script smokes (runs via test/_run-smokes.js,
//                        not Vitest)
//   test/integration/   multi-package wiring (separate vitest config
//                        once it lands)
//   test/e2e/           Playwright (own runner, own config in e2e/)
//   test/chaos/, fuzz/, security/, regression/, boundary/, …
//
// Vitest is scoped to ONE test type per config so that adding new
// test categories doesn't expand the unit suite's runtime.
//
// `root` resolves to the workspace root so include/setupFiles patterns
// can reference `test/...` paths unchanged. Anchored to this config
// file's location (not cwd) so the suite works regardless of where
// vitest is invoked from. Vitest resolves a relative `root` against
// cwd, which would point at the wrong directory.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { workspaceAlias } from './workspaceAlias.js';
import { maxForks } from './poolSize.js';
import { slowTimeout } from '../helpers/testEnvSpeed.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Is this run instrumented? Only the config sees the invocation - a test file
// sees nothing but its environment - so detect it here and export it there
// via `test.env` below. Matches `--coverage`, `--coverage=true` and the
// `--coverage.thresholds.x=0` forms.
const INSTRUMENTED = process.argv.some((a) => a === '--coverage'
    || a.startsWith('--coverage=') || a.startsWith('--coverage.'));

// The three files that pay a real Argon2id derivation, and the ONLY ones the
// instrumented run does not execute.
//
// WHY, because "we skip tests under coverage" deserves a hard justification.
// Argon2id is SYNCHRONOUS: it blocks the worker's event loop for the whole
// derivation, and a blocked worker cannot answer the RPC vitest requires of
// it. Instrumentation multiplies the cost several-fold, so on a hosted runner
// the block outlasts birpc's own timeout and the run dies with an unhandled
// `[vitest-worker]: Timeout calling "onTaskUpdate"` - while every one of its
// 5645 tests PASSES. That timeout is not exposed through vitest config, so the
// only lever is the blocking window, and halving the fork pool narrowed it
// from two such errors to one without closing it.
//
// What makes skipping them honest rather than convenient:
//
//   - they are NOT skipped anywhere it matters. `pnpm test:unit` runs them on
//     every push, in the `test` job, which is required and now green;
//   - the cost buys no coverage signal. The lens below is packages/*/src, and
//     the argon2id loop lives in @noble/hashes, which the lens does not
//     report on. We were paying a 100-second block to instrument a dependency
//     we do not measure;
//   - the effect on the numbers is measured, not assumed, and the thresholds
//     below still hold with room to spare.
//
// If a fourth file starts deriving, it belongs here WITH a note, not silently.
const ARGON2ID_DERIVING_TESTS = [
    'test/unit/crypto/kdf.test.js',
    'test/unit/crypto/backup.test.js',
    'test/unit/crypto/walletBlob.test.js',
];

// The config is evaluated before the `test.env` it sets can apply, so it
// passes its own detection into slowTimeout rather than letting the helper
// read an environment variable that does not exist yet. The multiplier
// itself still lives in exactly one place.
const scale = (baseMs) => slowTimeout(baseMs, { instrumented: INSTRUMENTED });

export default defineConfig({
    root: repoRoot,
    plugins: [react()],
    // `@xchain-wallet/*` resolves to this checkout's packages, not to
    // whatever node_modules/@xchain-wallet happens to link at. See
    // workspaceAlias.js: vi.mock is keyed on the resolved module id, so a
    // link pointing at another copy turns a mock into a silent no-op.
    resolve: { alias: workspaceAlias(repoRoot) },
    test: {
        // Bounded fork pool. Vitest defaults to one worker per core (32 on the
        // dev box), so a single run claimed the whole machine while many agent
        // sessions shared it. An abruptly killed run also leaves its pool
        // orphaned, and orphaned workers busy-spin at roughly a full core each
        // until something reaps them, so a smaller pool caps both the
        // steady-state cost and the blast radius. See `maxForks` above for why
        // the ceiling is now computed rather than fixed at 8.
        pool: 'forks',
        maxWorkers: maxForks,
        // Carries the instrumentation flag into the test processes, where
        // test/helpers/testEnvSpeed.js turns it into a multiplier for the
        // ceilings that bound real CPU work.
        env: { XCHAIN_TEST_INSTRUMENTED: INSTRUMENTED ? '1' : '0' },
        environment: 'jsdom',
        include: ['test/unit/**/*.test.{js,jsx}'],
        exclude: [
            'test/**/*.smoke.js',
            'node_modules/**',
            ...(INSTRUMENTED ? ARGON2ID_DERIVING_TESTS : []),
        ],
        setupFiles: ['./test/unit/setup.js'],
        globals: false,
        // Most unit tests finish in milliseconds, but three crash-class
        // guards under test/unit/ are heavier: routes-render.test.jsx mounts
        // every route across three layers, and jsx-imports/import-exports
        // run Babel-AST scans over the whole wallet source tree. They land
        // well under this ceiling locally, but the Parallels share adds
        // variance; a generous timeout keeps them from flaking the suite
        // while still catching a genuine hang.
        //
        // Scaled on an instrumented run: at a flat 20s the `coverage` job
        // failed PairPartnerWallet's QR-chunking case (a 1900-character code
        // encoded into frames) on work that is correct and merely slower with
        // V8 precise coverage on. See test/helpers/testEnvSpeed.js.
        testTimeout: scale(20000),
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            // Lens covers the whole logic surface of the wallet, not just `core`,
            // so the coverage number is honest about what the unit suite reaches.
            // The UI-heavy packages (extension/web) are primarily exercised by the
            // integration + Playwright e2e suites and will read low here until
            // Phase 1 adds unit tests (or a combined all-suite coverage run lands).
            include: [
                'packages/core/src/**/*.{js,jsx}',
                'packages/extension/src/**/*.{js,jsx}',
                'packages/web/src/**/*.{js,jsx}',
                'packages/signers-ledger/src/**/*.{js,jsx}',
                'packages/signers-trezor/src/**/*.{js,jsx}',
            ],
            exclude: [
                '**/index.js',
                'packages/core/src/branding/images/**',
                'packages/core/src/ui/tokens.css',
            ],
            // IF `functions` GOES RED AND YOUR CHANGE ADDED NO UNTESTED CODE,
            // MEASURE THE BASE COMMIT BEFORE WRITING A SINGLE TEST.
            //
            // The v8 provider reports a file that no test imports as ONE stub
            // function. The moment any test imports it, v8 enumerates it for
            // real and its whole function count lands in the denominator at
            // once, so the first test to touch a large untested module drops
            // the global figure by points that have nothing to do with the
            // change. Measured here: adding the first test to import the
            // messaging barrels moved `packages/web/src/messaging.js` from
            // `0/1` to `1/318` and `extension/src/popup/messaging.js` from
            // `0/1` to `1/320`, +755 functions of long-untested code, while
            // that change's own covered count went UP by 72. The gate refused
            // a push that had improved coverage.
            //
            // The remedy is to cover the newly-visible file, never to lower a
            // floor: these are set to measured values on purpose (e3c7ffd3).
            // Files still in the `0/N` state are the ones that will do this
            // again - `shared/routes/CreateOrderForm.jsx`, `HomeTabs.jsx` and
            // `ListCreateForm.jsx` among them.
            //
            // AST-aware remapping (v8 data mapped through the AST, via
            // `ast-v8-to-istanbul`) reports the honest counts, and as of vitest
            // 4 it is the ONLY basis: `coverage.experimentalAstAwareRemapping`
            // was removed as an option and the package became a direct
            // dependency of the provider. There is nothing left to opt out of.
            //
            // Kept because it is the history of the floors below. Under vitest
            // 3 the flag was deliberately OFF: it read 56.07% functions over
            // 10535 of them against v8's 63.6% over 5754, and two identical
            // runs disagreed on the DENOMINATOR (10535 vs 10311 functions,
            // 54441 vs 53372 statements). A ratchet cannot sit on a total that
            // moves between runs, so a stable basis that undercounts beat an
            // honest one that drifts.
            //
            // That drift did NOT survive into the shipped implementation; see
            // the re-measurement beside the thresholds. The old reasoning is
            // recorded here so nobody re-derives it from scratch and reverts
            // the re-seeding as an unexplained loosening.
            //
            // A RATCHET, not the target. G166 wants >=80% on core; the suite is
            // at ~65% across this lens today, so an 80% gate would just fail
            // every push and get switched off within a week. These floors sit
            // just under the current numbers: coverage can go up, never down.
            // Raise them as the coverage tail lands. A threshold that
            // is always red teaches people to ignore the build; one that only
            // goes red on a real regression gets believed.
            //
            // Re-measured 2026-08-15 over 6070 unit tests: 65.36 statements/lines,
            // 69.78 branches, 56.54 functions, with a second run at 65.48 / 69.79 /
            // 56.68, so v8's own run-to-run spread here is around a tenth of a
            // point. The floors below had been left at their original seeding while
            // the suite grew past them, so they sat 9 to 15 points under measured:
            // a ratchet that far below the real number cannot catch a regression,
            // it only records that one was once possible. Keep the gap at ~1-1.5
            // points, the platform convention, which is ten times that spread and
            // so leaves ample slack for runner-to-runner variation.
            // RE-SEEDED 2026-09-22 for vitest 4, and this is a CHANGE OF BASIS,
            // not a drop in coverage. Nothing stopped being tested: the same
            // 7886 tests run over the same lens. `@vitest/coverage-v8` 4.x
            // removed `experimentalAstAwareRemapping` as an option and made AST
            // remapping the only path (`ast-v8-to-istanbul` is now a direct
            // dependency of the provider, not a transitive one), so the honest counts
            // the note above describes are no longer opt-in.
            //
            // Two of the four floors go UP on the new basis (functions 55.2 to
            // 58.6, lines 64 to 64.4) and two go down (statements, branches),
            // which is what a different denominator looks like rather than a
            // regression.
            //
            // The note above rejected that basis for one measured reason: two
            // identical runs disagreed on the denominator, and a ratchet cannot
            // sit on a total that moves. RE-MEASURED against the shipped v4
            // implementation, that no longer holds. Three runs across two
            // machines: 62.02 / 52.35 / 59.79 / 65.59 twice on the dev box,
            // byte-identical, and 62.03 / 52.35 on an independent CI venue. A spread of
            // one hundredth of a point, against the tenth of a point v8's own
            // basis showed. So the objection was to the experimental flag's
            // behaviour, not to AST remapping as such, and the floors can sit on
            // it.
            //
            // Same ~1-1.5 point gap under measured as before: ten times the
            // observed spread, still tight enough to catch a real regression.
            thresholds: {
                statements: 60.8,
                branches: 51.2,
                functions: 58.6,
                lines: 64.4,
            },
        },
    },
});
