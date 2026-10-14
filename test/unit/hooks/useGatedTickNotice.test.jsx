// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    gatedTickWarningCopy,
    useGatedTickNotice,
} from '../../../packages/core/src/shared/hooks/useGatedTickNotice.js';

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useGatedTickNotice', () => {
    it('debounces the lookup and counts real gated packs and files', async () => {
        const messaging = {
            listGatedContent: vi.fn(async () => [
                { files: [{ actionIndex: '101' }, { actionIndex: '102' }] },
                { files: [{ actionIndex: 'demo:fixture' }] },
                { files: [] },
            ]),
        };
        const { result } = renderHook(() => useGatedTickNotice({
            messaging, chainId: 'bitcoin-regtest', tick: ' art ',
        }));

        expect(result.current).toEqual({ gated: false, packCount: 0, fileCount: 0 });
        await act(async () => { await vi.advanceTimersByTimeAsync(399); });
        expect(messaging.listGatedContent).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(messaging.listGatedContent).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', tick: 'ART',
        });
        expect(result.current).toEqual({ gated: true, packCount: 1, fileCount: 2 });
    });

    it('cancels a pending lookup when the ticker changes', async () => {
        const messaging = { listGatedContent: vi.fn(async () => []) };
        const { rerender } = renderHook(
            ({ tick }) => useGatedTickNotice({
                messaging, chainId: 'bitcoin-regtest', tick,
            }),
            { initialProps: { tick: 'OLD' } },
        );

        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
        rerender({ tick: 'NEW' });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });

        expect(messaging.listGatedContent).toHaveBeenCalledTimes(1);
        expect(messaging.listGatedContent).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', tick: 'NEW',
        });
    });

    it('shares normalized warning copy with authoring flows', () => {
        expect(gatedTickWarningCopy(' art ', 'buyers')).toContain(
            'ART has token-gated content',
        );
        expect(gatedTickWarningCopy(' art ', 'buyers')).toContain(
            'buyers will receive the token WITHOUT the key',
        );
    });
});
