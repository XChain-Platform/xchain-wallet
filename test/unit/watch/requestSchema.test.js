// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/request.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const request = {
    id: '0123456789abcdef0123456789abcdef',
    kind: 'request',
    iconHash: 'sha256:abc123',
    sentence: 'Review this request on your phone',
    amountText: '1.25 BTC',
};

describe('watch request schema', () => {
    it('accepts request and payment-due display payloads', () => {
        expect(validate(schema, request)).toEqual([]);
        expect(validate(schema, {
            ...request,
            kind: 'paydue',
            expiresAt: 1_700_000_000_000,
        })).toEqual([]);
    });

    it('requires every shared display field and rejects watch actions', () => {
        for (const key of schema.required) {
            const value = { ...request };
            delete value[key];
            expect(validate(schema, value), key).toEqual([`$.${key}`]);
        }
        expect(validate(schema, { ...request, approve: true, reject: true })).toEqual([
            '$.approve',
            '$.reject',
        ]);
    });

    it('accepts exactly 32 hexadecimal ID characters', () => {
        expect(validate(schema, { ...request, id: 'ABCDEF0123456789ABCDEF0123456789' })).toEqual([]);
        for (const id of [
            '0123456789abcdef0123456789abcde',
            '0123456789abcdef0123456789abcdef0',
            '0123456789abcdef0123456789abcdeg',
        ]) {
            expect(validate(schema, { ...request, id }), id).toEqual(['$.id']);
        }
    });

    it('limits sentence text to 200 characters', () => {
        expect(validate(schema, { ...request, sentence: '🚀'.repeat(200) })).toEqual([]);
        expect(validate(schema, { ...request, sentence: 'x'.repeat(201) })).toEqual(['$.sentence']);
    });

    it('rejects unknown kinds, invalid expiry values, wrong types and nulls', () => {
        expect(validate(schema, { ...request, kind: 'approval' })).toEqual(['$.kind']);
        expect(validate(schema, { ...request, kind: 'paydue', expiresAt: -1 })).toEqual(['$.expiresAt']);
        expect(validate(schema, { ...request, kind: 'paydue', expiresAt: 1.5 })).toEqual(['$.expiresAt']);
        expect(validate(schema, { ...request, iconHash: 1, amountText: false })).toEqual([
            '$.iconHash',
            '$.amountText',
        ]);
        expect(validate(schema, { ...request, sentence: null })).toEqual(['$.sentence']);
    });
});
