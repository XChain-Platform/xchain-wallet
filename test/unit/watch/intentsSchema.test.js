// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/intents.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const validIntents = {
    refresh: {},
    detailRequest: { tokenId: 'xcp.123' },
    openOnPhone: { route: '/requests/123' },
    markRead: { id: 'alert-123' },
    watchState: { appVersion: '1.2.3' },
};

describe('watch intents schema', () => {
    it.each(Object.entries(validIntents))('accepts %s', (kind, value) => {
        expect(validate(schema.$defs[kind], value)).toEqual([]);
    });

    it('rejects missing or empty required fields', () => {
        for (const kind of Object.keys(validIntents).filter((name) => name !== 'refresh')) {
            expect(validate(schema.$defs[kind], {})).not.toEqual([]);
            expect(validate(schema.$defs[kind], { [Object.keys(validIntents[kind])[0]]: '' })).not.toEqual([]);
        }
    });

    it('rejects extra properties and invalid payload types', () => {
        expect(validate(schema.$defs.refresh, { force: true })).toEqual(['$.force']);
        expect(validate(schema.$defs.detailRequest, { tokenId: 7 })).toEqual(['$.tokenId']);
        expect(validate(schema.$defs.openOnPhone, null)).toEqual(['$']);
    });
});
