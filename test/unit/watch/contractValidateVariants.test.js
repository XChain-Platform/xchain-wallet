// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/request.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const validatesRequest = new Ajv2020().compile(schema);

const request = {
    id: '0123456789abcdef0123456789abcdef',
    kind: 'request',
    iconHash: 'sha256:abc123',
    sentence: 'Review this request on your phone',
    amountText: '1.25 BTC',
};

const variants = [
    { value: request, valid: true },
    { value: { ...request, kind: 'paydue', expiresAt: 1_700_000_000_000 }, valid: true },
    { value: { ...request, kind: 'paydue' }, valid: false },
    { value: { ...request, expiresAt: 1_700_000_000_000 }, valid: false },
];

describe('watch contract validator variants', () => {
    it('accepts each declared request variant and refuses each crossed variant', () => {
        for (const { value, valid } of variants) {
            expect(validate(schema, value)).toEqual(valid ? [] : ['$']);
        }
    });

    it('agrees with Ajv2020 on every request variant', () => {
        for (const { value, valid } of variants) {
            expect(validatesRequest(value)).toBe(valid);
            expect(validate(schema, value).length === 0).toBe(validatesRequest(value));
        }
    });

    it('requires exactly one oneOf branch to match', () => {
        const oneOf = [{ const: 'same' }, { enum: ['same'] }];
        expect(validate({ oneOf }, 'same')).toEqual(['$']);
    });

    it('reports a oneOf miss at the path where the keyword applies', () => {
        const nested = {
            type: 'object',
            properties: {
                choice: { oneOf: [{ const: 'left' }, { const: 'right' }] },
            },
        };
        expect(validate(nested, { choice: 'neither' })).toEqual(['$.choice']);
    });

    it('applies not within a nested property', () => {
        const nested = {
            type: 'object',
            properties: {
                mode: { not: { const: 'blocked' } },
            },
        };
        expect(validate(nested, { mode: 'ready' })).toEqual([]);
        expect(validate(nested, { mode: 'blocked' })).toEqual(['$.mode']);
    });
});
