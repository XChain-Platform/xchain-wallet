// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    contractParityFailures,
    kotlinSerialFields,
    swiftCodableFields,
} from './contract-fields.mjs';
import { CONTRACT_MODEL_FILES, contractPairs } from './contract-pairs.mjs';

const readRepoFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const readSchema = (name) => JSON.parse(readRepoFile(`packages/core/src/watch/contract/${name}`));
const pairs = contractPairs(readSchema);
const expectedTypes = [
    'Snapshot',
    'SnapshotNetwork',
    'SnapshotTotals',
    'SnapshotRow',
    'SnapshotReceive',
    'SnapshotQr',
    'SnapshotInboxItem',
    'SnapshotSettings',
    'Request',
    'Detail',
    'DetailChart',
    'DetailFact',
    'RefreshIntent',
    'DetailRequestIntent',
    'OpenOnPhoneIntent',
    'MarkReadIntent',
    'WatchStateIntent',
];
const modelSource = (platform) => CONTRACT_MODEL_FILES[platform]
    .map(readRepoFile)
    .join('\n');

test('contractPairs returns the 17 unique contract types in model order', () => {
    const types = pairs.map(({ type }) => type);

    assert.deepEqual(types, expectedTypes);
    assert.equal(new Set(types).size, 17);
});

test('contract pair types exactly cover the Swift and Kotlin model types', () => {
    assert.deepEqual(Object.keys(swiftCodableFields(modelSource('swift'))), expectedTypes);
    assert.deepEqual(Object.keys(kotlinSerialFields(modelSource('kotlin'))), expectedTypes);
});

test('live schemas and native models have field parity', () => {
    assert.deepEqual(contractParityFailures({
        pairs,
        swiftSource: modelSource('swift'),
        kotlinSource: modelSource('kotlin'),
    }), []);
});

test('contractPairs identifies the first missing nested schema node', () => {
    assert.throws(
        () => contractPairs(() => ({})),
        (error) => error instanceof TypeError
            && error.message.includes('snapshot.schema.json')
            && error.message.includes('properties.network'),
    );
});
