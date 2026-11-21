// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const schema = JSON.parse(readFileSync(
    resolve('packages/core/src/watch/contract/row.schema.json'),
    'utf8',
));

const row = {
    id: 'bitcoin-mainnet:BTC',
    chainId: 'bitcoin-mainnet',
    tick: 'BTC',
    displayName: 'Bitcoin',
    amountText: '1.25 BTC',
    fiatText: '$125,000.00',
    noPrice: false,
    pendingText: '+0.01 BTC pending',
    unavailable: false,
    iconHash: 'sha256:abc123',
    tickerColor: '#1A74A8',
    hasDetail: true,
};

describe('watch balance row schema', () => {
    it('accepts a pre-formatted balance row', () => {
        expect(validate(schema, row)).toEqual([]);
    });

    it('requires every field and rejects additions', () => {
        for (const key of schema.required) {
            const value = { ...row };
            delete value[key];
            expect(validate(schema, value), key).toEqual([`$.${key}`]);
        }
        expect(validate(schema, { ...row, rawAmount: 1.25 })).toEqual(['$.rawAmount']);
    });

    it('keeps display values as text and flags as booleans', () => {
        const textFields = [
            'id', 'chainId', 'tick', 'displayName', 'amountText', 'fiatText', 'pendingText', 'iconHash',
        ];
        const booleanFields = ['noPrice', 'unavailable', 'hasDetail'];
        for (const key of textFields) expect(validate(schema, { ...row, [key]: 1 })).toContain(`$.${key}`);
        for (const key of booleanFields) expect(validate(schema, { ...row, [key]: 'false' })).toContain(`$.${key}`);
    });

    it('caps displayName at 64 characters', () => {
        expect(validate(schema, { ...row, displayName: 'A'.repeat(64) })).toEqual([]);
        expect(validate(schema, { ...row, displayName: 'A'.repeat(65) })).toEqual(['$.displayName']);
    });

    it('accepts only uppercase six-digit hex ticker colors', () => {
        expect(validate(schema, { ...row, tickerColor: '#BE123C' })).toEqual([]);
        expect(validate(schema, { ...row, tickerColor: '#be123c' })).toEqual(['$.tickerColor']);
        expect(validate(schema, { ...row, tickerColor: '#ABC' })).toEqual(['$.tickerColor']);
    });
});
