// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileMultipartRequest } from '../../../packages/core/src/flows/fileMultipartRequest.js';

const PUBLIC_KEY = `02${'ab'.repeat(32)}`;
const KEY_HASH = 'cd'.repeat(32);

function input(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: { address: 'bcrt1source', publicKey: PUBLIC_KEY, type: 'p2wpkh' },
        bytes: Uint8Array.of(0, 127, 128, 255),
        meta: { name: 'photo.png', type: 'image/png', title: 'Photo', memo: 'A file' },
        path: { path: 'multipart', lane: 'envelope', buildMode: 'one_call', maxBytes: 12_000_000 },
        linkTarget: null,
        gate: null,
        ...overrides,
    };
}

function call(overrides = {}) {
    return fileMultipartRequest(input(overrides));
}

function expectInvalid(overrides, field, code = 'FILE_MULTIPART_REQUEST_INVALID') {
    try {
        call(overrides);
        throw new Error('Expected fileMultipartRequest to throw');
    } catch (error) {
        expect(error.code).toBe(code);
        expect(error.message).toContain(field);
    }
}

function expectBinaryString(rawData, expected) {
    expect(rawData.length).toBe(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
        expect(rawData.charCodeAt(index)).toBe(expected[index]);
    }
}

describe('public multipart request', () => {
    it('builds the exact shell request and omits optional fields', () => {
        const request = call({ meta: { name: 'plain.bin' } });
        expect(request).toEqual({
            walletId: 'wallet-1', chainId: 'btc:regtest',
            sourceAddress: 'bcrt1source',
            from: {
                address: 'bcrt1source', publicKey: PUBLIC_KEY,
                type: 'p2wpkh', sourceAddress: 'bcrt1source',
            },
            rawData: '\x00\x7f\x80\xff',
            meta: { name: 'plain.bin', type: '', title: '', memo: '' },
            lane: 'envelope', buildMode: 'one_call', linkTarget: null, gate: null,
        });
        expect(request).not.toHaveProperty('bytes');
        expect(request).not.toHaveProperty('resumeId');
        expect(request).not.toHaveProperty('rate');
        expect(request).not.toHaveProperty('existingKeyHash');
    });
});

describe('artwork multipart request', () => {
    it('copies the link target and stringifies its action index', () => {
        const request = call({
            linkTarget: { tick: 'ART', issueActionIndex: 42 },
            resumeId: 'upload-1', rate: 2.5,
        });
        expect(request.linkTarget).toEqual({ tick: 'ART', issueActionIndex: '42' });
        expect(request).toMatchObject({ resumeId: 'upload-1', rate: 2.5 });
    });
});

describe('gated multipart request', () => {
    it('copies only public gate fields and defaults an absent minimum', () => {
        const request = call({
            path: { path: 'multipart', lane: 'standard', buildMode: 'one_call' },
            gate: { ticker: 'PASS' },
        });
        expect(request.gate).toEqual({ ticker: 'PASS', minAmount: '' });
        expect(Object.keys(request.gate)).toEqual(['ticker', 'minAmount']);
        expect(request).toMatchObject({ lane: 'standard', buildMode: 'one_call' });
    });
});

describe('gated request with an existing key hash', () => {
    it('includes the public stored-pack identifier at the top level', () => {
        const request = call({
            gate: { ticker: 'PASS', minAmount: '10' },
            existingKeyHash: KEY_HASH,
        });
        expect(request.existingKeyHash).toBe(KEY_HASH);
        expect(request.gate).toEqual({ ticker: 'PASS', minAmount: '10' });
    });
});

describe('JSON-safe request shape', () => {
    it('survives a JSON round trip without changing', () => {
        const request = call({
            linkTarget: { tick: 'ART', issueActionIndex: '7' },
            gate: { ticker: 'PASS', minAmount: '10' },
            resumeId: 'upload-2', rate: 3, existingKeyHash: KEY_HASH,
        });
        expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    });
});

describe('binary string transport', () => {
    it('round-trips all 256 byte values with its own charCodeAt decoder', () => {
        const bytes = Uint8Array.from({ length: 256 }, (_unused, index) => index);
        expectBinaryString(call({ bytes }).rawData, bytes);
    });

    it('round-trips 400,000 random bytes with its own charCodeAt decoder', () => {
        const bytes = new Uint8Array(randomBytes(400_000));
        expectBinaryString(call({ bytes }).rawData, bytes);
    });
});

describe('required scalar refusals', () => {
    it.each([
        [{ walletId: '' }, 'walletId'],
        [{ walletId: '   ' }, 'walletId'],
        [{ chainId: '' }, 'chainId'],
        [{ chainId: 7 }, 'chainId'],
    ])('refuses %j and names %s', (overrides, field) => {
        expectInvalid(overrides, field);
    });
});

describe('source refusals', () => {
    it.each([
        [{ from: null }, 'from.address'],
        [{ from: { address: '', publicKey: PUBLIC_KEY } }, 'from.address'],
        [{ from: { address: 'bcrt1source', publicKey: '' } }, 'from.publicKey'],
        [{ from: { address: 'bcrt1source', publicKey: 2 } }, 'from.publicKey'],
    ])('refuses %j and names %s', (overrides, field) => {
        expectInvalid(overrides, field);
    });
});

describe('byte refusals', () => {
    it.each([undefined, null, '', [], new Uint8Array()])('refuses bytes %j', (bytes) => {
        expectInvalid({ bytes }, 'bytes');
    });
});

describe('upload path refusals', () => {
    it.each([undefined, null, { path: 'single' }, { path: 'refused', reason: 'too_large' }])(
        'refuses path %j',
        (path) => expectInvalid({ path }, 'path'),
    );
});

describe('metadata refusals', () => {
    it.each(['name', 'type', 'title', 'memo'])('refuses a non-string meta.%s', (field) => {
        expectInvalid({ meta: { [field]: 1 } }, `meta.${field}`);
    });
});

describe('link target refusals', () => {
    it.each([undefined, '', '0', '01', '-1', '1.5', 'abc'])('refuses action index %j', (value) => {
        expectInvalid({ linkTarget: { tick: 'ART', issueActionIndex: value } }, 'issueActionIndex');
    });
});

describe('gate key refusals', () => {
    it.each(['key', 'keyHex'])('refuses gate.%s even when empty', (field) => {
        expectInvalid(
            { gate: { ticker: 'PASS', [field]: '' } },
            field,
            'FILE_MULTIPART_KEY_IN_REQUEST',
        );
    });
});

describe('optional scalar refusals', () => {
    it.each([null, '', '   '])('refuses resumeId %j', (resumeId) => {
        expectInvalid({ resumeId }, 'resumeId');
    });

    it.each([null, 0, -1, NaN, Infinity, '1'])('refuses rate %j', (rate) => {
        expectInvalid({ rate }, 'rate');
    });
});

describe('existing key hash refusals', () => {
    it.each([null, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 7])(
        'refuses invalid existingKeyHash %j',
        (existingKeyHash) => expectInvalid({ gate: { ticker: 'PASS' }, existingKeyHash }, 'existingKeyHash'),
    );

    it('refuses an existing key hash without a gate', () => {
        expectInvalid({ existingKeyHash: KEY_HASH }, 'existingKeyHash');
    });
});

describe('input immutability', () => {
    it('does not mutate or reuse nested input objects', () => {
        const args = input({
            linkTarget: { tick: 'ART', issueActionIndex: 42 },
            gate: { ticker: 'PASS', minAmount: '5' },
        });
        const before = JSON.stringify(args);
        const beforeBytes = Uint8Array.from(args.bytes);
        const request = fileMultipartRequest(args);
        expect(JSON.stringify(args)).toBe(before);
        expect(args.bytes).toEqual(beforeBytes);
        expect(request.from).not.toBe(args.from);
        expect(request.meta).not.toBe(args.meta);
        expect(request.linkTarget).not.toBe(args.linkTarget);
        expect(request.gate).not.toBe(args.gate);
    });
});
