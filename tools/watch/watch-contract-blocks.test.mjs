// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { schemaFields, swiftCodableFields } from './contract-fields.mjs';

const watchToolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(watchToolsDirectory, '../..');

function readJson(relativePath) {
    return JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8'));
}

test('WatchContract Codable blocks exactly match completed snapshot schemas', () => {
    const source = readFileSync(join(
        repositoryRoot,
        'packages/mobile/ios/App/WatchApp/Model/WatchContract.swift',
    ), 'utf8');
    const row = readJson('packages/core/src/watch/contract/row.schema.json');
    const receive = readJson('packages/core/src/watch/contract/receive.schema.json');
    const inbox = readJson('packages/core/src/watch/contract/inbox.schema.json');
    const settings = readJson('packages/core/src/watch/contract/settings.schema.json');
    const snapshot = readJson('packages/core/src/watch/contract/snapshot.schema.json');

    assert.deepEqual(swiftCodableFields(source), {
        SnapshotRow: schemaFields(row),
        SnapshotReceive: schemaFields(receive.items),
        SnapshotQr: schemaFields(receive.items.properties.qr),
        SnapshotInboxItem: schemaFields(inbox.items),
        SnapshotSettings: schemaFields(settings),
        Snapshot: schemaFields(snapshot),
        SnapshotNetwork: schemaFields(snapshot.properties.network),
        SnapshotTotals: schemaFields(snapshot.properties.totals),
    });
});
