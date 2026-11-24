// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedEntryFailures } from './expected-entries.mjs';

const fixtures = ['snapshot-zebra', 'request-details', 'snapshot-alpha'];
const prefixes = { balances: 'snapshot-', request: 'request-' };

test('returns no failures when every expected entry matches a fixture', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures,
        expected: {
            balances: {
                'snapshot-alpha': { total: 1 },
                'snapshot-zebra': { total: 2 },
            },
            request: { 'request-details': { title: 'Details' } },
        },
        prefixes,
    }), []);
});

test('ignores non-object parameters such as now', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures: ['request-details'],
        expected: {
            request: {
                now: 1_700_000_000,
                'request-details': { title: 'Details' },
            },
        },
        prefixes: { request: 'request-' },
    }), []);
});

test('reports sorted missing entries before sorted unknown entries', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures: ['snapshot-zebra', 'snapshot-alpha'],
        expected: {
            balances: {
                'snapshot-yankee': {},
                'snapshot-xray': {},
            },
        },
        prefixes: { balances: 'snapshot-' },
    }), [
        'expected/balances:missing:snapshot-alpha',
        'expected/balances:missing:snapshot-zebra',
        'expected/balances:unknown:snapshot-xray',
        'expected/balances:unknown:snapshot-yankee',
    ]);
});

test('reports an entry from another fixture prefix as unknown', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures: ['snapshot-alpha', 'request-details'],
        expected: {
            balances: {
                'snapshot-alpha': {},
                'request-details': {},
            },
        },
        prefixes: { balances: 'snapshot-' },
    }), ['expected/balances:unknown:request-details']);
});

test('reports an absent expected file', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures: ['snapshot-alpha'],
        expected: {},
        prefixes: { balances: 'snapshot-' },
    }), ['expected/balances:absent']);
});

test('reports failures from files in prefixes order', () => {
    assert.deepEqual(expectedEntryFailures({
        fixtures: ['snapshot-alpha', 'request-details'],
        expected: { balances: {}, request: {} },
        prefixes: { request: 'request-', balances: 'snapshot-' },
    }), [
        'expected/request:missing:request-details',
        'expected/balances:missing:snapshot-alpha',
    ]);
});

test('rejects missing fixtures', () => {
    assert.throws(() => expectedEntryFailures({ expected: {}, prefixes }), TypeError);
});

test('rejects empty fixtures', () => {
    assert.throws(() => expectedEntryFailures({ fixtures: [], expected: {}, prefixes }), TypeError);
});

test('rejects non-array fixtures', () => {
    assert.throws(() => expectedEntryFailures({
        fixtures: 'snapshot-alpha',
        expected: {},
        prefixes,
    }), TypeError);
});

test('rejects missing expected entries', () => {
    assert.throws(() => expectedEntryFailures({ fixtures, prefixes }), TypeError);
});

test('rejects non-object expected entries', () => {
    assert.throws(() => expectedEntryFailures({ fixtures, expected: [], prefixes }), TypeError);
});

test('rejects missing prefixes', () => {
    assert.throws(() => expectedEntryFailures({ fixtures, expected: {} }), TypeError);
});

test('rejects empty prefixes', () => {
    assert.throws(() => expectedEntryFailures({
        fixtures,
        expected: {},
        prefixes: {},
    }), TypeError);
});

test('rejects a non-string prefix', () => {
    assert.throws(() => expectedEntryFailures({
        fixtures,
        expected: {},
        prefixes: { balances: null },
    }), TypeError);
});

test('rejects an empty prefix', () => {
    assert.throws(() => expectedEntryFailures({
        fixtures,
        expected: {},
        prefixes: { balances: '' },
    }), TypeError);
});
