// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useMultipartUploadPanel } from '../../../packages/core/src/shared/hooks/useMultipartUploadPanel.js';

const DIGEST = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const MATCH = {
    chainId: 'bitcoin-mainnet', sourceAddress: 'bc1qsource', originalSha256: DIGEST,
};
const FILE_BYTES = Uint8Array.from([1, 2, 3]);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, reject, resolve };
}

function route(overrides = {}) {
    return {
        id: 'upload-1', name: 'sample.bin', stage: 'sending', partsSent: 1,
        totalParts: 4, paidTransactions: 3, gated: false,
        createdAt: '2026-11-16T08:00:00.000Z', ...MATCH, ...overrides,
    };
}

function messagingWith(uploads = [route()]) {
    const upload = deferred();
    const messaging = {
        fileMultipart: vi.fn(() => upload.promise),
        listPendingFileUploads: vi.fn().mockResolvedValue({ uploads }),
        discardPendingFileUpload: vi.fn().mockResolvedValue({ paidTransactions: 3 }),
    };
    return { messaging, upload };
}

function mount(messaging, buildResumeRequest = vi.fn(), pollMs = 60000) {
    return renderHook(() => useMultipartUploadPanel({
        messaging,
        walletId: 'wallet-1',
        chainId: MATCH.chainId,
        sourceAddress: MATCH.sourceAddress,
        gated: false,
        buildResumeRequest,
        pollMs,
    }));
}

async function loaded(result, list, count = 1) {
    await waitFor(() => {
        expect(list).toHaveBeenCalledTimes(1);
        expect(result.current.panelProps.unfinished).toHaveLength(count);
    });
}

function begin(result, request = { rawData: 'file' }, match = MATCH) {
    let promise;
    act(() => { promise = result.current.start(request, match); });
    return promise;
}

function attachInput(result) {
    const click = vi.fn();
    act(() => { result.current.fileInput.ref.current = { click }; });
    return click;
}

function choose(result, bytes = FILE_BYTES) {
    const target = { files: [new File([bytes], 'sample.bin')], value: 'picked' };
    act(() => result.current.fileInput.onChange({ target }));
    return target;
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('panel props across a run', () => {
    it('shows list state, active progress, and settled state', async () => {
        vi.useFakeTimers();
        const entry = route();
        const { messaging, upload } = messagingWith([entry]);
        messaging.listPendingFileUploads
            .mockResolvedValueOnce({ uploads: [entry] })
            .mockResolvedValueOnce({ uploads: [entry] })
            .mockResolvedValueOnce({ uploads: [] });
        const { result } = mount(messaging, vi.fn(), 1000);
        await act(async () => { await Promise.resolve(); });
        expect(result.current.panelProps).toMatchObject({
            totalParts: null, transactions: null, currentPart: null, stage: null,
            unfinished: [{ id: entry.id, name: entry.name, partsSent: 1, totalParts: 4 }],
        });

        const promise = begin(result);
        expect(result.current.running).toBe(true);
        expect(result.current.panelProps.unfinished).toEqual([]);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(result.current.panelProps).toMatchObject({
            totalParts: 4, transactions: 11, currentPart: 2, stage: 'sending', unfinished: [],
        });

        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });
        expect(result.current.panelProps).toMatchObject({
            totalParts: null, transactions: null, currentPart: null, stage: null, unfinished: [],
        });
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(3);
    });
});

describe('start settlement refresh', () => {
    it('refreshes once after a resolved start', async () => {
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);
        const promise = begin(result);

        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });

        expect(result.current.result).toEqual({ txid: 'done' });
        expect(result.current.error).toBeNull();
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(2);
    });

    it('refreshes once and restores the hidden entry after rejection', async () => {
        const failure = new Error('send failed');
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);
        const promise = begin(result);
        expect(result.current.panelProps.unfinished).toEqual([]);
        const rejected = expect(promise).rejects.toBe(failure);

        await act(async () => { upload.reject(failure); await rejected; });

        expect(result.current.error).toBe(failure);
        expect(result.current.panelProps.unfinished).toHaveLength(1);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(2);
    });
});

describe('running upload route matching', () => {
    it('hides an active entry when route fields differ only by case', async () => {
        const entry = route({
            chainId: MATCH.chainId.toUpperCase(),
            sourceAddress: MATCH.sourceAddress.toUpperCase(),
            originalSha256: MATCH.originalSha256.toUpperCase(),
        });
        const { messaging, upload } = messagingWith([entry]);
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);

        const promise = begin(result);

        expect(result.current.panelProps.unfinished).toEqual([]);
        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });
    });
});

describe('continue control', () => {
    it('clicks once while idle and does nothing while running', async () => {
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);
        const click = attachInput(result);

        act(() => result.current.panelProps.onContinue('upload-1'));
        expect(click).toHaveBeenCalledTimes(1);
        const promise = begin(result);
        act(() => result.current.panelProps.onContinue('upload-1'));
        expect(click).toHaveBeenCalledTimes(1);

        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });
        expect(result.current.fileInput).toMatchObject({ type: 'file', hidden: true });
    });
});

describe('concurrent direct start', () => {
    it('keeps the active match hidden when a second start is refused', async () => {
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);
        const first = begin(result);

        await act(async () => {
            await expect(result.current.start({ rawData: 'again' }, MATCH))
                .rejects.toMatchObject({ code: 'FILE_UPLOAD_ALREADY_RUNNING' });
        });

        expect(result.current.running).toBe(true);
        expect(result.current.panelProps.unfinished).toEqual([]);
        expect(messaging.fileMultipart).toHaveBeenCalledTimes(1);
        await act(async () => { upload.resolve({ txid: 'done' }); await first; });
    });

    it('advances match ownership after an earlier invalid start', async () => {
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);
        let invalid;
        let valid;
        act(() => {
            invalid = result.current.start({}, { ...MATCH, chainId: '' });
            valid = result.current.start({ rawData: 'file' }, MATCH);
        });

        await act(async () => {
            await expect(invalid).rejects.toMatchObject({ code: 'FILE_PANEL_MATCH_INVALID' });
        });
        expect(result.current.running).toBe(true);
        expect(result.current.panelProps.unfinished).toEqual([]);
        expect(messaging.fileMultipart).toHaveBeenCalledTimes(1);
        await act(async () => { upload.resolve({ txid: 'done' }); await valid; });
    });
});

describe('matching resume pick', () => {
    it('builds and sends one resume request', async () => {
        const built = { request: { resume: true }, match: MATCH };
        const buildResumeRequest = vi.fn(() => built);
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging, buildResumeRequest);
        await loaded(result, messaging.listPendingFileUploads);
        attachInput(result);
        act(() => result.current.panelProps.onContinue('upload-1'));

        const target = choose(result);
        expect(target.value).toBe('');
        await waitFor(() => expect(messaging.fileMultipart).toHaveBeenCalledTimes(1));
        expect(buildResumeRequest).toHaveBeenCalledTimes(1);
        expect(buildResumeRequest).toHaveBeenCalledWith({
            entry: expect.objectContaining({ id: 'upload-1' }),
            bytes: FILE_BYTES,
            resumeId: 'upload-1',
        });
        expect(messaging.fileMultipart).toHaveBeenCalledWith(built.request);
        await act(async () => { upload.resolve({ txid: 'done' }); });
        await waitFor(() => expect(result.current.running).toBe(false));
    });
});

describe('resume pick refusal', () => {
    it('reports file mismatch without building or sending', async () => {
        const buildResumeRequest = vi.fn();
        const { messaging } = messagingWith();
        const { result } = mount(messaging, buildResumeRequest);
        await loaded(result, messaging.listPendingFileUploads);
        attachInput(result);
        act(() => result.current.panelProps.onContinue('upload-1'));

        choose(result, Uint8Array.from([9]));
        await waitFor(() => expect(result.current.resumeReason).toBe('file_mismatch'));

        expect(buildResumeRequest).not.toHaveBeenCalled();
        expect(messaging.fileMultipart).not.toHaveBeenCalled();
    });
});

describe('coordinator errors', () => {
    it('stores a build failure and clears it when the next start begins', async () => {
        const failure = new Error('cannot build');
        const { messaging, upload } = messagingWith();
        const { result } = mount(messaging, vi.fn(() => { throw failure; }));
        await loaded(result, messaging.listPendingFileUploads);
        attachInput(result);
        act(() => result.current.panelProps.onContinue('upload-1'));
        choose(result);
        await waitFor(() => expect(result.current.error).toBe(failure));
        expect(messaging.fileMultipart).not.toHaveBeenCalled();

        const promise = begin(result);
        expect(result.current.error).toBeNull();
        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });
    });

    it('stores a pre-send start rejection and still refreshes', async () => {
        const { messaging } = messagingWith();
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);

        await act(async () => {
            await expect(result.current.start({}, { ...MATCH, chainId: '' }))
                .rejects.toMatchObject({ code: 'FILE_PANEL_MATCH_INVALID' });
        });
        expect(result.current.error).toMatchObject({ code: 'FILE_PANEL_MATCH_INVALID' });
        expect(messaging.fileMultipart).not.toHaveBeenCalled();
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(2);
    });
});

describe('discard failure', () => {
    it('surfaces list error without returning a rejected promise', async () => {
        const { messaging } = messagingWith();
        messaging.discardPendingFileUpload.mockRejectedValue(new Error('discard denied'));
        const { result } = mount(messaging);
        await loaded(result, messaging.listPendingFileUploads);

        let returned;
        act(() => { returned = result.current.panelProps.onDiscard('upload-1'); });
        expect(returned).toBeUndefined();
        await waitFor(() => expect(result.current.listError).toBe('discard denied'));

        expect(result.current.panelProps.unfinished).toHaveLength(1);
        expect(messaging.discardPendingFileUpload).toHaveBeenCalledTimes(1);
    });
});

describe('mount list cardinality', () => {
    it.each([1, 6])('lists once for %i entries', async (count) => {
        const uploads = Array.from({ length: count }, (_, index) => route({ id: `upload-${index}` }));
        const { messaging } = messagingWith(uploads);
        const { result } = mount(messaging);

        await loaded(result, messaging.listPendingFileUploads, count);

        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(1);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    });
});
