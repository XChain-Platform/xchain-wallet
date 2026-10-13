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

const { state } = vi.hoisted(() => ({
    state: {
        messaging: null,
        settings: {
            activeNetwork: 'regtest',
            fees: { 'litecoin-regtest': { strategy: 'normal' } },
        },
    },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: state.messaging }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: state.settings }),
}));

const { useReachability } = await import(
    '../../../packages/core/src/shared/hooks/useReachability.js');

const CHAIN = 'litecoin-regtest';
const INTERVAL_MS = 30_000;

function healthy() {
    return {
        overall: 'normal',
        perChain: [{ chainId: CHAIN, mode: 'normal', services: {} }],
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    state.messaging = { checkReachabilityRequest: vi.fn(async () => healthy()) };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useReachability polling', () => {
    it('shares one read across mounts and keeps the documented interval', async () => {
        const first = renderHook(() => useReachability({ intervalMs: INTERVAL_MS }));
        const second = renderHook(() => useReachability({ intervalMs: INTERVAL_MS }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(first.result.current.overall).toBe('normal');
        expect(second.result.current.overall).toBe('normal');
        expect(state.messaging.checkReachabilityRequest).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1); });
        expect(state.messaging.checkReachabilityRequest).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(state.messaging.checkReachabilityRequest).toHaveBeenCalledTimes(2);
    });

    it('does not read while hidden and catches up when visible', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        renderHook(() => useReachability({ intervalMs: INTERVAL_MS }));

        await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2); });
        expect(state.messaging.checkReachabilityRequest).not.toHaveBeenCalled();

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(state.messaging.checkReachabilityRequest).toHaveBeenCalledTimes(1);
    });
});
