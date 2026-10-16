// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// One offline signal for every offline-aware screen: the device reporting no
// network, or the shared probe confirming every service unreachable while the
// device still reports a network (a phone WebView with Wi-Fi off). A demo
// wallet reads fixtures and is never offline.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'normal', refresh: vi.fn() }));
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: reachability.overall, refresh: reachability.refresh }),
}));
vi.mock('../../../packages/core/src/flows/demoMode.js', () => ({
    isDemoWallet: (id) => id === 'demo-wallet',
}));

import { useNetworkOffline } from '../../../packages/core/src/shared/hooks/useNetworkOffline.js';

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

afterEach(() => {
    reachability.overall = 'normal';
    delete navigator.onLine;
});

describe('useNetworkOffline', () => {
    it('is online when the device and the probe agree', () => {
        setNavigatorOnline(true);
        expect(renderHook(() => useNetworkOffline()).result.current.offline).toBe(false);
    });

    it('is offline when the device reports no network', () => {
        setNavigatorOnline(false);
        expect(renderHook(() => useNetworkOffline()).result.current.offline).toBe(true);
    });

    it('is offline when every service is unreachable on a device that reports a network', () => {
        setNavigatorOnline(true);
        reachability.overall = 'offline';
        expect(renderHook(() => useNetworkOffline()).result.current.offline).toBe(true);
    });

    it('stays online while only some services are unreachable', () => {
        setNavigatorOnline(true);
        reachability.overall = 'degraded';
        expect(renderHook(() => useNetworkOffline()).result.current.offline).toBe(false);
    });

    it('is never offline for a demo wallet', () => {
        setNavigatorOnline(false);
        reachability.overall = 'offline';
        expect(renderHook(() => useNetworkOffline({ walletId: 'demo-wallet' })).result.current.offline).toBe(false);
    });

    it('hands back the probe recheck', () => {
        expect(renderHook(() => useNetworkOffline()).result.current.recheck).toBe(reachability.refresh);
    });
});
