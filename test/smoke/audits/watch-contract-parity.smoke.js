// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    contractParityFailures,
    kotlinSerialFields,
    swiftCodableFields,
} from '../../../tools/watch/contract-fields.mjs';
import {
    CONTRACT_MODEL_FILES,
    contractPairs,
} from '../../../tools/watch/contract-pairs.mjs';
import { expectedEntryFailures } from '../../../tools/watch/expected-entries.mjs';
import { fixtureReachFailures } from '../../../tools/watch/fixture-reach.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const readRepoFile = (path) => readFileSync(join(root, path), 'utf8');
const readSchema = (name) => JSON.parse(readRepoFile(
    join('packages/core/src/watch/contract', name),
));
const modelSources = Object.fromEntries(Object.entries(CONTRACT_MODEL_FILES).map(
    ([platform, files]) => [platform, files.map(readRepoFile).join('\n')],
));

const pairs = contractPairs(readSchema);
const failures = contractParityFailures({
    pairs,
    swiftSource: modelSources.swift,
    kotlinSource: modelSources.kotlin,
});

assert.deepEqual(failures, [], `watch contract parity failures:\n${failures.join('\n')}`);

const contractTypes = pairs.map(({ type }) => type).sort();
const nativeTypes = {
    swift: Object.keys(swiftCodableFields(modelSources.swift)).sort(),
    kotlin: Object.keys(kotlinSerialFields(modelSources.kotlin)).sort(),
};
for (const [platform, types] of Object.entries(nativeTypes)) {
    assert.deepEqual(
        types,
        contractTypes,
        `${platform} watch models must contain exactly the schema model types`,
    );
}

const strings = spawnSync(
    process.execPath,
    [join(root, 'tools/watch/gen-strings.mjs'), '--check'],
    { cwd: root, encoding: 'utf8' },
);
const stringsOutput = [strings.stdout, strings.stderr].filter(Boolean).join('\n');
assert.equal(
    strings.status,
    0,
    stringsOutput || strings.error?.message || 'watch strings check failed',
);

const fixtureDirectory = join(root, 'test/fixtures/watch');
const fixtures = readdirSync(fixtureDirectory, { recursive: true })
    .filter((path) => (
        extname(path) === '.json'
        && !path.startsWith(`inputs${sep}`)
    ))
    .map((path) => path.slice(0, -extname(path).length));
const readTestSources = (directory, extensions) => readdirSync(directory, { recursive: true })
    .filter((path) => extensions.includes(extname(path)))
    .map((path) => readFileSync(join(directory, path), 'utf8'))
    .join('\n');
const sources = {
    swift: readTestSources(
        join(root, 'packages/mobile/ios/App/WatchAppTests'),
        ['.swift'],
    ),
    wear: readTestSources(
        join(root, 'packages/mobile/android/wear/src/test'),
        ['.kt', '.java'],
    ),
};
const fixtureFailures = fixtureReachFailures({ fixtures, sources });

assert.deepEqual(
    fixtureFailures,
    [],
    `watch fixture reach failures:\n${fixtureFailures.join('\n')}`,
);

const expectedPrefixes = { balances: 'snapshot-', request: 'request-' };
const expectedDirectory = join(fixtureDirectory, 'expected');
const expectedFiles = readdirSync(expectedDirectory, { recursive: true })
    .filter((path) => extname(path) === '.json')
    .sort();
assert.deepEqual(
    expectedFiles,
    Object.keys(expectedPrefixes).map((name) => `${name}.json`).sort(),
    'every expected fixture file must have an audited fixture prefix',
);
const expected = Object.fromEntries(expectedFiles.map((path) => [
    path.slice(0, -extname(path).length),
    JSON.parse(readFileSync(join(expectedDirectory, path), 'utf8')),
]));
const expectedFailures = expectedEntryFailures({
    fixtures,
    expected,
    prefixes: expectedPrefixes,
});

assert.deepEqual(
    expectedFailures,
    [],
    `watch expected entry failures:\n${expectedFailures.join('\n')}`,
);

console.log('watch contract parity audit passed: fields, strings, fixtures and expected entries match');
