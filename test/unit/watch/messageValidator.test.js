// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMessageValidator } from '../../../packages/core/src/watch/contract/index.js';

const detailSchema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/detail.schema.json',
));
const intentsSchema = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/intents.schema.json',
));
const kinds = {
    detail: detailSchema,
    refresh: intentsSchema.$defs.refresh,
    markRead: intentsSchema.$defs.markRead,
};

describe('watch message validator', () => {
    it.each([
        ['detail', { v: 1, tokenId: 'native:btc' }],
        ['refresh', {}],
        ['markRead', { id: 'alert-123' }],
    ])('accepts a valid %s message', (kind, value) => {
        const { explainMessage, validateMessage } = createMessageValidator(kinds);

        expect(explainMessage(kind, value)).toEqual([]);
        expect(validateMessage(kind, value)).toBe(true);
    });

    it.each([
        ['detail', { v: 2 }, ['$.tokenId', '$.v']],
        ['refresh', { force: true }, ['$.force']],
        ['markRead', { id: '' }, ['$.id']],
    ])('rejects an invalid %s message', (kind, value, paths) => {
        const { explainMessage, validateMessage } = createMessageValidator(kinds);

        expect(explainMessage(kind, value)).toEqual(paths);
        expect(validateMessage(kind, value)).toBe(false);
    });

    it.each(['unknown', 'toString', '__proto__'])(
        'rejects the non-own kind %s',
        (kind) => {
            const { explainMessage, validateMessage } = createMessageValidator(kinds);

            expect(explainMessage(kind, {})).toEqual(['$kind']);
            expect(validateMessage(kind, {})).toBe(false);
        },
    );

    it('rejects a kind inherited by the kinds map', () => {
        const inheritedKinds = Object.create({ inherited: intentsSchema.$defs.refresh });
        inheritedKinds.refresh = intentsSchema.$defs.refresh;
        const { explainMessage, validateMessage } = createMessageValidator(inheritedKinds);

        expect(explainMessage('inherited', {})).toEqual(['$kind']);
        expect(validateMessage('inherited', {})).toBe(false);
        expect(validateMessage('refresh', {})).toBe(true);
    });

    it('runs the kind post check only after its schema passes', () => {
        const postCheck = vi.fn((value) => (
            value.id === 'blocked' ? ['$.id'] : []
        ));
        const { explainMessage, validateMessage } = createMessageValidator(kinds, {
            postChecks: { markRead: postCheck },
        });

        expect(explainMessage('markRead', {})).toEqual(['$.id']);
        expect(postCheck).not.toHaveBeenCalled();
        expect(explainMessage('markRead', { id: 'blocked' })).toEqual(['$.id']);
        expect(postCheck).toHaveBeenCalledTimes(1);
        expect(validateMessage('markRead', { id: 'blocked' })).toBe(false);
        expect(postCheck).toHaveBeenCalledTimes(2);
        expect(validateMessage('markRead', { id: 'alert-123' })).toBe(true);
        expect(postCheck).toHaveBeenCalledTimes(3);
    });
});
