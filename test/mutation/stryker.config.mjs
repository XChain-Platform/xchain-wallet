// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Stryker mutation-testing config for the wallet.
//
// Mutates the wallet's small-but-load-bearing slice (crypto + util)
// and runs the unit suite against each mutant. A mutant is "killed"
// when at least one test fails; a "survived" mutant means the test
// suite doesn't catch the change. That usually means we need to add a
// targeted unit test for that mutation.
//
//   pnpm test:mutation
//
// Stryker's default kill threshold is 80 %; we don't enforce a
// threshold yet because crypto + util are still under active
// expansion. Bump `coverageAnalysis: 'perTest'` and a hard kill
// threshold once the surface stabilises.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
    // pnpm workspace: Stryker copies the project into a sandbox, so it must
    // reinstall with the same manager the lockfile belongs to.
    packageManager: 'pnpm',
    reporters: ['progress', 'clear-text', 'html'],
    // pnpm's non-flat node_modules defeats Stryker's default
    // `@stryker-mutator/*` plugin glob, so name the runner explicitly.
    plugins: ['@stryker-mutator/vitest-runner'],
    testRunner: 'vitest',
    vitest: {
        // Narrowed to the crypto + util tests that cover `mutate` below; see
        // the header of vitest.mutation.config.js for why the full unit
        // config is not reused here.
        configFile: 'test/mutation/vitest.mutation.config.js',
    },
    coverageAnalysis: 'perTest',
    mutate: [
        'packages/core/src/crypto/aead.js',
        'packages/core/src/crypto/kdf.js',
        'packages/core/src/util/uuid.js',
    ],
    timeoutMS: 60_000,
    concurrency: 2,
    htmlReporter: {
        fileName: 'reports/mutation/index.html',
    },
};
