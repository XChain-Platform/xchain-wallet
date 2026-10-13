// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { messagingState, ownerState, stateUpdates } = vi.hoisted(() => ({
    messagingState: { current: {} },
    ownerState: { actionRun: vi.fn(), submit: vi.fn() },
    stateUpdates: { observing: false, attempts: 0 },
}));

vi.mock('react', async (importOriginal) => {
    const react = await importOriginal();
    return {
        ...react,
        useState(initialValue) {
            const [value, setValue] = react.useState(initialValue);
            const trackedSetValue = (nextValue) => {
                if (stateUpdates.observing) {
                    stateUpdates.attempts += 1;
                    return;
                }
                setValue(nextValue);
            };
            return [value, trackedSetValue];
        },
    };
});

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingState.current }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', () => ({
    useActionConfirmFlow: () => ({
        run: (...args) => ownerState.actionRun(...args),
        confirmAction: vi.fn(),
        open: false,
        composing: false,
    }),
    useConfirmSubmit: () => ownerState.submit,
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: false }),
}));

const { useNativePrice } = await import(
    '../../../packages/core/src/shared/hooks/useNativePrice.js'
);
const { usePriceAlerts } = await import(
    '../../../packages/core/src/shared/hooks/usePriceAlerts.js'
);
const { useSettings } = await import(
    '../../../packages/core/src/shared/hooks/useSettings.js'
);
const { __clearSignerInfoCache, useSignerInfo } = await import(
    '../../../packages/core/src/shared/hooks/useSignerInfo.js'
);
const { useSignerStatus } = await import(
    '../../../packages/core/src/shared/hooks/useSignerStatus.js'
);
const { useOwnerActionLane } = await import(
    '../../../packages/core/src/shared/hooks/useOwnerActionLane.js'
);

function deferred() {
    let resolve = () => {};
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

beforeEach(() => {
    messagingState.current = {};
    ownerState.actionRun.mockReset();
    ownerState.submit.mockReset();
    stateUpdates.observing = false;
    stateUpdates.attempts = 0;
    __clearSignerInfoCache();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    stateUpdates.observing = false;
});

describe('M to Z hook lifecycle regressions', () => {
    it('leaves native price loading when its request becomes inactive', () => {
        const pending = deferred();
        messagingState.current = {
            getNativePricesRequest: vi.fn(() => pending.promise),
        };
        const { result, rerender } = renderHook(
            ({ chainId }) => useNativePrice(chainId),
            { initialProps: { chainId: 'dogecoin-mainnet' } },
        );

        expect(result.current.loading).toBe(true);
        rerender({ chainId: null });

        expect(result.current).toMatchObject({
            entry: null, loading: false, disabled: false, error: null,
        });
    });

    it('ignores an older wallet price-alert response', async () => {
        const first = deferred();
        const second = deferred();
        messagingState.current = {
            listPriceAlertsForWallet: vi.fn(({ walletId }) => (
                walletId === 'wallet-a' ? first.promise : second.promise
            )),
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(),
        };
        const { result, rerender } = renderHook(
            ({ walletId }) => usePriceAlerts(walletId),
            { initialProps: { walletId: 'wallet-a' } },
        );
        rerender({ walletId: 'wallet-b' });

        await act(async () => { second.resolve([{ id: 'alert-b' }]); await second.promise; });
        expect(result.current.alerts).toEqual([{ id: 'alert-b' }]);

        await act(async () => { first.resolve([{ id: 'alert-a' }]); await first.promise; });
        expect(result.current.alerts).toEqual([{ id: 'alert-b' }]);

        rerender({ walletId: null });
        expect(result.current).toMatchObject({ alerts: [], loading: false, error: null });
    });

    it('keeps the newest settings refresh when reads resolve out of order', async () => {
        const first = deferred();
        const second = deferred();
        const getSettings = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        messagingState.current = { getSettings };
        const { result } = renderHook(() => useSettings());

        act(() => { window.dispatchEvent(new Event('xc:session-changed')); });
        expect(getSettings).toHaveBeenCalledTimes(2);

        await act(async () => { second.resolve({ walletMode: 'watcher' }); await second.promise; });
        expect(result.current.settings?.walletMode).toBe('watcher');

        await act(async () => { first.resolve({ walletMode: 'full' }); await first.promise; });
        expect(result.current.settings?.walletMode).toBe('watcher');
    });

    it('clears signer rows while a different wallet is loading', async () => {
        const second = deferred();
        messagingState.current = {
            listSigners: vi.fn((walletId) => walletId === 'wallet-a'
                ? Promise.resolve([{ id: 'signer-1', vendor: 'A', model: 'One' }])
                : second.promise),
        };
        const { result, rerender } = renderHook(
            ({ walletId }) => useSignerInfo({ walletId, signerId: 'signer-1' }),
            { initialProps: { walletId: 'wallet-a' } },
        );
        await waitFor(() => expect(result.current?.vendor).toBe('A'));

        rerender({ walletId: 'wallet-b' });
        expect(result.current).toBeNull();

        await act(async () => {
            second.resolve([{ id: 'signer-1', vendor: 'B', model: 'Two' }]);
            await second.promise;
        });
        expect(result.current?.vendor).toBe('B');
    });

    it('ignores a signer-status response for the previous chain', async () => {
        const first = deferred();
        const second = deferred();
        const getStatus = vi.fn(({ chainId }) => (
            chainId === 'bitcoin-mainnet' ? first.promise : second.promise
        ));
        const { result, rerender } = renderHook(
            ({ chainId }) => useSignerStatus({ getStatus, chainId }),
            { initialProps: { chainId: 'bitcoin-mainnet' } },
        );
        await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
        rerender({ chainId: 'litecoin-mainnet' });
        await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));

        await act(async () => {
            second.resolve({ status: 'available', detail: 'litecoin' });
            await second.promise;
        });
        expect(result.current).toMatchObject({ status: 'available', detail: 'litecoin' });

        await act(async () => {
            first.resolve({ status: 'wrong-app', detail: 'bitcoin' });
            await first.promise;
        });
        expect(result.current).toMatchObject({ status: 'available', detail: 'litecoin' });
    });

    it('does not clear owner-action state after unmount', async () => {
        const pending = deferred();
        ownerState.actionRun.mockReturnValue(pending.promise);
        messagingState.current = { getSignerStatus: vi.fn() };
        const { result, unmount } = renderHook(() => useOwnerActionLane({
            messaging: messagingState.current,
            walletId: 'wallet-a',
            chainId: 'bitcoin-mainnet',
            owner: { id: 'address-a', address: 'bc1owner', source: 'software' },
            software: 'signAction',
            hardware: 'signActionHw',
        }));
        const running = result.current.run({ actionData: { action: 'CLOSE', params: {} } });

        unmount();
        stateUpdates.observing = true;
        await act(async () => { pending.resolve({ txid: 'done' }); await running; });

        expect(stateUpdates.attempts).toBe(0);
    });
});
