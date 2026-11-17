// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useResumeFilePick } from '../../../packages/core/src/shared/hooks/useResumeFilePick.js';

const DIGEST = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const BASE = {
    chainId: 'bitcoin-mainnet', sourceAddress: 'bc1qsource', gated: false,
};

function upload(overrides = {}) {
    return {
        id: 'upload-1', originalSha256: DIGEST, stage: 'sending', ...BASE, ...overrides,
    };
}

function mountHook(options = {}) {
    const entry = options.entry === undefined ? upload() : options.entry;
    const onResume = options.onResume ?? vi.fn();
    const uploadById = options.uploadById ?? vi.fn(() => entry);
    const props = { ...BASE, uploadById, onResume, ...options.props };
    return { ...renderHook(() => useResumeFilePick(props)), entry, onResume, uploadById };
}

function request(result, id = 'upload-1', click = vi.fn()) {
    act(() => {
        result.current.inputRef.current = { click };
        result.current.requestPick(id);
    });
    return click;
}

function change(result, file) {
    const target = { files: file ? [file] : [], value: 'selected' };
    act(() => result.current.onInputChange({ target }));
    return target;
}

function deferredReaders() {
    const readers = [];
    class DeferredReader {
        constructor() { readers.push(this); }
        readAsArrayBuffer(file) { this.file = file; }
        finish(bytes = [1, 2, 3]) {
            this.result = Uint8Array.from(bytes).buffer;
            this.onload?.();
        }
    }
    vi.stubGlobal('FileReader', DeferredReader);
    return readers;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useResumeFilePick requests', () => {
    it('records each request and clicks once when an input is attached', () => {
        const { result } = mountHook();
        act(() => result.current.requestPick('without-input'));
        expect(result.current.pendingId).toBe('without-input');

        const click = request(result, 'upload-1');
        act(() => result.current.requestPick('upload-2'));
        expect(click).toHaveBeenCalledTimes(2);
        expect(result.current.pendingId).toBe('upload-2');
        expect(result.current.reason).toBeNull();
    });
});

describe('useResumeFilePick matching selection', () => {
    it('resumes once with the selected file and resets the input', async () => {
        const { result, entry, onResume } = mountHook();
        request(result);
        const file = new File([Uint8Array.from([1, 2, 3])], 'same.bin');
        const target = change(result, file);
        expect(target.value).toBe('');

        await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
        expect(onResume).toHaveBeenCalledWith({
            entry,
            bytes: {
                byteLength: 390_001,
                file,
                fileRef: { kind: 'inline', blob: file },
                originalSha256: DIGEST,
            },
            resumeId: 'upload-1',
        });
        expect(result.current.pendingId).toBeNull();
        expect(result.current.reason).toBeNull();
    });
});

describe('useResumeFilePick validator reasons', () => {
    it.each([
        [{ chainId: 'other' }, {}, 'chain_mismatch'],
        [{ sourceAddress: 'other' }, {}, 'source_mismatch'],
        [{ gated: true }, {}, 'gate_mismatch'],
        [{}, {}, 'file_mismatch'],
        [{ stage: 'complete' }, {}, 'not_resumable'],
    ])('reports %s mismatch as %s', async (entryChanges, props, reason) => {
        const entry = upload(entryChanges);
        const { result, onResume } = mountHook({ entry, props });
        request(result);
        change(result, new File([Uint8Array.from([9])], 'picked.bin'));

        await waitFor(() => expect(result.current.reason).toBe(reason));
        expect(onResume).not.toHaveBeenCalled();
        expect(result.current.pendingId).toBe('upload-1');
    });
});

describe('useResumeFilePick rejected selections', () => {
    it('reports a missing upload and an empty file', async () => {
        const missing = mountHook({ entry: null });
        request(missing.result);
        change(missing.result, new File(['x'], 'missing.bin'));
        await waitFor(() => expect(missing.result.current.reason).toBe('not_resumable'));

        const empty = mountHook();
        request(empty.result);
        change(empty.result, new File([], 'empty.bin'));
        await waitFor(() => expect(empty.result.current.reason).toBe('file_mismatch'));
    });

    it('reports a read failure', async () => {
        class FailingReader { readAsArrayBuffer() { this.onerror?.(); } }
        vi.stubGlobal('FileReader', FailingReader);
        const { result } = mountHook();
        request(result);
        change(result, new File(['x'], 'unreadable.bin'));
        await waitFor(() => expect(result.current.reason).toBe('read_failed'));
    });

    it('turns invalid validator input into not_resumable', async () => {
        const { result, onResume } = mountHook({ props: { chainId: '' } });
        request(result);
        change(result, new File([Uint8Array.from([1, 2, 3])], 'same.bin'));
        await waitFor(() => expect(result.current.reason).toBe('not_resumable'));
        expect(onResume).not.toHaveBeenCalled();
    });
});

describe('useResumeFilePick ignored changes', () => {
    it('always resets the input and ignores missing requests or files', () => {
        const { result, uploadById, onResume } = mountHook();
        const noRequest = change(result, new File(['x'], 'ignored.bin'));
        expect(noRequest.value).toBe('');

        request(result);
        const noFile = change(result, null);
        expect(noFile.value).toBe('');
        expect(uploadById).not.toHaveBeenCalled();
        expect(onResume).not.toHaveBeenCalled();
    });
});

describe('useResumeFilePick stale reads', () => {
    it('drops a read that finishes after unmount', async () => {
        const readers = deferredReaders();
        const { result, onResume, unmount } = mountHook();
        request(result);
        change(result, new File(['x'], 'late.bin'));
        unmount();
        await act(async () => readers[0].finish());
        expect(onResume).not.toHaveBeenCalled();
    });

    it('drops a read after a request moves to another upload', async () => {
        const readers = deferredReaders();
        const { result, onResume, uploadById } = mountHook();
        request(result);
        change(result, new File(['x'], 'first.bin'));
        act(() => result.current.requestPick('upload-2'));
        await act(async () => readers[0].finish());
        expect(onResume).not.toHaveBeenCalled();
        expect(uploadById).toHaveBeenCalledOnce();
        expect(uploadById).toHaveBeenCalledWith('upload-1');
        expect(result.current.pendingId).toBe('upload-2');
        expect(result.current.reason).toBeNull();
    });
});

describe('useResumeFilePick clear', () => {
    it('resets pending id and reason', async () => {
        const { result } = mountHook({ entry: null });
        request(result);
        change(result, new File(['x'], 'missing.bin'));
        await waitFor(() => expect(result.current.reason).toBe('not_resumable'));
        act(() => result.current.clear());
        expect(result.current.pendingId).toBeNull();
        expect(result.current.reason).toBeNull();
    });
});
