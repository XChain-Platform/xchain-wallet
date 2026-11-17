// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FILE_PIECE_NOT_INDEXED,
    filePieceMayBeOnChain,
    waitForFilePieceIndexed,
    waitForMultipartComplete,
} from '../../../packages/core/src/flows/filePieceWait.js';

const TXID = 'fb246c85'.padEnd(64, '0');
const ADDRESS = 'n-source';

function timeoutError() {
    return Object.assign(new Error(`Transaction ${TXID} was not indexed within 5000ms.`), {
        code: 'CONFIRMATION_TIMEOUT',
    });
}

function sdkFor(chainState) {
    if (chainState === 'confirmed') {
        return { encoder: { getTxBlock: vi.fn(async () => ({ block_hash: 'abc', block_height: 42 })) } };
    }
    if (chainState === 'mempool') {
        return { encoder: {
            getTxBlock: vi.fn(async () => null),
            getUTXOs: vi.fn(async () => [{ txid: TXID, confirmations: 0 }]),
        } };
    }
    if (chainState === 'dropped') {
        return { encoder: { getTxBlock: vi.fn(async () => null), getUTXOs: vi.fn(async () => []) } };
    }
    return { encoder: {
        getTxBlock: vi.fn(async () => { throw new Error('tracker unavailable'); }),
        getUTXOs: vi.fn(async () => []),
    } };
}

async function terminalPieceError(chainState) {
    const waitForTxid = vi.fn(async () => {
        vi.setSystemTime(Date.now() + 5000);
        throw timeoutError();
    });
    return waitForFilePieceIndexed({
        waitForTxid,
        sdk: sdkFor(chainState),
        txid: TXID,
        address: ADDRESS,
        pieceLabel: 'Part 1 of 2',
        patienceMs: chainState === 'dropped' ? 10001 : 5000,
    }).catch((err) => err);
}

describe('file piece index waiting', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('adapts confirmed, mempool, dropped, and unknown terminal errors', async () => {
        for (const chainState of ['confirmed', 'mempool', 'dropped', 'unknown']) {
            const err = await terminalPieceError(chainState);
            expect(err).toMatchObject({ code: FILE_PIECE_NOT_INDEXED, chainState, txid: TXID });
            expect(err.message).toMatch(/The upload is saved/);
            expect(err.message).not.toMatch(/deploy/i);
            expect(filePieceMayBeOnChain(err)).toBe(chainState !== 'dropped');
            if (chainState === 'dropped') expect(err.message).toMatch(/send this transaction again/);
        }
        expect(filePieceMayBeOnChain(new Error('other'))).toBe(false);
    });

    it('passes through non-timeout errors unchanged', async () => {
        const failure = Object.assign(new Error('rejected'), { code: 'ACTION_REJECTED' });
        const waitForTxid = vi.fn(async () => { throw failure; });
        const pending = waitForFilePieceIndexed({
            waitForTxid, sdk: {}, txid: TXID, address: ADDRESS, pieceLabel: 'Manifest', patienceMs: 5000,
        });
        await expect(pending).rejects.toBe(failure);
    });

    it('returns the indexed result and forwards chain-wait progress', async () => {
        const indexed = { action_index: '123' };
        const waitForTxid = vi.fn()
            .mockImplementationOnce(async () => {
                vi.setSystemTime(Date.now() + 5000);
                throw timeoutError();
            })
            .mockResolvedValueOnce(indexed);
        const onChainWait = vi.fn();
        const result = await waitForFilePieceIndexed({
            waitForTxid, sdk: sdkFor('confirmed'), txid: TXID, address: ADDRESS,
            pieceLabel: 'Manifest', patienceMs: 10001, onChainWait,
        });
        expect(result).toBe(indexed);
        expect(onChainWait).toHaveBeenCalledWith(expect.objectContaining({ chainState: 'confirmed', waitedMs: 5000 }));
    });
});

const pendingMultipart = {
    file_hash: 'ab'.repeat(32), total_parts: 2, parts_received: 1, total_bytes: 20, status: 'pending',
};

describe('multipart completion waiting', () => {
    // The wait reads the real clock beside its injected sleep, so a slow CI box
    // could add a real 10 ms and change how many polls these counts expect.
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('polls pending state and returns the complete explorer shape', async () => {
        const complete = { ...pendingMultipart, parts_received: 2, status: 'complete' };
        const responses = [pendingMultipart, complete];
        const sdk = { name: 'sdk' };
        let receiver;
        const readMultipart = vi.fn(function read(fileId) {
            receiver = this;
            expect(fileId).toBe('manifest-7');
            return Promise.resolve(responses.shift());
        });
        const sleep = vi.fn(async () => {});
        await expect(waitForMultipartComplete({
            sdk, fileId: 'manifest-7', readMultipart, pollMs: 10, timeoutMs: 20, sleep,
        })).resolves.toBe(complete);
        expect(receiver).toBe(sdk);
        expect(sleep).toHaveBeenCalledWith(10);
    });

    it('throws a terminal mismatch with the explorer state attached', async () => {
        const mismatch = { ...pendingMultipart, parts_received: 2, status: 'mismatch' };
        const err = await waitForMultipartComplete({
            sdk: {}, fileId: 88, readMultipart: vi.fn(async () => mismatch), sleep: vi.fn(),
        }).catch((failure) => failure);
        expect(err).toMatchObject({ code: 'FILE_MULTIPART_MISMATCH', fileId: '88', multipart: mismatch });
    });

    it('throws at the pending timeout without an actual delay', async () => {
        const readMultipart = vi.fn(async () => pendingMultipart);
        const sleep = vi.fn(async () => {});
        const err = await waitForMultipartComplete({
            sdk: {}, fileId: 'manifest-9', readMultipart, pollMs: 10, timeoutMs: 20, sleep,
        }).catch((failure) => failure);
        expect(err).toMatchObject({
            code: 'FILE_MULTIPART_PENDING_TIMEOUT', fileId: 'manifest-9', multipart: pendingMultipart,
        });
        expect(readMultipart).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 10]);
    });
});
