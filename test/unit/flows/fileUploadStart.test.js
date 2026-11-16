// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileUploadStart } from '../../../packages/core/src/flows/fileUploadStart.js';
import { multipartSupportFor } from '../../../packages/core/src/flows/multipartSupport.js';

const PUBLIC_KEY = `02${'ab'.repeat(32)}`;
const KEY_HASH = 'cd'.repeat(32);
const META = Object.freeze({
    name: 'photo.png', type: 'image/png', title: 'Photo', memo: 'A file',
});
const FROM = Object.freeze({
    address: 'bcrt1source', publicKey: PUBLIC_KEY, type: 'p2wpkh', source: 'hd',
});

function support(addressRecord = FROM) {
    return multipartSupportFor({
        taprootChain: true,
        addressRecord,
        addressType: 'p2wpkh',
        isWatcherMode: false,
    });
}

function input(overrides = {}) {
    return {
        walletId: 'wallet-1', chainId: 'btc:regtest', from: FROM,
        bytes: new Uint8Array(randomBytes(400_000)), meta: META,
        singleTransactionCap: 300_000, support: support(),
        ...overrides,
    };
}

describe('fresh multipart upload start', () => {
    it('builds the envelope request and upload match', () => {
        const args = input({ rate: 2 });
        const result = fileUploadStart(args);
        expect(result).toMatchObject({
            path: 'multipart', lane: 'envelope', buildMode: 'one_call',
            maxBytes: 12_000_000,
        });
        expect(result.request).toMatchObject({
            rawData: expect.any(String), meta: META, linkTarget: null, gate: null, rate: 2,
        });
        expect(result.request.rawData).toHaveLength(args.bytes.byteLength);
        expect(result.request).not.toHaveProperty('resumeId');
        expect(result.request).not.toHaveProperty('existingKeyHash');
        expect(result.match.originalSha256)
            .toBe(createHash('sha256').update(args.bytes).digest('hex'));
    });
});

describe('single-transaction upload start', () => {
    it('returns a fresh path result without building a request', () => {
        const result = fileUploadStart(input({ bytes: new Uint8Array(1_000) }));
        expect(result).toEqual({ path: 'single', maxBytes: 12_000_000 });
        expect(result).not.toHaveProperty('request');
    });
});

describe('unsupported multipart upload start', () => {
    it('returns the hardware refusal and the single-transaction cap', () => {
        const result = fileUploadStart(input({
            support: support({ source: 'trezor' }),
        }));
        expect(result).toEqual({
            path: 'refused', reason: 'hardware', maxBytes: 300_000,
        });
        expect(result).not.toHaveProperty('request');
    });
});

describe('oversized multipart upload start', () => {
    it('returns the multipart size refusal without building a request', () => {
        const result = fileUploadStart(input({ bytes: new Uint8Array(12_000_001) }));
        expect(result).toEqual({
            path: 'refused', reason: 'too_large', maxBytes: 12_000_000,
        });
        expect(result).not.toHaveProperty('request');
    });
});

describe('artwork and gated multipart upload start', () => {
    it('carries the public link, gate, and existing key hash fields', () => {
        const result = fileUploadStart(input({
            linkTarget: { tick: 'ART', issueActionIndex: 42 },
            gate: { ticker: 'PASS', minAmount: '10' },
            existingKeyHash: KEY_HASH,
        }));
        expect(result.request.linkTarget).toEqual({ tick: 'ART', issueActionIndex: '42' });
        expect(result.request.gate).toEqual({ ticker: 'PASS', minAmount: '10' });
        expect(result.request.existingKeyHash).toBe(KEY_HASH);
        expect(result.request).not.toHaveProperty('resumeId');
    });
});

describe('multipart upload start request refusals', () => {
    it.each([
        [{ gate: { ticker: 'PASS', key: '' } }, 'FILE_MULTIPART_KEY_IN_REQUEST'],
        [{ walletId: '' }, 'FILE_MULTIPART_REQUEST_INVALID'],
    ])('propagates the request refusal for %#', (overrides, code) => {
        expect(() => fileUploadStart(input(overrides)))
            .toThrow(expect.objectContaining({ code }));
    });
});

describe('multipart upload start input refusals', () => {
    it('names empty bytes with its own TypeError', () => {
        expect(() => fileUploadStart(input({ bytes: new Uint8Array() }))).toThrow(
            expect.objectContaining({
                name: 'TypeError', code: 'FILE_UPLOAD_START_INVALID', message: 'bytes is invalid',
            }),
        );
    });

    it('propagates an invalid path input unchanged', () => {
        expect(() => fileUploadStart(input({ singleTransactionCap: 0 })))
            .toThrow(expect.objectContaining({ code: 'FILE_UPLOAD_PATH_INVALID' }));
    });
});

describe('JSON-safe multipart upload start', () => {
    it('survives a JSON round trip unchanged', () => {
        const result = fileUploadStart(input({
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' },
            existingKeyHash: KEY_HASH,
        }));
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });
});

describe('multipart upload start input immutability', () => {
    it('does not mutate any input', () => {
        const args = input({
            from: { ...FROM }, meta: { ...META },
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' }, existingKeyHash: KEY_HASH,
        });
        const before = JSON.stringify(args);
        const beforeBytes = Uint8Array.from(args.bytes);
        fileUploadStart(args);
        expect(JSON.stringify(args)).toBe(before);
        expect(args.bytes).toEqual(beforeBytes);
    });
});
