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
import test from 'node:test';

import {
    kotlinSerialFields,
    schemaFields,
    swiftCodableFields,
} from './contract-fields.mjs';

test('schemaFields returns sorted object property names', () => {
    assert.deepEqual(schemaFields({
        type: 'object',
        properties: {
            zeta: { type: 'boolean' },
            alpha: { type: 'string' },
            count: { type: 'integer' },
        },
    }), ['alpha', 'count', 'zeta']);
});

test('swiftCodableFields reads stored fields and CodingKeys from nested Codable types', () => {
    const source = `
        struct Snapshot: Codable {
            let walletId: String
            var balances: [Balance]
            static let version = 1
            var total: Int { balances.count }

            enum CodingKeys: String, CodingKey {
                case walletId = "wallet_id"
                case balances
            }

            struct Balance: Decodable {
                let amount: String
                private var assetId: String
                var label: String { assetId }

                enum CodingKeys: String, CodingKey {
                    case amount
                    case assetId = "asset_id"
                }
            }
        }

        class Ignored: Encodable {
            let secret: String
        }
    `;

    assert.deepEqual(swiftCodableFields(source), {
        Snapshot: ['balances', 'wallet_id'],
        Balance: ['amount', 'asset_id'],
    });
});

test('swiftCodableFields excludes computed and type properties without losing observers', () => {
    const source = `
        final class Detail: NSObject, Decodable {
            class var kind: String { "detail" }
            static let revision = 2
            let id: String
            var unread = false { didSet { refresh() } }
            var display: String
            {
                id
            }
        }
    `;

    assert.deepEqual(swiftCodableFields(source), {
        Detail: ['id', 'unread'],
    });
});

test('kotlinSerialFields reads multiline constructors and nested serializable classes', () => {
    const source = `
        @Serializable
        data class Snapshot(
            @SerialName("wallet_id") val walletId: String,
            val balances: List<Balance>,
            transientValue: String = "ignored",
        ) {
            @kotlinx.serialization.Serializable
            class Balance(
                val amount: String,
                @kotlinx.serialization.SerialName(value = "asset_id")
                private var assetId: String,
            ) {
                val computed: String get() = amount
            }
        }

        class Ignored(val secret: String)
    `;

    assert.deepEqual(kotlinSerialFields(source), {
        Snapshot: ['balances', 'wallet_id'],
        Balance: ['amount', 'asset_id'],
    });
});

test('kotlinSerialFields ignores comments and commas inside parameter values', () => {
    const source = `
        // @Serializable class FalsePositive(val nope: String)
        @Serializable
        class Message @ConstructorMarker("slashes//inside") private constructor(
            val labels: Map<String, String> = mapOf("a" to "b", "c" to "d"),
            /* @SerialName("wrong_name") */
            @SerialName("message_id") var id: String,
        )
    `;

    assert.deepEqual(kotlinSerialFields(source), {
        Message: ['labels', 'message_id'],
    });
});
