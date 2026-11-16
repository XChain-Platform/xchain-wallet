// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    useFormMultipartUpload,
} from '../../../packages/core/src/shared/hooks/useFormMultipartUpload.js';
import {
    createMultipartShellStub,
    multipartRecordFixture,
} from '../../helpers/multipartShellStub.js';

const BYTES = Uint8Array.of(1, 2, 3);
const SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const FROM = Object.freeze({
    address: 'bcrt1source', publicKey: `02${'ab'.repeat(32)}`, type: 'p2wpkh', source: 'hd',
});
const SUPPORT = Object.freeze({
    supported: true, lane: 'envelope', buildMode: 'one_call',
});
const UNSUPPORTED = Object.freeze({ supported: false, reason: 'hardware' });
const GATE = Object.freeze({ ticker: 'PASS', minAmount: '10' });
const META = Object.freeze({ name: 'sample.bin', type: 'application/octet-stream' });

function values(stub, overrides = {}) {
    return {
        messaging: stub.messaging,
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: FROM,
        singleTransactionCap: 2,
        support: SUPPORT,
        gate: GATE,
        rate: 4,
        pollMs: 60_000,
        ...overrides,
    };
}

function mount(stub = createMultipartShellStub(), overrides = {}) {
    return { stub, ...renderHook(() => useFormMultipartUpload(values(stub, overrides))) };
}

function calls(stub, name) {
    return stub.calls.filter((call) => call.name === name);
}

async function listed(hook, count = 0) {
    await waitFor(() => {
        expect(calls(hook.stub, 'listPendingFileUploads')).toHaveLength(1);
        expect(hook.result.current.sectionProps.panelProps.unfinished).toHaveLength(count);
    });
}

function begin(result, input = {}) {
    let promise;
    act(() => {
        promise = result.current.startFile({ bytes: BYTES, meta: META, ...input });
    });
    return promise;
}

afterEach(cleanup);

describe('drop zone maximum bytes', () => {
    it('uses the multipart cap, single cap, and null for invalid support', () => {
        const supported = mount();
        expect(supported.result.current.maxBytes).toBe(12_000_000);
        const unsupported = mount(createMultipartShellStub(), { support: UNSUPPORTED });
        expect(unsupported.result.current.maxBytes).toBe(2);
        const invalid = mount(createMultipartShellStub(), { support: null });
        expect(invalid.result.current.maxBytes).toBeNull();
    });
});

describe('single-transaction file start', () => {
    it('resolves a fresh single path without calling messaging', async () => {
        const hook = mount();
        const outcome = await begin(hook.result, { bytes: Uint8Array.of(1) });
        expect(outcome).toEqual({ path: 'single', maxBytes: 12_000_000 });
        expect(calls(hook.stub, 'fileMultipart')).toHaveLength(0);
    });
});

describe('unsupported file start', () => {
    it('resolves the support refusal without calling messaging', async () => {
        const hook = mount(createMultipartShellStub(), { support: UNSUPPORTED });
        const outcome = await begin(hook.result);
        expect(outcome).toEqual({ path: 'refused', reason: 'hardware', maxBytes: 2 });
        expect(calls(hook.stub, 'fileMultipart')).toHaveLength(0);
    });
});

describe('fresh multipart file start', () => {
    it('sends once, stays running, and returns the settled reply', async () => {
        const hook = mount();
        await listed(hook);
        const linkTarget = { tick: 'ART', issueActionIndex: 7 };
        const promise = begin(hook.result, { linkTarget });
        expect(hook.result.current.running).toBe(true);
        const uploadCalls = calls(hook.stub, 'fileMultipart');
        expect(uploadCalls).toHaveLength(1);
        expect(uploadCalls[0].args[0]).toMatchObject({
            sourceAddress: FROM.address,
            rawData: String.fromCharCode(...BYTES),
            lane: SUPPORT.lane,
            buildMode: SUPPORT.buildMode,
            linkTarget: { tick: 'ART', issueActionIndex: '7' },
            gate: GATE,
        });
        expect(uploadCalls[0].args[0]).not.toHaveProperty('resumeId');
        const reply = { txid: 'finished' };
        await act(async () => { hook.stub.finish(reply); await expect(promise).resolves.toEqual({
            path: 'multipart', reply,
        }); });
        expect(hook.result.current.running).toBe(false);
        expect(hook.result.current.result).toBe(reply);
    });
});

describe('multipart file failure', () => {
    it('rejects unchanged and exposes the panel error', async () => {
        const hook = mount();
        await listed(hook);
        const failure = Object.assign(new Error('upload failed'), { code: 'SEND_FAILED' });
        const promise = begin(hook.result);
        const rejected = expect(promise).rejects.toBe(failure);
        await act(async () => { hook.stub.fail(failure); await rejected; });
        expect(hook.result.current.sectionProps.error).toBe(failure);
    });
});

describe('file start validation failure', () => {
    it('rejects with the original flow error and does not send', async () => {
        const hook = mount();
        const promise = begin(hook.result, { bytes: new Uint8Array() });
        await expect(promise).rejects.toMatchObject({ code: 'FILE_UPLOAD_START_INVALID' });
        expect(calls(hook.stub, 'fileMultipart')).toHaveLength(0);
    });
});

describe('unfinished upload listing', () => {
    it('returns section props and lists a seeded record once on mount', async () => {
        const record = multipartRecordFixture();
        const hook = mount(createMultipartShellStub({ records: [record] }), { gate: null });
        await listed(hook, 1);
        expect(hook.result.current.sectionProps.panelProps.unfinished[0].id).toBe(record.id);
        expect(Object.keys(hook.result.current.sectionProps)).toEqual([
            'panelProps', 'fileInput', 'resumeReason', 'error', 'listError',
        ]);
    });
});

describe('continued multipart upload', () => {
    it('re-picks the matching file and resumes with the stored target', async () => {
        const linkTarget = { tick: 'ART', issueActionIndex: '7' };
        const record = multipartRecordFixture({
            originalSha256: SHA256,
            chainId: 'btc:regtest',
            sourceAddress: FROM.address,
            linkTarget,
        });
        const hook = mount(createMultipartShellStub({ records: [record] }), { gate: null });
        await listed(hook, 1);
        act(() => { hook.result.current.sectionProps.fileInput.ref.current = { click() {} }; });
        act(() => hook.result.current.sectionProps.panelProps.onContinue(record.id));
        const target = { files: [new File([BYTES], 'sample.bin')], value: 'selected' };
        act(() => hook.result.current.sectionProps.fileInput.onChange({ target }));
        await waitFor(() => expect(calls(hook.stub, 'fileMultipart')).toHaveLength(1));
        expect(target.value).toBe('');
        expect(calls(hook.stub, 'fileMultipart')[0].args[0]).toMatchObject({
            resumeId: record.id,
            linkTarget,
        });
        await act(async () => { hook.stub.finish({ txid: 'resumed' }); });
        await waitFor(() => expect(hook.result.current.running).toBe(false));
    });
});
