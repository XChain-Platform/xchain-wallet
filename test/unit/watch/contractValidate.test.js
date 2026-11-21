// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import validate, {
    validate as validateNamed,
    validateContract,
} from '../../../packages/core/src/watch/contract/validate.js';

const schema = {
    type: 'object',
    required: ['v', 'name', 'rows'],
    additionalProperties: false,
    properties: {
        v: { const: 1 },
        name: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[A-Z]+$' },
        mode: { enum: ['fiat', 'units'] },
        rows: { type: 'array', maxItems: 2, items: { $ref: '#/$defs/row' } },
    },
    $defs: {
        row: {
            type: 'object',
            required: ['amount'],
            additionalProperties: false,
            properties: {
                amount: { type: 'number', minimum: 0 },
                count: { type: 'integer' },
                active: { type: 'boolean' },
            },
        },
    },
};

describe('watch contract validator', () => {
    it('accepts the contract subset through every export', () => {
        const value = {
            v: 1,
            name: 'XC',
            mode: 'fiat',
            rows: [{ amount: 0, count: 1, active: true }],
        };
        expect(validate(schema, value)).toEqual([]);
        expect(validateNamed(schema, value)).toEqual([]);
        expect(validateContract(schema, value)).toEqual([]);
    });

    it('returns paths for required, properties, additional properties, enum and const', () => {
        expect(validate(schema, {
            v: 2,
            mode: 'btc',
            rows: [],
            extra: true,
        })).toEqual(['$.name', '$.v', '$.mode', '$.extra']);
    });

    it('checks string bounds and patterns without duplicating a failing path', () => {
        expect(validate(schema, { v: 1, name: 'x', rows: [] })).toEqual(['$.name']);
        expect(validate(schema, { v: 1, name: 'ABCDE', rows: [] })).toEqual(['$.name']);
        expect(validate(schema, { v: 1, name: '🚀🚀', rows: [] })).toEqual(['$.name']);
    });

    it('checks array size, item types, minimum and local refs', () => {
        expect(validate(schema, {
            v: 1,
            name: 'XC',
            rows: [
                { amount: -1, count: 1.5, active: 'yes' },
                { count: 2, extra: true },
                { amount: 3 },
            ],
        })).toEqual([
            '$.rows',
            '$.rows[0].amount',
            '$.rows[0].count',
            '$.rows[0].active',
            '$.rows[1].amount',
            '$.rows[1].extra',
        ]);
    });

    it('rejects nulls at any depth, including otherwise unconstrained values', () => {
        expect(validate({}, {
            top: null,
            nested: { value: null },
            list: [null, { value: null }],
        })).toEqual(['$.top', '$.nested.value', '$.list[0]', '$.list[1].value']);
        expect(validate({}, null)).toEqual(['$']);
    });

    it('reports wrong container types and unresolved or non-local refs', () => {
        expect(validate({ type: 'array', items: { type: 'string' } }, {})).toEqual(['$']);
        expect(validate({ $ref: '#/$defs/missing' }, 'x')).toEqual(['$']);
        expect(validate({ $ref: 'other.json' }, 'x')).toEqual(['$']);
    });

    it('decodes escaped JSON Pointer segments in local refs', () => {
        const escaped = {
            $ref: '#/$defs/a~1b~0c',
            $defs: { 'a/b~c': { type: 'string', const: 'ok' } },
        };
        expect(validate(escaped, 'ok')).toEqual([]);
        expect(validate(escaped, 'no')).toEqual(['$']);
    });
});
