// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useDropZone } from '../../../packages/core/src/shared/hooks/useDropZone.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useDropZone', () => {
    it('tracks drag state and reads an accepted text file', async () => {
        const onFile = vi.fn();
        const preventDefault = vi.fn();
        const dataTransfer = {
            files: [new File(['wallet data'], 'backup.json', { type: 'application/json' })],
            dropEffect: 'none',
        };
        const { result } = renderHook(() => useDropZone({ onFile, accept: ['.json'] }));

        act(() => result.current.rootProps.onDragOver({ preventDefault, dataTransfer }));
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(dataTransfer.dropEffect).toBe('copy');
        expect(result.current.isDragOver).toBe(true);
        expect(result.current.rootProps['data-drop-active']).toBe('true');

        act(() => result.current.rootProps.onDrop({ preventDefault, dataTransfer }));
        await waitFor(() => expect(onFile).toHaveBeenCalledWith({
            file: dataTransfer.files[0], content: 'wallet data',
        }));
        expect(result.current.isDragOver).toBe(false);
    });

    it('rejects oversized and unaccepted files without reading them', async () => {
        const onFile = vi.fn();
        const onError = vi.fn();
        const { result } = renderHook(() => useDropZone({
            onFile, onError, accept: ['.json'], maxBytes: 4,
        }));

        act(() => result.current.rootProps.onDrop({
            preventDefault: vi.fn(),
            dataTransfer: { files: [new File(['large'], 'backup.json')] },
        }));
        await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('too large')));

        act(() => result.current.rootProps.onDrop({
            preventDefault: vi.fn(),
            dataTransfer: { files: [new File(['x'], 'backup.txt', { type: 'text/plain' })] },
        }));
        await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('not accepted')));
        expect(onFile).not.toHaveBeenCalled();
    });

    it('does nothing while disabled', () => {
        const onFile = vi.fn();
        const preventDefault = vi.fn();
        const { result } = renderHook(() => useDropZone({ onFile, disabled: true }));

        act(() => result.current.rootProps.onDrop({
            preventDefault,
            dataTransfer: { files: [new File(['x'], 'file.txt')] },
        }));

        expect(preventDefault).not.toHaveBeenCalled();
        expect(onFile).not.toHaveBeenCalled();
    });
});
