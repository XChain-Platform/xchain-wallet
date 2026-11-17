// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    fileMultipartRequest,
    fileRefFor,
} from '../../../packages/core/src/flows/fileMultipartRequest.js';
import {
    handleDiscardPendingFileUpload,
    handleFileMultipart,
} from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { fileUploadStart } from '../../../packages/core/src/flows/fileUploadStart.js';
import { createFileRefResolver } from '../../../packages/core/src/flows/fileRefSource.js';

const TWO_HUNDRED_MB = 200 * 1024 * 1024;
const FROM = Object.freeze({
    address: 'bcrt1source', publicKey: `02${'ab'.repeat(32)}`, type: 'p2wpkh', source: 'hd',
});
const PATH = Object.freeze({
    path: 'multipart', lane: 'envelope', buildMode: 'one_call', maxBytes: 262_140_000_000,
});

function fileStub(size = TWO_HUNDRED_MB) {
    return {
        size,
        name: 'large.bin',
        type: 'application/octet-stream',
        arrayBuffer: vi.fn(),
        text: vi.fn(),
        stream: vi.fn(),
        slice: vi.fn((start, end) => ({
            arrayBuffer: vi.fn(async () => Uint8Array.from(
                { length: end - start }, (_unused, index) => start + index,
            ).buffer),
        })),
    };
}

function requestInput(file, fileRef) {
    return {
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: FROM,
        file,
        fileRef,
        meta: { name: file.name, type: file.type },
        path: PATH,
        linkTarget: null,
        gate: null,
    };
}

function expectWholeFileUnread(file) {
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(file.text).not.toHaveBeenCalled();
    expect(file.stream).not.toHaveBeenCalled();
}

describe('large file request transport', () => {
    it('stores the file object and sends a sub-4 KB blob reference without reading it', async () => {
        const file = fileStub();
        const blobStore = { put: vi.fn(async () => {}) };
        const fileRef = await fileRefFor(file, { blobStore, key: 'upload-1' });
        const started = fileUploadStart({
            ...requestInput(file, fileRef),
            singleTransactionCap: 389_000,
            support: { supported: true, lane: 'envelope', buildMode: 'one_call' },
        });

        expect(blobStore.put).toHaveBeenCalledWith('upload-1', file);
        expect(started.request.fileRef).toEqual({ kind: 'blob', key: 'upload-1' });
        expect(started.request).not.toHaveProperty('rawData');
        expect(JSON.stringify(started.request).length).toBeLessThan(4096);
        expectWholeFileUnread(file);
        expect(file.slice).not.toHaveBeenCalled();
    });

    it('keeps the identical Blob inline for the in-page web host', async () => {
        const file = fileStub();
        const fileRef = await fileRefFor(file);
        const request = fileMultipartRequest(requestInput(file, fileRef));

        expect(fileRef).toEqual({ kind: 'inline', blob: file });
        expect(request.fileRef.blob).toBe(file);
        expectWholeFileUnread(file);
        expect(file.slice).not.toHaveBeenCalled();
    });
});

describe('file reference route', () => {
    it('resolves a stored key and lets the publisher read only requested slices', async () => {
        const file = fileStub(8);
        const remove = vi.fn(async () => {});
        const blobStore = { get: vi.fn(async () => file), remove };
        const records = new Map();
        const vault = {
            pendingFileUploads: {
                put: vi.fn(async (record) => { records.set(record.id, { ...record }); }),
            },
        };
        const publishMultipartFile = vi.fn(async (options) => {
            expect(options).not.toHaveProperty('bytes');
            expect(await options.partSource.readSlice(2, 5)).toEqual(Uint8Array.of(2, 3, 4));
            const record = {
                id: 'generated', walletId: 'wallet-1', chainId: 'btc:regtest',
                sourceAddress: FROM.address, originalSha256: 'a'.repeat(64),
                meta: { name: file.name }, gate: null, wave: { pieces: [] },
                wavesDone: 0, totalParts: 2, stage: 'complete', linkTarget: null,
                createdAt: '2026-11-17T00:00:00.000Z',
            };
            await options.vault.pendingFileUploads.put(record);
            return { record, pendingFileUploadId: record.id };
        });

        const result = await handleFileMultipart({
            ...fileMultipartRequest(requestInput(file, { kind: 'blob', key: 'upload-1' })),
        }, {
            publishMultipartFile,
            resolveFileRef: createFileRefResolver({ blobStore }),
            fileBlobs: blobStore,
            vault,
            signer: {},
            chainRegistry: {},
            sdkRegistry: { get: () => ({ waitForAction: vi.fn() }) },
        });

        expect(file.slice).toHaveBeenCalledWith(2, 5);
        expect(records.get('upload-1')).toMatchObject({ id: 'upload-1', blobKey: 'upload-1' });
        expect(result.pendingFileUploadId).toBe('upload-1');
        expect(remove).toHaveBeenCalledWith('upload-1');
        expectWholeFileUnread(file);
    });

    it('asks for the file again when a stored blob is gone', async () => {
        const publishMultipartFile = vi.fn();
        await expect(handleFileMultipart({
            walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: FROM.address,
            fileRef: { kind: 'blob', key: 'missing' }, lane: 'envelope',
        }, {
            publishMultipartFile,
            resolveFileRef: createFileRefResolver({ blobStore: { get: async () => null } }),
        })).rejects.toMatchObject({ code: 'FILE_REF_MISSING' });
        expect(publishMultipartFile).not.toHaveBeenCalled();
    });

    it('refuses legacy raw data larger than one transaction', async () => {
        const publishMultipartFile = vi.fn();
        await expect(handleFileMultipart({
            walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: FROM.address,
            rawData: 'x'.repeat(390_000), lane: 'standard', meta: { name: 'large.bin' },
        }, { publishMultipartFile })).rejects.toMatchObject({
            code: 'FILE_RAW_DATA_TOO_LARGE',
        });
        expect(publishMultipartFile).not.toHaveBeenCalled();
    });

    it('removes a stored blob after an assembly mismatch', async () => {
        const mismatch = Object.assign(new Error('mismatch'), {
            code: 'FILE_MULTIPART_MISMATCH',
        });
        const fileBlobs = {
            get: vi.fn(async () => fileStub(8)),
            remove: vi.fn(async () => {}),
        };
        await expect(handleFileMultipart({
            walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: FROM.address,
            fileRef: { kind: 'blob', key: 'upload-1' }, lane: 'envelope',
        }, {
            publishMultipartFile: vi.fn(async () => { throw mismatch; }),
            resolveFileRef: createFileRefResolver({ blobStore: fileBlobs }),
            fileBlobs,
            vault: {},
            signer: {},
            chainRegistry: {},
            sdkRegistry: { get: () => ({ waitForAction: vi.fn() }) },
        })).rejects.toBe(mismatch);
        expect(fileBlobs.remove).toHaveBeenCalledWith('upload-1');
    });
});

describe('stored blob cleanup', () => {
    it('removes the blob when an upload is discarded', async () => {
        const record = {
            id: 'upload-1', walletId: 'wallet-1', blobKey: 'upload-1',
            wave: { pieces: [] }, wavesDone: 0, totalParts: 2,
        };
        const vault = {
            pendingFileUploads: {
                get: vi.fn(async () => record),
                delete: vi.fn(async () => {}),
            },
        };
        const fileBlobs = { remove: vi.fn(async () => {}) };

        await expect(handleDiscardPendingFileUpload({
            walletId: 'wallet-1', id: 'upload-1',
        }, { vault, fileBlobs })).resolves.toMatchObject({ removed: true });
        expect(fileBlobs.remove).toHaveBeenCalledWith('upload-1');
    });
});
