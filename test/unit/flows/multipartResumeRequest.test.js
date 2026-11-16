// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { findActiveUpload } from '../../../packages/core/src/flows/multipartPanelProps.js';
import {
    multipartResumeRequestBuilder,
} from '../../../packages/core/src/flows/multipartResumeRequest.js';
import {
    createMultipartShellStub,
    multipartRecordFixture,
} from '../../helpers/multipartShellStub.js';

const PUBLIC_KEY = `02${'ab'.repeat(32)}`;
const BYTES = Uint8Array.of(1, 2, 3);
const SUPPORT = Object.freeze({
    supported: true, lane: 'envelope', buildMode: 'one_call',
});
const GATE = Object.freeze({ ticker: 'PASS', minAmount: '10' });
const EXPECTED_MATCH = Object.freeze({
    chainId: 'btc:regtest',
    sourceAddress: 'bcrt1source',
    originalSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
});

function builder(overrides = {}) {
    return multipartResumeRequestBuilder({
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: { address: 'bcrt1source', publicKey: PUBLIC_KEY, type: 'p2wpkh' },
        singleTransactionCap: 2,
        support: SUPPORT,
        rate: 4,
        ...overrides,
    });
}

function entry(overrides = {}) {
    return {
        id: 'upload-1', name: 'resume.txt', linkTarget: null, gated: false, ...overrides,
    };
}

function build(entryOverrides = {}, builderOverrides = {}) {
    return builder(builderOverrides)({
        entry: entry(entryOverrides), bytes: BYTES, resumeId: 'upload-1',
    });
}

function expectResumeInvalid(call, field, reason) {
    try {
        call();
        throw new Error('expected resume request builder to throw');
    } catch (error) {
        expect(error).toMatchObject({
            code: 'FILE_RESUME_REQUEST_INVALID', ...(reason ? { reason } : {}),
        });
        expect(error.message).toContain(field);
    }
}

describe('public, artwork, and gated resume requests', () => {
    it.each([
        ['public', {}, {}, null, null],
        ['artwork', { linkTarget: { tick: 'ART', issueActionIndex: 7 } }, {},
            { tick: 'ART', issueActionIndex: '7' }, null],
        ['gated', { gated: true }, { gate: GATE }, null,
            { ticker: 'PASS', minAmount: '10' }],
    ])('builds the %s request through multipartStartArgs', (
        _name, entryOverrides, builderOverrides, linkTarget, gate,
    ) => {
        const { request } = build(entryOverrides, builderOverrides);
        expect(request).toMatchObject({
            resumeId: 'upload-1',
            meta: { name: 'resume.txt', type: '', title: '', memo: '' },
            linkTarget,
            gate,
            lane: 'envelope',
            buildMode: 'one_call',
            rate: 4,
        });
        expect(request).not.toHaveProperty('existingKeyHash');
    });
});

describe('resume upload matching', () => {
    it('finds the sending fixture entry listed by the shell stub', async () => {
        const result = build();
        const record = multipartRecordFixture({
            id: 'upload-1',
            ...EXPECTED_MATCH,
            stage: 'sending',
        });
        const stub = createMultipartShellStub({ records: [record] });
        const { uploads } = await stub.messaging.listPendingFileUploads({
            walletId: record.walletId,
        });
        expect(result.match).toEqual(EXPECTED_MATCH);
        expect(findActiveUpload(uploads, result.match)).toBe(uploads[0]);
    });
});

describe('ungated resume gate isolation', () => {
    it('sends a null gate when the builder holds one', () => {
        const { request } = build({}, { gate: GATE });
        expect(request.gate).toBeNull();
    });
});

describe('non-multipart resume refusal', () => {
    it.each([
        ['a file at the cap', { singleTransactionCap: 3 }, 'single'],
        ['unsupported multipart support', {
            support: { supported: false, reason: 'hardware' },
        }, 'hardware'],
    ])('refuses %s with its path reason', (_name, overrides, reason) => {
        expectResumeInvalid(
            () => build({}, overrides),
            'path',
            reason,
        );
    });
});

describe('gated resume gate requirement', () => {
    it('refuses a gated entry when the builder has no gate', () => {
        expectResumeInvalid(() => build({ gated: true }), 'gate');
    });
});

describe('resume entry identity', () => {
    it.each([
        ['a null entry', null, 'upload-1', 'entry'],
        ['an empty entry id', entry({ id: '' }), '', 'entry.id'],
        ['a mismatched resume id', entry(), 'upload-2', 'entry.id'],
    ])('refuses %s', (_name, resumeEntry, resumeId, field) => {
        expectResumeInvalid(
            () => builder()({ entry: resumeEntry, bytes: BYTES, resumeId }),
            field,
        );
    });
});

describe('path validation propagation', () => {
    it('preserves FILE_UPLOAD_PATH_INVALID for empty bytes', () => {
        expect(() => builder()({
            entry: entry(), bytes: new Uint8Array(), resumeId: 'upload-1',
        })).toThrow(expect.objectContaining({ code: 'FILE_UPLOAD_PATH_INVALID' }));
    });
});

describe('multipart request validation propagation', () => {
    it('preserves FILE_MULTIPART_REQUEST_INVALID for a missing public key', () => {
        expect(() => build({}, {
            from: { address: 'bcrt1source', type: 'p2wpkh' },
        })).toThrow(expect.objectContaining({ code: 'FILE_MULTIPART_REQUEST_INVALID' }));
    });
});

describe('JSON-safe resume arguments', () => {
    it('survive a JSON round trip unchanged', () => {
        const result = build(
            { gated: true, linkTarget: { tick: 'ART', issueActionIndex: 7 } },
            { gate: GATE },
        );
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });
});

describe('resume builder input immutability', () => {
    it('does not mutate builder or callback inputs', () => {
        const from = { address: 'bcrt1source', publicKey: PUBLIC_KEY, type: 'p2wpkh' };
        const support = { supported: true, lane: 'standard', buildMode: 'two_step' };
        const gate = { ticker: 'PASS', minAmount: '10' };
        const resumeEntry = entry({
            gated: true, linkTarget: { tick: 'ART', issueActionIndex: 7 },
        });
        const inputs = { from, support, gate, entry: resumeEntry };
        const before = JSON.stringify(inputs);
        const beforeBytes = Uint8Array.from(BYTES);
        const call = builder({ from, support, gate });
        call({ entry: resumeEntry, bytes: BYTES, resumeId: resumeEntry.id });
        expect(JSON.stringify(inputs)).toBe(before);
        expect(BYTES).toEqual(beforeBytes);
    });
});
