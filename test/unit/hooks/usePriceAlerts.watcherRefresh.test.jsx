// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const { messagingState } = vi.hoisted(() => ({ messagingState: { current: {} } }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingState.current }),
}));

const { usePriceAlerts } = await import(
    '../../../packages/core/src/shared/hooks/usePriceAlerts.js'
);
const { markAlertTriggered } = await import('../../../packages/core/src/flows/priceAlerts.js');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('usePriceAlerts watcher refresh', () => {
    it('shows a fired alert as triggered without reopening the list', async () => {
        const store = new Map([['a1', { id: 'a1', walletId: 'w1', status: 'armed' }]]);
        const vault = {
            priceAlerts: {
                get: async (id) => store.get(id),
                put: async (row) => { store.set(row.id, row); },
            },
        };
        messagingState.current = {
            listPriceAlertsForWallet: vi.fn(async () => [...store.values()]),
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(),
        };
        const { result } = renderHook(() => usePriceAlerts('w1'));
        await waitFor(() => expect(result.current.alerts[0]?.status).toBe('armed'));

        await act(async () => { await markAlertTriggered({ vault, id: 'a1' }); });

        await waitFor(() => expect(result.current.alerts[0]?.status).toBe('triggered'));
    });

    it('stops listening once the list unmounts', async () => {
        const list = vi.fn(async () => []);
        messagingState.current = {
            listPriceAlertsForWallet: list,
            savePriceAlert: vi.fn(),
            clearPriceAlert: vi.fn(),
        };
        const { unmount } = renderHook(() => usePriceAlerts('w1'));
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
        unmount();
        window.dispatchEvent(new CustomEvent('xchain:price-alerts-changed'));
        expect(list).toHaveBeenCalledTimes(1);
    });
});
