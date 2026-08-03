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
        poolOptions: {
            forks: { maxForks },
        },
        // Carries the instrumentation flag into the test processes, where
        // test/helpers/testEnvSpeed.js turns it into a multiplier for the
        // ceilings that bound real CPU work.
        env: { XCHAIN_TEST_INSTRUMENTED: INSTRUMENTED ? '1' : '0' },
        environment: 'jsdom',
        include: ['test/unit/**/*.test.{js,jsx}'],
        exclude: ['test/**/*.smoke.js', 'node_modules/**'],
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
            // A RATCHET, not the target. G166 wants >=80% on core; the suite is
            // at ~50% across this lens today, so an 80% gate would just fail
            // every push and get switched off within a week. These floors sit
            // just under the current numbers: coverage can go up, never down.
            // Raise them as the coverage tail  lands. A threshold that
            // is always red teaches people to ignore the build; one that only
            // goes red on a real regression gets believed.
            thresholds: {
                statements: 50,
                branches: 57,
                functions: 47,
                lines: 50,
            },
        },
    },
});
