// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
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
// vitest is invoked from — Vitest resolves a relative `root` against
// cwd, which would point at the wrong directory.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    plugins: [react()],
    test: {
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
        // variance — a generous timeout keeps them from flaking the suite
        // while still catching a genuine hang.
        testTimeout: 20000,
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
        },
    },
});
