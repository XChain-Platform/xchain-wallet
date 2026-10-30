// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The scan holds while the caller reports the network unreachable: no read
// starts, nothing claims to be scanning, and the scan runs once when the
// connection returns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { messaging } = vi.hoisted(() => ({
    messaging: {
        getAddressesByChain: vi.fn(),
        getCoinpayObligationsForAddress: vi.fn(),
    },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

const { useCoinpayObligations } = await import(
    '../../../packages/core/src/shared/hooks/useCoinpayObligations.js');

beforeEach(() => {
    messaging.getAddressesByChain.mockReset()
        .mockResolvedValue({ 'litecoin-regtest': [{ address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi' }] });
    messaging.getCoinpayObligationsForAddress.mockReset().mockResolvedValue([]);
});

describe('useCoinpayObligations offline hold', () => {
    it('starts no read while offline and reports no scan in progress', async () => {
        const { result } = renderHook(() => useCoinpayObligations('offline-w1', 'a1', { offline: true }));
        await Promise.resolve();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(result.current.scanning).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('scans once when the connection returns', async () => {
        const { result, rerender } = renderHook(
            ({ offline }) => useCoinpayObligations('offline-w2', 'a1', { offline }),
            { initialProps: { offline: true } },
        );
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        rerender({ offline: false });
        await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.scanning).toBe(false));
    });
});
