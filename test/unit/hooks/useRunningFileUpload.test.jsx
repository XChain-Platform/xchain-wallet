// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRunningFileUpload } from '../../../packages/core/src/shared/hooks/useRunningFileUpload.js';

const POLL_MS = 1000;
const DIGEST = 'ab'.repeat(32);
const MATCH = { chainId: 'btc:regtest', sourceAddress: 'bcrt1source', originalSha256: DIGEST };

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, reject, resolve };
}

function entry(overrides = {}) {
    return {
        id: 'upload-1',
        ...MATCH,
        totalParts: 4,
        partsSent: 0,
        stage: 'funding',
        createdAt: '2026-11-15T08:00:00.000Z',
        ...overrides,
    };
}

function setup(overrides = {}, walletId = 'wallet-1') {
    const upload = deferred();
    const send = vi.fn(() => upload.promise);
    const list = vi.fn().mockResolvedValue({ uploads: [] });
    const messaging = {
        fileMultipart: send,
        listPendingFileUploads: list,
        ...overrides,
    };
    const hook = renderHook(() => useRunningFileUpload({ messaging, walletId, pollMs: POLL_MS }));
    return { ...hook, list, messaging, send, upload };
}

function begin(result) {
    let promise;
    act(() => { promise = result.current.start({ rawData: 'file' }, MATCH); });
    return promise;
}

async function tick() {
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('start validation', () => {
    it('rejects a bad match before sending or listing', async () => {
        const { list, result, send } = setup();
        await expect(result.current.start({}, { ...MATCH, chainId: '' }))
            .rejects.toMatchObject({ code: 'FILE_PANEL_MATCH_INVALID' });
        expect(send).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });

    it.each([
        ['walletId', {}, ''],
        ['fileMultipart', { fileMultipart: null }, 'wallet-1'],
        ['listPendingFileUploads', { listPendingFileUploads: null }, 'wallet-1'],
    ])('rejects an invalid %s without sending', async (_field, overrides, walletId) => {
        const { list, result, send } = setup(overrides, walletId);
        await expect(result.current.start({}, MATCH))
            .rejects.toMatchObject({ code: 'FILE_UPLOAD_HOOK_INVALID' });
        expect(send).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });
});

describe('single running upload', () => {
    it('sends once and refuses a second start', async () => {
        const { messaging, result, upload } = setup();
        const first = begin(result);
        await expect(result.current.start({ rawData: 'again' }, MATCH))
            .rejects.toMatchObject({ code: 'FILE_UPLOAD_ALREADY_RUNNING' });
        expect(messaging.fileMultipart).toHaveBeenCalledTimes(1);
        expect(messaging.fileMultipart).toHaveBeenCalledWith({ rawData: 'file' });
        expect(messaging.listPendingFileUploads).not.toHaveBeenCalled();
        await act(async () => { upload.resolve({ txid: 'done' }); await first; });
    });
});

describe('panel progress', () => {
    it('tracks funding, half-sent, and assembling replies', async () => {
        const lists = [
            entry(),
            entry({ partsSent: 2, stage: 'sending' }),
            entry({ partsSent: 4, stage: 'assembling' }),
        ];
        const { messaging, result } = setup({
            listPendingFileUploads: vi.fn()
                .mockResolvedValueOnce({ uploads: [lists[0]] })
                .mockResolvedValueOnce({ uploads: [lists[1]] })
                .mockResolvedValueOnce({ uploads: [lists[2]] }),
        });
        begin(result);
        await tick();
        expect(result.current.panel).toEqual({ totalParts: 4, transactions: 11, currentPart: 1, stage: 'funding' });
        await tick();
        expect(result.current.panel).toEqual({ totalParts: 4, transactions: 11, currentPart: 3, stage: 'sending' });
        await tick();
        expect(result.current.panel).toEqual({ totalParts: 4, transactions: 11, currentPart: 4, stage: 'assembling' });
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(3);
    });

    it('maps 26 parts to 55 transactions', async () => {
        const { result } = setup({
            listPendingFileUploads: vi.fn().mockResolvedValue({
                uploads: [entry({ totalParts: 26, partsSent: 12, stage: 'sending' })],
            }),
        });
        begin(result);
        await tick();
        expect(result.current.panel).toEqual({
            totalParts: 26, transactions: 55, currentPart: 13, stage: 'sending',
        });
    });
});

describe('last panel retention', () => {
    it('keeps progress through a miss, a rejection, and a completed entry', async () => {
        const list = vi.fn()
            .mockResolvedValueOnce({ uploads: [entry({ partsSent: 1, stage: 'sending' })] })
            .mockResolvedValueOnce({ uploads: [entry({ chainId: 'ltc:regtest' })] })
            .mockRejectedValueOnce(new Error('list unavailable'))
            .mockResolvedValueOnce({ uploads: [entry({ partsSent: 4, stage: 'complete' })] });
        const { result } = setup({ listPendingFileUploads: list });
        begin(result);
        await tick();
        const panel = result.current.panel;
        expect(panel).toEqual({ totalParts: 4, transactions: 11, currentPart: 2, stage: 'sending' });
        await tick();
        expect(result.current.panel).toBe(panel);
        await tick();
        expect(result.current.panel).toBe(panel);
        await tick();
        expect(result.current.panel).toBe(panel);
    });
});

describe('poll serialization', () => {
    it('does not overlap list calls while one is pending', async () => {
        const firstList = deferred();
        const list = vi.fn()
            .mockReturnValueOnce(firstList.promise)
            .mockResolvedValue({ uploads: [] });
        const { result } = setup({ listPendingFileUploads: list });
        begin(result);
        await tick();
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
        expect(list).toHaveBeenCalledTimes(1);
        await act(async () => { firstList.resolve({ uploads: [] }); await firstList.promise; });
        await tick();
        expect(list).toHaveBeenCalledTimes(2);
    });

    it.each([1, 6])('makes one list call for a tick returning %i entries', async (count) => {
        const uploads = Array.from({ length: count }, (_, index) => (
            entry({ id: `upload-${index}`, chainId: index ? 'ltc:regtest' : MATCH.chainId })
        ));
        const { messaging, result } = setup({
            listPendingFileUploads: vi.fn().mockResolvedValue({ uploads }),
        });
        begin(result);
        await tick();
        expect(messaging.listPendingFileUploads).toHaveBeenCalledTimes(1);
        expect(messaging.listPendingFileUploads).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    });
});

describe('upload settlement', () => {
    it('returns and stores a resolved upload, then clears progress', async () => {
        const { result, upload } = setup();
        const promise = begin(result);
        expect(result.current.running).toBe(true);
        const reply = { txid: 'manifest' };
        await act(async () => { upload.resolve(reply); await expect(promise).resolves.toBe(reply); });
        expect(result.current).toMatchObject({ running: false, panel: null, result: reply, error: null });
    });

    it('rethrows and stores the original coded error', async () => {
        const { result, upload } = setup();
        const promise = begin(result);
        const failure = Object.assign(new Error('pending'), { code: 'FILE_MULTIPART_PENDING_TIMEOUT' });
        const rejected = expect(promise).rejects.toBe(failure);
        await act(async () => { upload.reject(failure); await rejected; });
        expect(result.current).toMatchObject({ running: false, panel: null, result: null, error: failure });
        expect(result.current.error.code).toBe('FILE_MULTIPART_PENDING_TIMEOUT');
    });
});

describe('poll cleanup', () => {
    it('does not list after the upload settles', async () => {
        const { messaging, result, upload } = setup();
        const promise = begin(result);
        await act(async () => { upload.resolve({ txid: 'done' }); await promise; });
        await tick();
        expect(messaging.listPendingFileUploads).not.toHaveBeenCalled();
    });

    it('does not list after unmount or store a late upload reply', async () => {
        const { messaging, result, unmount, upload } = setup();
        const promise = begin(result);
        unmount();
        await tick();
        expect(messaging.listPendingFileUploads).not.toHaveBeenCalled();
        await act(async () => { upload.resolve({ txid: 'late' }); await promise; });
    });

    it('drops a pending list reply after unmount', async () => {
        const listReply = deferred();
        const { result, unmount } = setup({
            listPendingFileUploads: vi.fn(() => listReply.promise),
        });
        begin(result);
        await tick();
        unmount();
        await act(async () => {
            listReply.resolve({ uploads: [entry()] });
            await listReply.promise;
        });
    });
});
