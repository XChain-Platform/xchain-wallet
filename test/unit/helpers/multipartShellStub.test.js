// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    createMultipartShellStub,
    multipartRecordFixture,
} from '../../helpers/multipartShellStub.js';
import { handleListPendingFileUploads } from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { validatePendingFileUpload } from '../../../packages/core/src/schemas/pendingFileUpload.js';

function withPieceTxid(record, position, txid) {
    return record.wave.pieces.map((piece) => (
        piece.index === position ? { ...piece, txid } : piece
    ));
}

describe('multipart record fixture', () => {
    it('creates a valid ungated two-part funding record with overrides', () => {
        const record = multipartRecordFixture({ id: 'fixture-upload' });
        expect(validatePendingFileUpload(record)).toEqual({ ok: true, errors: [] });
        expect(record).toMatchObject({
            id: 'fixture-upload', schemaVersion: 2, gate: null,
            totalParts: 2, stage: 'funding', wave: { fundingTxid: null },
        });
        expect(record.wave.pieces.map(({ txid }) => txid)).toEqual([null, null, null]);
    });
});

describe('seeded multipart record listing', () => {
    it('returns the exact route projection from an equal store', async () => {
        const record = multipartRecordFixture({ id: 'seeded-upload' });
        const expected = await handleListPendingFileUploads(
            { walletId: record.walletId },
            { vault: { pendingFileUploads: { findBy: async () => [record] } } },
        );
        const stub = createMultipartShellStub({ records: [record] });
        await expect(stub.messaging.listPendingFileUploads({ walletId: record.walletId }))
            .resolves.toEqual(expected);
    });
});

describe('multipart progress advancement', () => {
    it('moves route partsSent and paidTransactions when a piece gains a txid', async () => {
        const record = multipartRecordFixture({ id: 'progress-upload' });
        const stub = createMultipartShellStub({ records: [record] });
        const request = { walletId: record.walletId };
        await expect(stub.messaging.listPendingFileUploads(request)).resolves.toMatchObject({
            uploads: [{ partsSent: 0, paidTransactions: 0 }],
        });
        await stub.advance(record.id, {
            wave: { ...record.wave, pieces: withPieceTxid(record, 0, 'piece-txid') },
        });
        await expect(stub.messaging.listPendingFileUploads(request)).resolves.toMatchObject({
            uploads: [{ partsSent: 1, paidTransactions: 2 }],
        });
    });

    it('throws for an unknown record id', () => {
        const stub = createMultipartShellStub();
        expect(() => stub.advance('missing-upload', { stage: 'sending' }))
            .toThrow('Unknown pending file upload: missing-upload');
    });

    it('counts completed waves and only the sent pieces in the current wave', async () => {
        const record = multipartRecordFixture({ id: 'wave-progress-upload' });
        record.totalParts = 250;
        record.wavesDone = 1;
        record.stage = 'sending';
        record.wave = {
            index: 1,
            fundingTxid: 'wave-two-funding',
            fundingOutputs: [],
            pieces: [{
                index: 99,
                signedTxids: [],
                txid: 'wave-two-piece',
                actionIndex: null,
            }],
        };
        const stub = createMultipartShellStub({ records: [record] });

        await expect(stub.messaging.listPendingFileUploads({ walletId: record.walletId }))
            .resolves.toMatchObject({
                uploads: [{ partsSent: 100, paidTransactions: 204 }],
            });
    });
});

describe('multipart record discard', () => {
    it('removes a record and reports the route transaction count', async () => {
        const record = multipartRecordFixture({ id: 'discard-upload' });
        const stub = createMultipartShellStub({ records: [record] });
        await stub.advance(record.id, {
            wave: {
                ...record.wave,
                fundingTxid: 'funding-txid',
                pieces: withPieceTxid(record, -1, 'manifest-txid'),
            },
        });
        await expect(stub.messaging.discardPendingFileUpload({
            walletId: record.walletId, id: record.id,
        })).resolves.toEqual({ removed: true, paidTransactions: 3 });
        await expect(stub.messaging.listPendingFileUploads({ walletId: record.walletId }))
            .resolves.toEqual({ uploads: [] });
    });

    it('preserves the route error code for an unknown id', async () => {
        const stub = createMultipartShellStub();
        await expect(stub.messaging.discardPendingFileUpload({
            walletId: 'wallet-1', id: 'missing-upload',
        })).rejects.toMatchObject({ code: 'FILE_UPLOAD_NOT_FOUND' });
    });
});

describe('multipart call completion order', () => {
    it('finishes and fails the oldest pending calls', async () => {
        const stub = createMultipartShellStub();
        const first = stub.messaging.fileMultipart({ id: 'first' });
        const second = stub.messaging.fileMultipart({ id: 'second' });
        const failure = new Error('second failed');
        stub.finish({ id: 'first-reply' });
        stub.fail(failure);
        await expect(first).resolves.toEqual({ id: 'first-reply' });
        await expect(second).rejects.toBe(failure);
    });
});

describe('multipart call completion guards', () => {
    it('throws when finish or fail has no pending call', () => {
        const stub = createMultipartShellStub();
        expect(() => stub.finish({})).toThrow('No multipart call is pending');
        expect(() => stub.fail(new Error('unused'))).toThrow('No multipart call is pending');
    });
});

describe('multipart seed isolation', () => {
    it('deep-copies records before storing them', async () => {
        const record = multipartRecordFixture({ id: 'copied-upload' });
        const stub = createMultipartShellStub({ records: [record] });
        record.meta.name = 'changed.txt';
        record.wave.pieces[0].txid = 'changed-txid';
        const result = await stub.messaging.listPendingFileUploads({ walletId: record.walletId });
        expect(result.uploads[0]).toMatchObject({
            name: 'multipart.txt', partsSent: 0, paidTransactions: 0,
        });
    });
});

describe('multipart messaging call order', () => {
    it('records every messaging call as a name and argument list', async () => {
        const record = multipartRecordFixture({ id: 'call-upload' });
        const stub = createMultipartShellStub({ records: [record] });
        const listRequest = { walletId: record.walletId };
        const uploadRequest = { walletId: record.walletId, bytes: Uint8Array.of(1) };
        await stub.messaging.listPendingFileUploads(listRequest);
        const pending = stub.messaging.fileMultipart(uploadRequest);
        stub.finish({ done: true });
        await pending;
        await stub.messaging.discardPendingFileUpload({
            walletId: record.walletId, id: record.id,
        });
        expect(stub.calls).toEqual([
            { name: 'listPendingFileUploads', args: [listRequest] },
            { name: 'fileMultipart', args: [uploadRequest] },
            { name: 'discardPendingFileUpload', args: [{
                walletId: record.walletId, id: record.id,
            }] },
        ]);
    });
});

describe('multipart messaging object shape', () => {
    it('spreads into a plain object holding all three functions', () => {
        const stub = createMultipartShellStub();
        const messaging = { ...stub.messaging };
        expect(Object.getPrototypeOf(messaging)).toBe(Object.prototype);
        expect(Object.keys(messaging)).toEqual([
            'listPendingFileUploads', 'discardPendingFileUpload', 'fileMultipart',
        ]);
        expect(Object.values(messaging).every((value) => typeof value === 'function')).toBe(true);
    });
});
