// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { useAutoLockPolicy } from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import {
    dismissAllOverlays,
    registerBackHandler,
    resetBackStackForTests,
} from '../../../packages/core/src/ui/backStack.js';
import {
    canApplyNativeIntent,
    useNativeAppLifecycle,
} from '../../../packages/web/src/platform/nativeAppLifecycle.js';

const MINUTE = 60 * 1000;
const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
let appStateChange;
let removeListener;

function makeMessaging(autolockMinutes) {
    return {
        lockWallet: vi.fn(async () => ({ locked: true })),
        getSettings: vi.fn(async () => ({ schemaVersion: 2, autolockMinutes })),
        updateSettings: vi.fn(async (patch) => patch),
    };
}

function LifecycleHarness({ onBackground = () => {}, onResume = () => {} }) {
    const policy = useAutoLockPolicy({
        sessionState: 'unlocked',
        activeWalletId: WALLET.id,
    });
    useNativeAppLifecycle({
        checkAutoLock: policy.checkNow,
        onBackground,
        onUnlockedResume: onResume,
    });
    return null;
}

function provider(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

beforeEach(() => {
    removeListener = vi.fn();
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
            App: {
                addListener: vi.fn((event, listener) => {
                    if (event === 'appStateChange') appStateChange = listener;
                    return { remove: removeListener };
                }),
            },
        },
    };
});

afterEach(async () => {
    cleanup();
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.resolve();
});

describe('Capacitor app resume', () => {
    it('checks the configured idle deadline and locks after an elapsed background', async () => {
        vi.useFakeTimers();
        const messaging = makeMessaging(1);
        const onResume = vi.fn();
        render(provider(
            messaging,
            <LifecycleHarness onResume={onResume} />,
        ));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        act(() => appStateChange({ isActive: false }));
        vi.setSystemTime(Date.now() + 2 * MINUTE);
        act(() => appStateChange({ isActive: true }));

        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        expect(onResume).not.toHaveBeenCalled();
    });

    it('honours Never and emits one refresh for one background cycle', async () => {
        const messaging = makeMessaging(0);
        const onBackground = vi.fn();
        const onResume = vi.fn();
        render(provider(
            messaging,
            <LifecycleHarness onBackground={onBackground} onResume={onResume} />,
        ));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        act(() => {
            appStateChange({ isActive: false });
            appStateChange({ isActive: false });
            appStateChange({ isActive: true });
            appStateChange({ isActive: true });
        });

        expect(messaging.lockWallet).not.toHaveBeenCalled();
        expect(onBackground).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('closes scanner and overlay state without navigating, and queues suspended links', async () => {
        const messaging = makeMessaging(0);
        const overlay = vi.fn();
        const route = vi.fn();
        const closeScanner = vi.fn();
        const offRoute = registerBackHandler(route, 'route');
        const offOverlay = registerBackHandler(overlay, 'overlay');
        render(provider(
            messaging,
            <LifecycleHarness onBackground={() => {
                closeScanner();
                dismissAllOverlays();
            }} />,
        ));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        act(() => appStateChange({ isActive: false }));

        expect(closeScanner).toHaveBeenCalledTimes(1);
        expect(overlay).toHaveBeenCalledTimes(1);
        expect(route).not.toHaveBeenCalled();
        expect(canApplyNativeIntent('unlocked', false)).toBe(true);
        expect(canApplyNativeIntent('unlocked', true)).toBe(false);
        expect(canApplyNativeIntent('locked', false)).toBe(false);
        offOverlay();
        offRoute();
    });

    it('removes the App listener on unmount', async () => {
        const messaging = makeMessaging(0);
        const view = render(provider(messaging, <LifecycleHarness />));
        view.unmount();
        await waitFor(() => expect(removeListener).toHaveBeenCalledTimes(1));
    });
});

describe('Home native resume refresh', () => {
    it('loads balances exactly once for each new resume key', async () => {
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const view = render(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} resumeKey={0} />,
        ));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1));

        view.rerender(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} resumeKey={1} />,
        ));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2));

        view.rerender(provider(
            messaging,
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} resumeKey={1} />,
        ));
        await act(async () => { await Promise.resolve(); });
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);
    });
});
