// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import {
    act, cleanup, renderHook, waitFor,
} from '@testing-library/react';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useActionForm } from '../../../packages/core/src/shared/hooks/useActionForm.js';
import { useAutoLock } from '../../../packages/core/src/shared/hooks/useAutoLock.js';
import { useAutoLockPolicy } from '../../../packages/core/src/shared/hooks/useAutoLockPolicy.js';
import { useDispenserDestination } from '../../../packages/core/src/shared/hooks/useDispenserDestination.js';
import { useLastView } from '../../../packages/core/src/shared/hooks/useLastView.js';
import { useViewportClamp } from '../../../packages/core/src/shared/hooks/useViewportClamp.js';
import {
    readLastViewRoute,
} from '../../../packages/core/src/shared/utils/lastViewMemory.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsource0000000000000000000000000000000',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingWrapper(messaging, shell = 'web') {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ messaging, shell }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

async function flushMicrotasks() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

describe('useDispenserDestination', () => {
    const destination = 'bc1qdispenser000000000000000000000000000';
    const row = {
        action_index: '7',
        address: destination,
        give_tick: 'DOGI',
        give_amount: '5',
        get_coin: 'BTC',
        get_amount: '0.01',
        current_status: 'open',
        escrow_remaining: '50',
    };

    it('keeps the matching row when an optional detail method throws synchronously', async () => {
        vi.useFakeTimers();
        const messaging = {
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [row] }),
            getDispenserByActionIndex: vi.fn(() => { throw new Error('unsupported'); }),
        };
        const { result } = renderHook(() => useDispenserDestination({
            messaging,
            chainId: CHAIN,
            to: destination,
            paymentTick: 'BTC',
            isNativePayment: true,
            enabled: true,
        }));

        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await flushMicrotasks();

        expect(result.current).toHaveLength(1);
        expect(result.current[0].row.action_index).toBe('7');
    });

    it('does not let a slower lookup replace a newer destination', async () => {
        vi.useFakeTimers();
        const pending = new Map();
        const getDispensersForAddress = vi.fn(({ address }) => new Promise((resolve) => {
            pending.set(address, resolve);
        }));
        const messaging = { getDispensersForAddress };
        const props = (to) => ({
            messaging,
            chainId: CHAIN,
            to,
            paymentTick: 'BTC',
            isNativePayment: true,
            enabled: true,
        });
        const first = destination;
        const second = `${destination}2`;
        const { result, rerender } = renderHook(
            ({ to }) => useDispenserDestination(props(to)),
            { initialProps: { to: first } },
        );
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        rerender({ to: second });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });

        await act(async () => {
            pending.get(second)({ data: [{ ...row, action_index: '8', address: second }] });
            await Promise.resolve();
        });
        expect(result.current[0].row.action_index).toBe('8');

        await act(async () => {
            pending.get(first)({ data: [row] });
            await Promise.resolve();
        });
        expect(result.current[0].row.action_index).toBe('8');
    });
});

describe('useActionForm', () => {
    function baseMessaging(overrides = {}) {
        return {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            updateSettings: vi.fn().mockResolvedValue({}),
            ...overrides,
        };
    }

    function renderActionForm(messaging) {
        return renderHook(() => useActionForm({
            walletId: 'wallet-1',
            action: 'MINT',
            submitMethods: { hw: 'mintHw', software: 'mintSoftware' },
            initialChainId: CHAIN,
        }), { wrapper: messagingWrapper(messaging) });
    }

    it('loads a source when optional host reads throw synchronously', async () => {
        const messaging = baseMessaging({
            getActiveAddresses: vi.fn(() => { throw new Error('unsupported'); }),
            getSettings: vi.fn(() => { throw new Error('locked'); }),
        });
        const { result } = renderActionForm(messaging);

        await waitFor(() => expect(result.current.fromAddress).toEqual(ADDRESS));
        expect(result.current.loadError).toBeNull();
    });

    it('surfaces a synchronous address read failure as a load error', async () => {
        const messaging = baseMessaging({
            getAddressesByChain: vi.fn(() => { throw new Error('host unavailable'); }),
        });
        const { result } = renderActionForm(messaging);

        await waitFor(() => expect(result.current.loadError).toBe('host unavailable'));
        expect(result.current.fromAddress).toBeNull();
    });

    it.each([
        ['watcher', 'hd', 'buildActionPsbtRequest'],
        ['full', 'trezor', 'mintHw'],
        ['full', 'hd', 'mintSoftware'],
    ])('dispatches %s mode with a %s source through %s', async (walletMode, source, method) => {
        const selected = { ...ADDRESS, source };
        const messaging = baseMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [selected] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: selected.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode }),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbt: 'aa' }),
            mintHw: vi.fn().mockResolvedValue({ txid: 'hw' }),
            mintSoftware: vi.fn().mockResolvedValue({ txid: 'software' }),
        });
        const { result } = renderActionForm(messaging);
        await waitFor(() => {
            expect(result.current.fromAddress).toEqual(selected);
            expect(result.current.isWatcherMode).toBe(walletMode === 'watcher');
        });

        await act(async () => {
            await result.current.submit({
                params: { tick: 'TEST' },
                password: 'secret',
                encoderOpts: { feeRate: 2 },
            });
        });

        expect(messaging[method]).toHaveBeenCalledTimes(1);
        if (method === 'buildActionPsbtRequest') {
            expect(messaging[method]).toHaveBeenCalledWith(expect.objectContaining({
                chainId: CHAIN,
                actionData: { action: 'MINT', params: { tick: 'TEST' } },
                encoderOpts: { feeRate: 2 },
            }));
        } else {
            expect(messaging[method]).toHaveBeenCalledWith(expect.objectContaining({
                walletId: 'wallet-1',
                chainId: CHAIN,
                from: expect.objectContaining({ addressId: ADDRESS.id }),
            }));
        }
    });
});

describe('useLastView', () => {
    function args(overrides = {}) {
        return {
            walletId: 'wallet-1',
            currentView: 'home',
            onResume: vi.fn(),
            onResumeParams: vi.fn(),
            ...overrides,
        };
    }

    it('ignores unsupported routes from browser history', () => {
        const options = args();
        renderHook(() => useLastView(options));

        act(() => {
            window.dispatchEvent(new PopStateEvent('popstate', {
                state: { xcRoute: { walletId: 'wallet-1', view: 'wallet-secrets', params: null } },
            }));
        });
        expect(options.onResume).not.toHaveBeenCalled();

        act(() => {
            window.dispatchEvent(new PopStateEvent('popstate', {
                state: { xcRoute: { walletId: 'wallet-1', view: 'history', params: null } },
            }));
        });
        expect(options.onResumeParams).toHaveBeenCalledWith('history', null);
        expect(options.onResume).toHaveBeenCalledWith('history');
    });

    it('persists resumable views and clears an unsafe route to Home', () => {
        const onResume = vi.fn();
        const { rerender } = renderHook(
            ({ currentView }) => useLastView(args({ currentView, onResume })),
            { initialProps: { currentView: 'home' } },
        );

        rerender({ currentView: 'history' });
        expect(readLastViewRoute('wallet-1')).toEqual({ view: 'history', params: null });
        rerender({ currentView: 'send' });
        expect(readLastViewRoute('wallet-1')).toBeNull();
    });
});

describe('useViewportClamp', () => {
    it('measures on open, remeasures on resize, and clears its shift on close', () => {
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: 320,
        });
        let renderedLeft = -20;
        const element = {
            getBoundingClientRect: vi.fn(() => ({ left: renderedLeft, width: 100 })),
        };
        const { result, rerender } = renderHook(
            ({ open }) => useViewportClamp(open),
            { initialProps: { open: false } },
        );
        result.current.ref.current = element;

        rerender({ open: true });
        expect(result.current.style).toEqual({ transform: 'translateX(32px)' });

        renderedLeft = 12;
        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(result.current.style).toEqual({ transform: 'translateX(32px)' });

        rerender({ open: false });
        expect(result.current.style).toBeUndefined();
    });
});

describe('useAutoLock', () => {
    it('uses the latest callback and becomes inert when disabled', async () => {
        vi.useFakeTimers();
        const first = vi.fn();
        const latest = vi.fn();
        const { result, rerender } = renderHook(
            ({ onLock, enabled }) => useAutoLock(onLock, { idleMs: 1000, tickMs: 100, enabled }),
            { initialProps: { onLock: first, enabled: true } },
        );

        rerender({ onLock: latest, enabled: true });
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);

        rerender({ onLock: latest, enabled: false });
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(latest).toHaveBeenCalledTimes(1);
        expect(result.current()).toBe(false);
    });
});

describe('useAutoLockPolicy', () => {
    it('keeps the foreground policy armed when backstop reporting throws synchronously', async () => {
        vi.useFakeTimers();
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ autolockMinutes: 5 }),
            lockWallet: vi.fn().mockResolvedValue({ locked: true }),
            reportAutoLock: vi.fn(() => { throw new Error('unsupported'); }),
        };
        const { result } = renderHook(() => useAutoLockPolicy({
            sessionState: 'unlocked',
            activeWalletId: 'wallet-1',
        }), { wrapper: messagingWrapper(messaging, 'popup') });

        await flushMicrotasks();
        expect(result.current).toMatchObject({
            armed: true,
            idleMs: 5 * 60 * 1000,
            minutes: 5,
        });
        expect(messaging.reportAutoLock).toHaveBeenCalled();
    });
});
