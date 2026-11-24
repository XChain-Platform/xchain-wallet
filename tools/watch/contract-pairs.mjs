// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const CONTRACT_MODEL_FILES = Object.freeze({
    swift: Object.freeze([
        'packages/mobile/ios/App/WatchApp/Model/WatchContract.swift',
        'packages/mobile/ios/App/WatchApp/Model/WatchMessages.swift',
    ]),
    kotlin: Object.freeze([
        'packages/mobile/android/wear/src/main/kotlin/io/xchain/wallet/android/wear/data/WatchContract.kt',
        'packages/mobile/android/wear/src/main/kotlin/io/xchain/wallet/android/wear/data/WatchMessages.kt',
    ]),
});

function objectNode(file, path, value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${file}:${path} must be an object`);
    }
    return value;
}

export function contractPairs(readSchema) {
    const snapshotFile = 'snapshot.schema.json';
    const snapshot = objectNode(snapshotFile, '$', readSchema(snapshotFile));
    const snapshotNetwork = objectNode(
        snapshotFile,
        'properties.network',
        snapshot.properties?.network,
    );
    const snapshotTotals = objectNode(
        snapshotFile,
        'properties.totals',
        snapshot.properties?.totals,
    );
    const rowFile = 'row.schema.json';
    const row = objectNode(rowFile, '$', readSchema(rowFile));
    const receiveFile = 'receive.schema.json';
    const receive = objectNode(receiveFile, '$', readSchema(receiveFile));
    const receiveItem = objectNode(receiveFile, 'items', receive.items);
    const receiveQr = objectNode(
        receiveFile,
        'items.properties.qr',
        receive.items?.properties?.qr,
    );
    const inboxFile = 'inbox.schema.json';
    const inbox = objectNode(inboxFile, '$', readSchema(inboxFile));
    const inboxItem = objectNode(inboxFile, 'items', inbox.items);
    const settingsFile = 'settings.schema.json';
    const settings = objectNode(settingsFile, '$', readSchema(settingsFile));
    const requestFile = 'request.schema.json';
    const request = objectNode(requestFile, '$', readSchema(requestFile));
    const detailFile = 'detail.schema.json';
    const detail = objectNode(detailFile, '$', readSchema(detailFile));
    const detailChart = objectNode(detailFile, 'properties.chart', detail.properties?.chart);
    const detailFact = objectNode(
        detailFile,
        'properties.facts.items',
        detail.properties?.facts?.items,
    );
    const intentsFile = 'intents.schema.json';
    const intents = objectNode(intentsFile, '$', readSchema(intentsFile));
    const refreshIntent = objectNode(intentsFile, '$defs.refresh', intents.$defs?.refresh);
    const detailRequestIntent = objectNode(
        intentsFile,
        '$defs.detailRequest',
        intents.$defs?.detailRequest,
    );
    const openOnPhoneIntent = objectNode(
        intentsFile,
        '$defs.openOnPhone',
        intents.$defs?.openOnPhone,
    );
    const markReadIntent = objectNode(intentsFile, '$defs.markRead', intents.$defs?.markRead);
    const watchStateIntent = objectNode(
        intentsFile,
        '$defs.watchState',
        intents.$defs?.watchState,
    );

    return [
        { type: 'Snapshot', schema: snapshot },
        { type: 'SnapshotNetwork', schema: snapshotNetwork },
        { type: 'SnapshotTotals', schema: snapshotTotals },
        { type: 'SnapshotRow', schema: row },
        { type: 'SnapshotReceive', schema: receiveItem },
        { type: 'SnapshotQr', schema: receiveQr },
        { type: 'SnapshotInboxItem', schema: inboxItem },
        { type: 'SnapshotSettings', schema: settings },
        { type: 'Request', schema: request },
        { type: 'Detail', schema: detail },
        { type: 'DetailChart', schema: detailChart },
        { type: 'DetailFact', schema: detailFact },
        { type: 'RefreshIntent', schema: refreshIntent },
        { type: 'DetailRequestIntent', schema: detailRequestIntent },
        { type: 'OpenOnPhoneIntent', schema: openOnPhoneIntent },
        { type: 'MarkReadIntent', schema: markReadIntent },
        { type: 'WatchStateIntent', schema: watchStateIntent },
    ];
}
