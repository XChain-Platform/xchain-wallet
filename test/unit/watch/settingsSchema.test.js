// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const schema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/settings.schema.json',
    'utf8',
));

describe('watch settings schema', () => {
    it('accepts the complete snapshot settings block', () => {
        expect(validate(schema, { showTotal: false, enabled: true })).toEqual([]);
        expect(validate(schema, { showTotal: true, enabled: false })).toEqual([]);
    });

    it('requires both booleans and rejects extra or null values', () => {
        expect(validate(schema, {})).toEqual(['$.showTotal', '$.enabled']);
        expect(validate(schema, { showTotal: 'yes', enabled: 1, extra: true }))
            .toEqual(['$.showTotal', '$.enabled', '$.extra']);
        expect(validate(schema, { showTotal: false, enabled: null })).toEqual(['$.enabled']);
    });
});
