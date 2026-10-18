// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: useReachability publishes an offline verdict whose every failure was a
// refused connection on the first round, inside the startup grace and without a
// confirming probe, while every other non-normal verdict keeps both.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useReachability } from '../../../packages/core/src/shared/hooks/useReachability.js';

const BTC = 'bitcoin-regtest';

function settings() {
    return { activeNetwork: 'regtest', fees: { [BTC]: { strategy: 'normal' } } };
}

function offlineAnswer(extra = {}) {
    return {
        overall: 'offline',
        perChain: [{
            chainId: BTC,
            mode: 'offline',
            services: { encoder: 'unreachable', hub: 'unreachable', explorer: 'unreachable' },
        }],
        ...extra,
    };
}

function messagingFor(check) {
    return { shell: 'web', getSettings: vi.fn(async () => settings()), checkReachabilityRequest: check };
}

function wrapperFor(messaging) {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

afterEach(() => { delete navigator.onLine; });

describe('useReachability fast-fail verdict', () => {
    it('publishes offline on the first round, inside the startup grace', async () => {
        const check = vi.fn(async () => offlineAnswer({ failedFast: true }));
        const { result } = renderHook(
            () => useReachability({ intervalMs: 0, confirmMs: 60_000, startupGraceMs: 60_000 }),
            { wrapper: wrapperFor(messagingFor(check)) },
        );
        await waitFor(() => expect(result.current.overall).toBe('offline'));
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('holds an offline verdict that did not fail fast until the grace and a second probe agree', async () => {
        const check = vi.fn(async () => offlineAnswer());
        const { result } = renderHook(
            () => useReachability({ intervalMs: 0, confirmMs: 60_000, startupGraceMs: 60_000 }),
            { wrapper: wrapperFor(messagingFor(check)) },
        );
        await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(result.current.overall).toBe('unknown');
    });

    it('holds a degraded verdict even when it carries the flag', async () => {
        const check = vi.fn(async () => ({
            overall: 'degraded',
            failedFast: true,
            perChain: [{
                chainId: BTC,
                mode: 'degraded',
                services: { encoder: 'reachable', hub: 'unreachable', explorer: 'reachable' },
            }],
        }));
        const { result } = renderHook(
            () => useReachability({ intervalMs: 0, confirmMs: 60_000, startupGraceMs: 60_000 }),
            { wrapper: wrapperFor(messagingFor(check)) },
        );
        await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(result.current.overall).toBe('unknown');
    });
});
