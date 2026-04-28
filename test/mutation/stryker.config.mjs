// Stryker mutation-testing config for the wallet.
//
// Mutates the wallet's small-but-load-bearing slice (crypto + util)
// and runs the unit suite against each mutant. A mutant is "killed"
// when at least one test fails; a "survived" mutant means the test
// suite doesn't catch the change — usually means we need to add a
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
    packageManager: 'npm',
    reporters: ['progress', 'clear-text', 'html'],
    testRunner: 'vitest',
    vitest: {
        configFile: 'test/vitest/unit.config.js',
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
