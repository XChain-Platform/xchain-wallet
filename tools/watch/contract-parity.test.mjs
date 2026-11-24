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

import { contractParityFailures } from './contract-fields.mjs';

const schemas = {
    Account: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            label: { type: 'string' },
        },
    },
    Balance: {
        type: 'object',
        properties: {
            amount: { type: 'string' },
        },
    },
};

test('contractParityFailures returns no failures for two matching pairs', () => {
    const pairs = [
        { type: 'Account', schema: schemas.Account },
        { type: 'Balance', schema: schemas.Balance },
    ];
    const swiftSource = `
        struct Account: Codable {
            let id: String
            let label: String
        }
        struct Balance: Codable {
            let amount: String
        }
    `;
    const kotlinSource = `
        @Serializable
        data class Account(val id: String, val label: String)
        @Serializable
        data class Balance(val amount: String)
    `;

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource }), []);
});

test('contractParityFailures uses Swift CodingKeys raw values', () => {
    const pairs = [{
        type: 'Payment',
        schema: {
            type: 'object',
            properties: { wallet_id: { type: 'string' } },
        },
    }];
    const swiftSource = `
        struct Payment: Codable {
            let walletId: String
            enum CodingKeys: String, CodingKey {
                case walletId = "wallet_id"
            }
        }
    `;
    const kotlinSource = `
        @Serializable
        data class Payment(@SerialName("wallet_id") val walletId: String)
    `;

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource }), []);
});

test('contractParityFailures reports a missing Swift field', () => {
    const pairs = [{ type: 'Account', schema: schemas.Account }];
    const swiftSource = 'struct Account: Codable { let id: String }';
    const kotlinSource = '@Serializable data class Account(val id: String, val label: String)';

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource }), [
        'swift:Account:missing:label',
    ]);
});

test('contractParityFailures reports a Kotlin SerialName extra field', () => {
    const pairs = [{ type: 'Balance', schema: schemas.Balance }];
    const swiftSource = 'struct Balance: Codable { let amount: String }';
    const kotlinSource = `
        @Serializable
        data class Balance(
            val amount: String,
            @SerialName("legacy_amount") val legacyAmount: String,
        )
    `;

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource }), [
        'kotlin:Balance:extra:legacy_amount',
    ]);
});

test('contractParityFailures reports a type absent from Kotlin only', () => {
    const pairs = [{ type: 'Balance', schema: schemas.Balance }];
    const swiftSource = 'struct Balance: Codable { let amount: String }';

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource: '' }), [
        'kotlin:Balance:absent',
    ]);
});

test('contractParityFailures keeps pair order and Swift before Kotlin', () => {
    const pairs = [
        {
            type: 'First',
            schema: {
                type: 'object',
                properties: {
                    alpha: { type: 'string' },
                    beta: { type: 'string' },
                },
            },
        },
        {
            type: 'Second',
            schema: {
                type: 'object',
                properties: { count: { type: 'integer' } },
            },
        },
    ];
    const swiftSource = `
        struct First: Codable {
            let alpha: String
            let zeta: String
        }
    `;
    const kotlinSource = `
        @Serializable
        data class First(val beta: String)
        @Serializable
        data class Second(val legacy: Int)
    `;

    assert.deepEqual(contractParityFailures({ pairs, swiftSource, kotlinSource }), [
        'swift:First:missing:beta',
        'swift:First:extra:zeta',
        'kotlin:First:missing:alpha',
        'swift:Second:absent',
        'kotlin:Second:missing:count',
        'kotlin:Second:extra:legacy',
    ]);
});

test('contractParityFailures rejects missing or empty pairs', () => {
    assert.throws(
        () => contractParityFailures({ swiftSource: '', kotlinSource: '' }),
        TypeError,
    );
    assert.throws(
        () => contractParityFailures({ pairs: [], swiftSource: '', kotlinSource: '' }),
        TypeError,
    );
});

test('contractParityFailures rejects an empty type', () => {
    assert.throws(
        () => contractParityFailures({
            pairs: [{ type: '', schema: {} }],
            swiftSource: '',
            kotlinSource: '',
        }),
        TypeError,
    );
});

test('contractParityFailures rejects a non-object schema', () => {
    for (const schema of [null, [], 'schema']) {
        assert.throws(
            () => contractParityFailures({
                pairs: [{ type: 'Account', schema }],
                swiftSource: '',
                kotlinSource: '',
            }),
            TypeError,
        );
    }
});

test('contractParityFailures rejects non-string platform sources', () => {
    const pairs = [{ type: 'Account', schema: {} }];
    assert.throws(
        () => contractParityFailures({ pairs, swiftSource: undefined, kotlinSource: '' }),
        TypeError,
    );
    assert.throws(
        () => contractParityFailures({ pairs, swiftSource: '', kotlinSource: undefined }),
        TypeError,
    );
});
