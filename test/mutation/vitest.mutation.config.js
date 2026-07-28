// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest config used *only* by Stryker (test/mutation/stryker.config.mjs).
//
// It narrows the full unit suite (4500+ tests, mostly jsdom component
// renders) down to the tests that actually cover the mutation surface:
// packages/core/src/crypto/{aead,kdf}.js and packages/core/src/util/uuid.js.
//
// Two reasons this is a separate config rather than reusing
// test/vitest/unit.config.js:
//
//  1. Speed. Stryker re-runs the suite once per surviving mutant. Running
//     the component tree for a mutation in `aead.js` costs minutes and
//     proves nothing.
//  2. Sandbox fidelity. Stryker copies the workspace into a temp sandbox
//     before running, and a handful of the jsdom component tests reach for
//     fixtures through paths that do not survive that copy (the
//     ImportWallet backup-pointer scan is the current example). Those
//     failures are sandbox artefacts, not real reds, but Stryker aborts the
//     whole run on any red in its initial dry run.
//
// Keep the `include` list in step with `mutate` in stryker.config.mjs: a
// mutated file with no test in scope reports as "no coverage", which reads
// like a test-quality problem when it is really a config drift.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    test: {
        environment: 'node',
        include: ['test/unit/crypto/**/*.test.js', 'test/unit/util/**/*.test.js'],
        exclude: ['node_modules/**'],
        setupFiles: ['./test/unit/setup.js'],
        globals: false,
        testTimeout: 20000,
    },
});
