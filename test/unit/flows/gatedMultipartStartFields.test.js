// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { gatedMultipartStartFields } from '../../../packages/core/src/flows/gatedMultipartStartFields.js';
import { multipartStartArgs } from '../../../packages/core/src/flows/multipartStartArgs.js';

const KEY_HASH = 'ab'.repeat(32);

function input(overrides = {}) {
    return {
        gateTicker: ' GOLD ', thresholdActive: false,
        gateMinAmount: '', packChoice: 'new', ...overrides,
    };
}

function call(overrides = {}) {
    return gatedMultipartStartFields(input(overrides));
}

function expectInvalid(overrides, field, reason) {
    expect(() => call(overrides)).toThrow(expect.objectContaining({
        name: 'TypeError', code: 'GATED_MULTIPART_FIELDS_INVALID', field,
        ...(reason ? { reason } : {}),
    }));
}

describe('new gated multipart pack fields', () => {
    it('trims the ticker and omits the existing key hash', () => {
        const result = call();
        expect(result).toEqual({ gate: { ticker: 'GOLD', minAmount: '' } });
        expect(result).not.toHaveProperty('existingKeyHash');
    });
});

describe('gated multipart threshold fields', () => {
    it('trims an active threshold', () => {
        expect(call({ thresholdActive: true, gateMinAmount: ' 2.5 ' }).gate.minAmount)
            .toBe('2.5');
    });

    it('drops threshold text when the toggle is inactive', () => {
        expect(call({ gateMinAmount: '2.5' }).gate.minAmount).toBe('');
    });

    it('allows an active threshold with no text', () => {
        expect(call({ thresholdActive: true, gateMinAmount: '   ' }).gate.minAmount).toBe('');
    });
});

describe('existing gated multipart pack fields', () => {
    it('carries the selected pack hash', () => {
        expect(call({ packChoice: KEY_HASH })).toEqual({
            gate: { ticker: 'GOLD', minAmount: '' }, existingKeyHash: KEY_HASH,
        });
    });
});

describe('gated multipart field refusals', () => {
    it.each([
        [{ gateTicker: null }, 'gateTicker'],
        [{ gateTicker: '   ' }, 'gateTicker'],
        [{ thresholdActive: 'yes' }, 'thresholdActive'],
        [{ gateMinAmount: 2 }, 'gateMinAmount'],
        [{ packChoice: 7 }, 'packChoice'],
        [{ packChoice: 'AB'.repeat(32) }, 'packChoice'],
        [{ packChoice: 'ab'.repeat(31) }, 'packChoice'],
    ])('refuses %j and names %s', (overrides, field) => {
        expectInvalid(overrides, field);
    });

    it('carries the shared threshold validation reason', () => {
        const reason = 'Unlock threshold must be a positive decimal amount.';
        expectInvalid({ thresholdActive: true, gateMinAmount: 'zero' }, 'gateMinAmount', reason);
    });

    it('names gateTicker when the argument is null', () => {
        expect(() => gatedMultipartStartFields(null)).toThrow(expect.objectContaining({
            code: 'GATED_MULTIPART_FIELDS_INVALID', field: 'gateTicker',
        }));
    });

    it('refuses a symbol pack choice through the coded path', () => {
        expectInvalid({ packChoice: Symbol('pack') }, 'packChoice');
    });
});

describe('real gated multipart request path', () => {
    it('passes only public gate fields and the pack hash', () => {
        const fields = call({
            thresholdActive: true, gateMinAmount: ' 2.5 ', packChoice: KEY_HASH,
        });
        const { request } = multipartStartArgs({
            walletId: 'wallet-1', chainId: 'btc:regtest',
            from: { address: 'bcrt1source', publicKey: `02${'cd'.repeat(32)}` },
            bytes: new Uint8Array(400_000), meta: { name: 'large.bin' },
            path: { path: 'multipart', lane: 'envelope', buildMode: 'one_call' },
            linkTarget: null, ...fields,
        });
        const json = JSON.stringify(request);
        expect(request.gate).toEqual({ ticker: 'GOLD', minAmount: '2.5' });
        expect(request.existingKeyHash).toBe(KEY_HASH);
        expect(json).not.toMatch(/"(?:key|keyHex)":/);
    });
});

describe('gated multipart result identity', () => {
    it('returns fresh outer and gate objects', () => {
        const first = call();
        const second = call();
        expect(first).not.toBe(second);
        expect(first.gate).not.toBe(second.gate);
    });
});

describe('gated multipart input immutability', () => {
    it('does not mutate its input', () => {
        const args = input({ thresholdActive: true, gateMinAmount: ' 2.5 ' });
        const before = structuredClone(args);
        gatedMultipartStartFields(args);
        expect(args).toEqual(before);
    });
});
