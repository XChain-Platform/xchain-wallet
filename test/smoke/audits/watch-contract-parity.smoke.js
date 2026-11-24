// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contractParityFailures } from '../../../tools/watch/contract-fields.mjs';
import {
    CONTRACT_MODEL_FILES,
    contractPairs,
} from '../../../tools/watch/contract-pairs.mjs';
import { fixtureReachFailures } from '../../../tools/watch/fixture-reach.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const readRepoFile = (path) => readFileSync(join(root, path), 'utf8');
const readSchema = (name) => JSON.parse(readRepoFile(
    join('packages/core/src/watch/contract', name),
));
const modelSource = (platform) => CONTRACT_MODEL_FILES[platform]
    .map(readRepoFile)
    .join('\n');

const pairs = contractPairs(readSchema);
const failures = contractParityFailures({
    pairs,
    swiftSource: modelSource('swift'),
    kotlinSource: modelSource('kotlin'),
});

assert.deepEqual(failures, [], `watch contract parity failures:\n${failures.join('\n')}`);

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

console.log('watch contract parity audit passed: fields, strings and fixtures match');
