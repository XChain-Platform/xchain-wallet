// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fileRefFor } from '../../../packages/core/src/flows/fileRefRequest.js';

const TWO_HUNDRED_MB = 200 * 1024 * 1024;

function blobStub(size = TWO_HUNDRED_MB) {
    return {
        size,
        arrayBuffer: vi.fn(),
        text: vi.fn(),
        stream: vi.fn(),
        slice: vi.fn(),
    };
}

function expectUnread(file) {
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(file.text).not.toHaveBeenCalled();
    expect(file.stream).not.toHaveBeenCalled();
    expect(file.slice).not.toHaveBeenCalled();
}

describe('fileRefFor', () => {
    it('returns the identical file inline without reading it', async () => {
        const file = blobStub();

        const ref = await fileRefFor(file);

        expect(ref).toEqual({ kind: 'inline', blob: file });
        expect(ref.blob).toBe(file);
        expectUnread(file);
    });

    it('stores the identical file once and returns a small blob reference', async () => {
        const file = blobStub();
        const blobStore = { put: vi.fn(async () => {}) };

        const ref = await fileRefFor(file, { blobStore, key: 'upload-1' });

        expect(blobStore.put).toHaveBeenCalledOnce();
        expect(blobStore.put).toHaveBeenCalledWith('upload-1', file);
        expect(blobStore.put.mock.calls[0][1]).toBe(file);
        expect(ref).toEqual({ kind: 'blob', key: 'upload-1' });
        expect(JSON.stringify(ref).length).toBeLessThan(4096);
        expectUnread(file);
    });

    it('preserves a rejected put error without reading the file', async () => {
        const file = blobStub();
        const failure = new Error('store failed');
        const blobStore = { put: vi.fn(async () => { throw failure; }) };

        await expect(fileRefFor(file, { blobStore, key: 'upload-1' })).rejects.toBe(failure);
        expect(blobStore.put).toHaveBeenCalledOnce();
        expectUnread(file);
    });

    it.each([
        ['missing key', { blobStore: { put: vi.fn() } }],
        ['empty key', { blobStore: { put: vi.fn() }, key: '' }],
        ['store without put', { blobStore: {}, key: 'upload-1' }],
    ])('refuses a %s', async (_label, options) => {
        await expect(fileRefFor(blobStub(), options)).rejects.toMatchObject({
            code: 'FILE_REF_REQUEST_INVALID',
        });
    });

    it.each([
        ['string file', 'file'],
        ['negative size', blobStub(-1)],
        ['fractional size', blobStub(1.5)],
        ['unsafe size', blobStub(Number.MAX_SAFE_INTEGER + 1)],
        ['missing slice', { size: 1 }],
    ])('refuses a %s', async (_label, file) => {
        await expect(fileRefFor(file)).rejects.toMatchObject({
            code: 'FILE_REF_REQUEST_INVALID',
        });
    });
});
