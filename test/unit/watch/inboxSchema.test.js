// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/inbox.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const families = [
    'txConfirmations', 'incomingReceipts', 'incomingPending', 'messages',
    'governancePolls', 'deadlines', 'dispenserEscrow', 'dispenserFills',
    'orderFills', 'priceAlerts', 'request', 'paydue',
];

const item = (overrides = {}) => ({
    id: 'alert-1',
    family: 'incomingReceipts',
    kind: 'incoming-receipt',
    title: 'Payment received',
    body: 'A payment arrived.',
    at: 1_700_000_000_000,
    read: false,
    ...overrides,
});

describe('watch inbox schema', () => {
    it('accepts an empty inbox and complete alert items', () => {
        expect(validate(schema, [])).toEqual([]);
        expect(validate(schema, [item(), item({ read: true })])).toEqual([]);
    });

    it('caps the inbox at 20 items', () => {
        expect(validate(schema, Array.from({ length: 20 }, (_, id) => item({ id: String(id) })))).toEqual([]);
        expect(validate(schema, Array.from({ length: 21 }, (_, id) => item({ id: String(id) })))).toEqual(['$']);
    });

    it('accepts only families from the alert kinds contract', () => {
        expect(schema.items.properties.family.enum).toEqual(families);
        for (const family of families) expect(validate(schema, [item({ family })])).toEqual([]);
        expect(validate(schema, [item({ family: 'unknownFamily' })])).toEqual(['$[0].family']);
    });

    it('enforces title and body character limits', () => {
        expect(validate(schema, [item({ title: 't'.repeat(60), body: '🚀'.repeat(160) })])).toEqual([]);
        expect(validate(schema, [item({ title: 't'.repeat(61) })])).toEqual(['$[0].title']);
        expect(validate(schema, [item({ body: 'b'.repeat(161) })])).toEqual(['$[0].body']);
    });

    it('requires every item field and rejects extra fields', () => {
        for (const field of schema.items.required) {
            const missing = item();
            delete missing[field];
            expect(validate(schema, [missing])).toEqual([`$[0].${field}`]);
        }
        expect(validate(schema, [item({ extra: true })])).toEqual(['$[0].extra']);
    });

    it('checks field types, timestamps and nulls', () => {
        expect(validate(schema, [item({ id: 1, family: 2, kind: false, at: -1, read: 'no' })])).toEqual([
            '$[0].id', '$[0].family', '$[0].kind', '$[0].at', '$[0].read',
        ]);
        expect(validate(schema, [item({ body: null })])).toEqual(['$[0].body']);
        expect(validate(schema, {})).toEqual(['$']);
    });
});
