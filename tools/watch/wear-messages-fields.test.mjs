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

import { kotlinSerialFields, schemaFields } from './contract-fields.mjs';

const contractUrl = new URL('../../packages/core/src/watch/contract/', import.meta.url);
const source = readFileSync(
    new URL(
        '../../packages/mobile/android/wear/src/main/kotlin/io/xchain/wallet/android/wear/data/WatchMessages.kt',
        import.meta.url,
    ),
    'utf8',
);
const schema = (name) => JSON.parse(readFileSync(new URL(name, contractUrl), 'utf8'));

test('Wear WatchMessages serial fields match the watch contract schemas', () => {
    const request = schema('request.schema.json');
    const detail = schema('detail.schema.json');
    const intents = schema('intents.schema.json').$defs;

    assert.deepEqual(kotlinSerialFields(source), {
        Request: schemaFields(request),
        Detail: schemaFields(detail),
        DetailChart: schemaFields(detail.properties.chart),
        DetailFact: schemaFields(detail.properties.facts.items),
        RefreshIntent: schemaFields(intents.refresh),
        DetailRequestIntent: schemaFields(intents.detailRequest),
        OpenOnPhoneIntent: schemaFields(intents.openOnPhone),
        MarkReadIntent: schemaFields(intents.markRead),
        WatchStateIntent: schemaFields(intents.watchState),
    });
});

test('Wear WatchMessages imports only serialization APIs and uses property names as keys', () => {
    assert.deepEqual(
        [...source.matchAll(/^import\s+(\S+)/gm)].map((match) => match[1]),
        ['kotlinx.serialization.SerialName', 'kotlinx.serialization.Serializable'],
    );
    assert.doesNotMatch(
        source,
        /@SerialName\s*\([^)]*\)\s*(?:(?:public|private|internal|protected)\s+)?(?:val|var)\b/,
    );
});
