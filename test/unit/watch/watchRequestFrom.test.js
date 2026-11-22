// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { watchRequestFrom } from '../../../packages/core/src/watch/buildWatchRequest.js';
import requestSchema from '../../../packages/core/src/watch/contract/request.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const fixedId = '0123456789abcdef0123456789abcdef';
const from = (value) => watchRequestFrom(value, { newId: () => fixedId });

function expectValid(request) {
    expect(request).not.toBeNull();
    expect(validate(requestSchema, request)).toEqual([]);
    return request;
}

describe('watchRequestFrom', () => {
    it('builds schema-valid request and paydue snapshots with a fixed ID', () => {
        const request = expectValid(from({
            kind: 'request',
            sentence: '  Review this request on your phone  ',
            amountText: '  1.25 BTC  ',
            iconHash: 12,
        }));
        expect(request).toEqual({
            id: fixedId,
            kind: 'request',
            iconHash: '',
            sentence: 'Review this request on your phone',
            amountText: '1.25 BTC',
        });

        expectValid(from({
            kind: 'paydue',
            sentence: 'Payment is due',
            amountText: '',
            iconHash: 'sha256:abc123',
            expiresAt: 1_700_000_000_000,
        }));
    });

    it('cuts a multibyte sentence to at most 200 code points with an ellipsis', () => {
        const request = expectValid(from({
            kind: 'request',
            sentence: '🚀'.repeat(250),
            amountText: '1 XCN',
        }));

        expect([...request.sentence]).toHaveLength(200);
        expect(request.sentence.endsWith('…')).toBe(true);
    });

    it('drops expiresAt from a request snapshot', () => {
        const request = expectValid(from({
            kind: 'request',
            sentence: 'Review this request',
            amountText: '2 XCN',
            expiresAt: 1_700_000_000_000,
        }));

        expect(request).not.toHaveProperty('expiresAt');
    });

    it.each([
        ['an unknown kind', { kind: 'approval', sentence: 'Review', amountText: '1 XCN' }],
        ['a missing kind', { sentence: 'Review', amountText: '1 XCN' }],
        ['a non-string sentence', { kind: 'request', sentence: 12, amountText: '1 XCN' }],
        ['a blank sentence', { kind: 'request', sentence: '   ', amountText: '1 XCN' }],
        ['a non-string amountText', { kind: 'request', sentence: 'Review', amountText: 1 }],
        ['a missing paydue expiresAt', { kind: 'paydue', sentence: 'Pay now', amountText: '1 XCN' }],
        ['a negative paydue expiresAt', {
            kind: 'paydue', sentence: 'Pay now', amountText: '1 XCN', expiresAt: -1,
        }],
        ['a fractional paydue expiresAt', {
            kind: 'paydue', sentence: 'Pay now', amountText: '1 XCN', expiresAt: 1.5,
        }],
    ])('returns null for %s', (_label, value) => {
        expect(from(value)).toBeNull();
    });
});
