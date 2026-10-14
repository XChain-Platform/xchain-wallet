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
import { useSignerStatus } from '../../../packages/core/src/shared/hooks/useSignerStatus.js';

const FAST_INTERVAL_MS = 2000;
const STEADY_INTERVAL_MS = 10000;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useSignerStatus polling', () => {
    it('shares one status read across mounts at the documented fast cadence', async () => {
        const getStatus = vi.fn(async () => ({ status: 'disconnected' }));
        const first = renderHook(() => useSignerStatus({ getStatus, chainId: 'litecoin-regtest' }));
        const second = renderHook(() => useSignerStatus({ getStatus, chainId: 'litecoin-regtest' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(first.result.current.status).toBe('disconnected');
        expect(second.result.current.status).toBe('disconnected');
        expect(getStatus).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS - 1); });
        expect(getStatus).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('does not read while hidden and catches up when visible', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        const getStatus = vi.fn(async () => ({ status: 'available' }));
        renderHook(() => useSignerStatus({ getStatus, chainId: 'litecoin-regtest' }));

        await act(async () => { await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS * 3); });
        expect(getStatus).not.toHaveBeenCalled();

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('uses the documented steady cadence after the signer is available', async () => {
        const getStatus = vi.fn(async () => ({ status: 'available' }));
        renderHook(() => useSignerStatus({ getStatus, chainId: 'litecoin-regtest' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        await act(async () => { await vi.advanceTimersByTimeAsync(STEADY_INTERVAL_MS - 1); });
        expect(getStatus).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(getStatus).toHaveBeenCalledTimes(2);
    });
});
