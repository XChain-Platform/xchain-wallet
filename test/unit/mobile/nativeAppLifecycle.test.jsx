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

function LifecycleHarness({ onBackground = () => {}, onResume = () => {}, sessionState = 'unlocked' }) {
    const policy = useAutoLockPolicy({
        sessionState,
        activeWalletId: WALLET.id,
    });
    const suspended = useNativeAppLifecycle({
        checkAutoLock: policy.checkNow,
        onBackground,
        onUnlockedResume: onResume,
        sessionState,
    });
    return <div data-testid="private-screen">{suspended ? 'covered' : 'balances'}</div>;
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
    it('ignores document lifecycle events outside a verified native shell', () => {
        globalThis.Capacitor = { Plugins: {} };
        const onBackground = vi.fn();
        render(provider(
            makeMessaging(0),
            <LifecycleHarness onBackground={onBackground} />,
        ));

        document.dispatchEvent(new Event('pause'));

        expect(onBackground).not.toHaveBeenCalled();
    });

    it('uses Capacitor document lifecycle events when the narrow App plugin has no state event', async () => {
        globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
        const messaging = makeMessaging(0);
        const onBackground = vi.fn();
        const onResume = vi.fn();
        const view = render(provider(
            messaging,
            <LifecycleHarness onBackground={onBackground} onResume={onResume} />,
        ));

        act(() => document.dispatchEvent(new Event('pause')));
        expect(view.getByTestId('private-screen')).toHaveTextContent('covered');
        act(() => document.dispatchEvent(new Event('resume')));

        expect(onBackground).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledTimes(1);
        expect(view.getByTestId('private-screen')).toHaveTextContent('balances');
    });

    it('deduplicates plugin and document notifications for one background cycle', async () => {
        const messaging = makeMessaging(0);
        const onBackground = vi.fn();
        const onResume = vi.fn();
        render(provider(
            messaging,
            <LifecycleHarness onBackground={onBackground} onResume={onResume} />,
        ));
        await act(async () => { await Promise.resolve(); });

        act(() => {
            appStateChange({ isActive: false });
            document.dispatchEvent(new Event('pause'));
            appStateChange({ isActive: true });
            document.dispatchEvent(new Event('resume'));
        });

        expect(onBackground).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('checks the configured idle deadline and locks after an elapsed background', async () => {
        vi.useFakeTimers();
        const messaging = makeMessaging(1);
        const onResume = vi.fn();
        const view = render(provider(
            messaging,
            <LifecycleHarness onResume={onResume} />,
        ));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        act(() => appStateChange({ isActive: false }));
        expect(view.getByTestId('private-screen')).toHaveTextContent('covered');
        vi.setSystemTime(Date.now() + 2 * MINUTE);
        act(() => appStateChange({ isActive: true }));

        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        expect(onResume).not.toHaveBeenCalled();
        expect(view.getByTestId('private-screen')).toHaveTextContent('covered');
    });

    it('honours Never and emits one refresh for one background cycle', async () => {
        const messaging = makeMessaging(0);
        const onBackground = vi.fn();
        const onResume = vi.fn();
        const view = render(provider(
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
        expect(view.getByTestId('private-screen')).toHaveTextContent('balances');
    });

    it('removes the cover after an elapsed resume reaches the locked state', async () => {
        vi.useFakeTimers();
        const messaging = makeMessaging(1);
        const view = render(provider(messaging, <LifecycleHarness />));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        act(() => appStateChange({ isActive: false }));
        vi.setSystemTime(Date.now() + 2 * MINUTE);
        act(() => appStateChange({ isActive: true }));
        expect(view.getByTestId('private-screen')).toHaveTextContent('covered');

        view.rerender(provider(messaging, <LifecycleHarness sessionState="locked" />));
        expect(view.getByTestId('private-screen')).toHaveTextContent('balances');
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

    it('removes document lifecycle listeners on unmount', () => {
        globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
        const onBackground = vi.fn();
        const view = render(provider(
            makeMessaging(0),
            <LifecycleHarness onBackground={onBackground} />,
        ));
        view.unmount();

        document.dispatchEvent(new Event('pause'));

        expect(onBackground).not.toHaveBeenCalled();
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
