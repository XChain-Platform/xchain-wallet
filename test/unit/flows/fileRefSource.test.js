// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    assertFileRef,
    createFileRefResolver,
} from '../../../packages/core/src/flows/fileRefSource.js';

function blobStub(bytes = new Uint8Array([1, 2, 3, 4])) {
    return {
        size: bytes.length,
        slice: vi.fn((start, end) => ({
            arrayBuffer: vi.fn(async () => bytes.slice(start, end).buffer),
        })),
    };
}

describe('file ref source', () => {
    it('resolves stored blobs through slice and returns null for missing blobs', async () => {
        const stored = blobStub();
        const blobStore = {
            get: vi.fn(async (key) => (key === 'stored-key' ? stored : null)),
        };
        const resolveFileRef = createFileRefResolver({ blobStore });

        const source = await resolveFileRef({ kind: 'blob', key: 'stored-key' });
        expect(await source.readSlice(1, 3)).toEqual(new Uint8Array([2, 3]));
        expect(stored.slice).toHaveBeenCalledWith(1, 3);
        await expect(resolveFileRef({ kind: 'blob', key: 'missing-key' }))
            .resolves.toBeNull();
    });

    it('resolves a large inline blob without materializing it', async () => {
        const blob = {
            size: 200 * 1024 * 1024,
            slice: vi.fn(),
            arrayBuffer: vi.fn(),
            text: vi.fn(),
            stream: vi.fn(),
        };
        const resolveFileRef = createFileRefResolver();

        const source = await resolveFileRef({ kind: 'inline', blob });

        expect(source.size).toBe(blob.size);
        expect(blob.slice).not.toHaveBeenCalled();
        expect(blob.arrayBuffer).not.toHaveBeenCalled();
        expect(blob.text).not.toHaveBeenCalled();
        expect(blob.stream).not.toHaveBeenCalled();
    });

    it('allows inline blob-like values whose size is merely present', () => {
        const ref = {
            kind: 'inline',
            blob: { size: 'provided by the adapter', slice() {} },
        };

        expect(assertFileRef(ref)).toBe(ref);
    });

    it('delegates injected kinds with the complete ref', async () => {
        const source = { size: 3, name: '', type: '', readSlice: vi.fn() };
        const pathResolver = vi.fn(async () => source);
        const resolveFileRef = createFileRefResolver({ kinds: { path: pathResolver } });
        const ref = { kind: 'path', path: '/tmp/example.bin', size: 3 };

        await expect(resolveFileRef(ref)).resolves.toBe(source);
        expect(pathResolver).toHaveBeenCalledWith(ref);
    });

    it.each([
        [{ kind: 'other' }, createFileRefResolver()],
        [{ kind: 'path', path: '/tmp/example.bin', size: 3 }, createFileRefResolver()],
        [{ kind: 'blob', key: 'stored-key' }, createFileRefResolver()],
    ])('rejects an unsupported reference %#', async (ref, resolveFileRef) => {
        await expect(resolveFileRef(ref)).rejects.toMatchObject({
            code: 'FILE_REF_UNSUPPORTED',
        });
    });

    it.each([
        null,
        { kind: 2 },
        { kind: 'blob', key: '' },
        { kind: 'path', path: '/tmp/example.bin', size: -1 },
    ])('rejects an invalid reference %#', (ref) => {
        expect(() => assertFileRef(ref)).toThrow(expect.objectContaining({
            code: 'FILE_REF_INVALID',
        }));
    });
});
