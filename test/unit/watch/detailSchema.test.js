// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const schema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/detail.schema.json',
));

const detail = {
    v: 1,
    tokenId: 'token-1',
    artworkHash: 'abc123',
    changeText: '+2.4%',
    priceSourceText: 'XChain DEX',
    chart: { points: [1, 1.5, 2], up: true },
    facts: [{ label: 'Type', value: 'Token' }],
    description: 'A cached token.',
};

describe('watch detail schema', () => {
    it('accepts complete details and details with optional data absent', () => {
        expect(validate(schema, detail)).toEqual([]);
        expect(validate(schema, { v: 1, tokenId: 'native:btc' })).toEqual([]);
    });

    it('requires the version, token id and closed nested shapes', () => {
        expect(validate(schema, { ...detail, v: 2, extra: true })).toEqual(['$.v', '$.extra']);
        expect(validate(schema, { v: 1 })).toEqual(['$.tokenId']);
        expect(validate(schema, { ...detail, chart: { points: [1, 2], extra: true } }))
            .toEqual(['$.chart.up', '$.chart.extra']);
        expect(validate(schema, { ...detail, facts: [{ label: 'Type' }] }))
            .toEqual(['$.facts[0].value']);
    });

    it('caps chart points, facts and description', () => {
        expect(schema.properties.chart.properties.points.minItems).toBe(2);
        expect(validate(schema, {
            ...detail,
            chart: { points: Array.from({ length: 49 }, (_, index) => index), up: true },
            facts: Array.from({ length: 11 }, () => ({ label: 'L', value: 'V' })),
            description: 'x'.repeat(281),
        })).toEqual(['$.chart.points', '$.facts', '$.description']);
    });

    it('rejects non-numeric chart points and non-string fact values', () => {
        expect(validate(schema, {
            ...detail,
            chart: { points: [1, '2'], up: false },
            facts: [{ label: 'Supply', value: 21_000_000 }],
        })).toEqual(['$.chart.points[1]', '$.facts[0].value']);
    });
});
