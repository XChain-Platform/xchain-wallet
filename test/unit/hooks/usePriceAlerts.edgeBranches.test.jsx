// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { messagingState } = vi.hoisted(() => ({
    messagingState: { current: {} },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingState.current }),
}));

const { usePriceAlerts } = await import(
    '../../../packages/core/src/shared/hooks/usePriceAlerts.js'
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function supportedMessaging(listPriceAlertsForWallet = vi.fn(async () => [])) {
    return {
        listPriceAlertsForWallet,
        savePriceAlert: vi.fn(async () => undefined),
        clearPriceAlert: vi.fn(async () => true),
    };
}

beforeEach(() => {
    messagingState.current = {};
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('usePriceAlerts edge branches', () => {
    it('keeps every mutation inert when the shell does not support alerts', async () => {
        const { result } = renderHook(() => usePriceAlerts('wallet-1'));

        await act(async () => {
            await result.current.addAlert({ chainId: 'btc', direction: 'above', targetFiat: 1, fiatCurrency: 'USD' });
            await result.current.updateAlert('alert-1', { chainId: 'btc', direction: 'below', targetFiat: 2, fiatCurrency: 'USD' });
            await result.current.removeAlert('alert-1');
            await result.current.rearm('alert-1');
        });

        expect(result.current).toMatchObject({ alerts: [], loading: false, supported: false, error: null });
    });

    it('sends add and update requests and treats a missing rearm route as unsupported', async () => {
        messagingState.current = supportedMessaging();
        const { result } = renderHook(() => usePriceAlerts('wallet-1'));
        await waitFor(() => expect(messagingState.current.listPriceAlertsForWallet).toHaveBeenCalled());

        await act(async () => result.current.addAlert({
            chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 10, fiatCurrency: 'USD',
        }));
        await act(async () => result.current.updateAlert('alert-1', {
            chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 9, fiatCurrency: 'USD',
        }));
        await act(async () => result.current.rearm('alert-1'));

        expect(messagingState.current.savePriceAlert).toHaveBeenNthCalledWith(1, {
            walletId: 'wallet-1', chainId: 'bitcoin-mainnet', direction: 'above', targetFiat: 10, fiatCurrency: 'USD',
        });
        expect(messagingState.current.savePriceAlert).toHaveBeenNthCalledWith(2, {
            id: 'alert-1', walletId: 'wallet-1', chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 9, fiatCurrency: 'USD',
        });
    });

    it('normalizes non-array rows and errors without messages', async () => {
        const list = vi.fn()
            .mockResolvedValueOnce({ unexpected: true })
            .mockRejectedValueOnce(null);
        messagingState.current = supportedMessaging(list);
        const { result } = renderHook(() => usePriceAlerts('wallet-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.alerts).toEqual([]);

        await act(async () => result.current.reload());

        expect(result.current).toMatchObject({ alerts: [], loading: false, error: 'Could not load price alerts' });
    });

    it('ignores a stale rejected request and reload calls retained after unmount', async () => {
        const first = deferred();
        const list = vi.fn(({ walletId }) => (
            walletId === 'wallet-a' ? first.promise : Promise.resolve([])
        ));
        messagingState.current = supportedMessaging(list);
        const { result, rerender, unmount } = renderHook(
            ({ walletId }) => usePriceAlerts(walletId),
            { initialProps: { walletId: 'wallet-a' } },
        );

        rerender({ walletId: 'wallet-b' });
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => {
            first.reject(new Error('stale failure'));
            await first.promise.catch(() => undefined);
        });
        expect(result.current.error).toBeNull();

        const reload = result.current.reload;
        const callsBeforeUnmount = list.mock.calls.length;
        unmount();
        await reload();
        expect(list).toHaveBeenCalledTimes(callsBeforeUnmount);
    });
});
