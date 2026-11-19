// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileMultipartRequest } from '../../../packages/core/src/flows/fileMultipartRequest.js';
import { findActiveUpload } from '../../../packages/core/src/flows/multipartPanelProps.js';
import { checkResumePick } from '../../../packages/core/src/flows/multipartResumePick.js';
import { multipartStartArgs } from '../../../packages/core/src/flows/multipartStartArgs.js';
import {
    createMultipartShellStub,
    multipartRecordFixture,
} from '../../helpers/multipartShellStub.js';

const PUBLIC_KEY = `02${'ab'.repeat(32)}`;
const BYTES = Uint8Array.of(1, 2, 3);

function input(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: { address: 'bcrt1source', publicKey: PUBLIC_KEY, type: 'p2wpkh' },
        bytes: BYTES,
        meta: { name: 'photo.png', type: 'image/png', title: 'Photo', memo: 'A file' },
        path: { path: 'multipart', lane: 'envelope', buildMode: 'one_call' },
        linkTarget: null,
        gate: null,
        ...overrides,
    };
}

function call(overrides = {}) {
    return multipartStartArgs(input(overrides));
}

describe('public multipart start arguments', () => {
    it('pairs the unchanged request with its upload identity', () => {
        const args = input();
        const result = multipartStartArgs(args);
        expect(result.request).toEqual(fileMultipartRequest(args));
        expect(result.match).toEqual({
            chainId: 'btc:regtest',
            sourceAddress: 'bcrt1source',
            originalSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
        });
    });
});

describe('artwork multipart start arguments', () => {
    it('preserves the link target in the request', () => {
        const result = call({ linkTarget: { tick: 'ART', issueActionIndex: 42 } });
        expect(result.request.linkTarget).toEqual({ tick: 'ART', issueActionIndex: '42' });
        expect(Object.keys(result.match)).toEqual([
            'chainId', 'sourceAddress', 'originalSha256',
        ]);
    });
});

describe('gated multipart start arguments', () => {
    it('preserves public gate fields without changing the match', () => {
        const result = call({ gate: { ticker: 'PASS', minAmount: '10' } });
        expect(result.request.gate).toEqual({ ticker: 'PASS', minAmount: '10' });
        expect(result.match.sourceAddress).toBe('bcrt1source');
    });
});

describe('resumed multipart start arguments', () => {
    it('preserves the resume id without adding it to the match', () => {
        const result = call({ resumeId: 'upload-1' });
        expect(result.request.resumeId).toBe('upload-1');
        expect(result.match).not.toHaveProperty('resumeId');
    });
});

describe('pending upload matching', () => {
    it('finds the shell-listed record and rejects a one-byte change', async () => {
        const { match } = call();
        const record = multipartRecordFixture({
            chainId: match.chainId,
            sourceAddress: match.sourceAddress,
            originalSha256: match.originalSha256,
            stage: 'sending',
        });
        const stub = createMultipartShellStub({ records: [record] });
        const { uploads } = await stub.messaging.listPendingFileUploads({
            walletId: record.walletId,
        });
        expect(findActiveUpload(uploads, match)).toBe(uploads[0]);
        expect(findActiveUpload(uploads, call({ bytes: Uint8Array.of(1, 2, 4) }).match))
            .toBeNull();
    });
});

describe('resume pick compatibility', () => {
    it('accepts the shell-listed entry with the original bytes', async () => {
        const { match } = call();
        const record = multipartRecordFixture({ ...match, stage: 'sending' });
        const stub = createMultipartShellStub({ records: [record] });
        const { uploads } = await stub.messaging.listPendingFileUploads({
            walletId: record.walletId,
        });
        expect(checkResumePick({
            entry: uploads[0], bytes: BYTES,
            chainId: match.chainId, sourceAddress: match.sourceAddress, gated: false,
        })).toEqual({ ok: true, resumeId: record.id });
    });
});

describe('large input hashing', () => {
    it('matches the node crypto sha256 digest for 400,000 random bytes', () => {
        const bytes = new Uint8Array(randomBytes(400_000));
        const expected = createHash('sha256').update(bytes).digest('hex');
        expect(call({ bytes }).match.originalSha256).toBe(expected);
    });
});

describe('JSON-safe start arguments', () => {
    it('survive a JSON round trip unchanged', () => {
        const result = call({
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' },
            resumeId: 'upload-1', rate: 2,
        });
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });
});

describe('request refusal propagation', () => {
    it.each([
        [{ walletId: '', bytes: null }, 'FILE_MULTIPART_REQUEST_INVALID'],
        [{ gate: { ticker: 'PASS', key: '' } }, 'FILE_MULTIPART_KEY_IN_REQUEST'],
    ])('preserves the request error code %#', (overrides, code) => {
        expect(() => call(overrides)).toThrow(expect.objectContaining({ code }));
    });
});

describe('fresh start argument objects', () => {
    it('shares no object between two calls', () => {
        const first = call({
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' },
        });
        const second = call({
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' },
        });
        expect(first).not.toBe(second);
        expect(first.request).not.toBe(second.request);
        expect(first.match).not.toBe(second.match);
        expect(first.request.from).not.toBe(second.request.from);
        expect(first.request.meta).not.toBe(second.request.meta);
        expect(first.request.linkTarget).not.toBe(second.request.linkTarget);
        expect(first.request.gate).not.toBe(second.request.gate);
    });
});

describe('start argument input immutability', () => {
    it('does not mutate any input', () => {
        const args = input({
            bytes: Uint8Array.of(1, 2, 3),
            linkTarget: { tick: 'ART', issueActionIndex: 7 },
            gate: { ticker: 'PASS', minAmount: '10' },
        });
        const before = JSON.stringify(args);
        const beforeBytes = Uint8Array.from(args.bytes);
        multipartStartArgs(args);
        expect(JSON.stringify(args)).toBe(before);
        expect(args.bytes).toEqual(beforeBytes);
    });
});
