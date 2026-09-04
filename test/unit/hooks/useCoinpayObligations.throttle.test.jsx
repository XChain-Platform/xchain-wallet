// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The badge hook's re-poll rule (rate-limits spec, M3a). The scan costs one
// explorer read per (chain, address), and `visibilitychange` fires at the same
// moment Home re-polls balances, so an alt-tab used to add a whole extra sweep
// on top of the poll it just had. What is pinned here: a tab switch inside the
// poll interval scans nothing, the first one after the interval scans once
// however many events arrive, and the manual refresh is never throttled.
//
// Only `Date` is faked. The window is a clock comparison, so moving the clock
// is what "advance" means here, and leaving setTimeout real keeps React
// Testing Library's async helpers on their normal path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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

const CHAIN = 'litecoin-regtest';
const ADDR = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const POLL_MS = 60_000;

/** Scans, counted at the one call every scan makes exactly once. */
const scanCount = () => messaging.getAddressesByChain.mock.calls.length;

const fireVisible = () => act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    messaging.getAddressesByChain.mockReset()
        .mockResolvedValue({ [CHAIN]: [{ address: ADDR }] });
    messaging.getCoinpayObligationsForAddress.mockReset().mockResolvedValue([]);
});

afterEach(() => { vi.useRealTimers(); });

describe('useCoinpayObligations re-poll throttle', () => {
    it('does not rescan on a tab switch inside the poll interval', async () => {
        const { result } = renderHook(() => useCoinpayObligations('w1', 'a1', { pollMs: POLL_MS }));
        await waitFor(() => expect(result.current.scanning).toBe(false));
        expect(scanCount()).toBe(1);

        vi.setSystemTime(Date.now() + POLL_MS - 1);
        fireVisible();
        fireVisible();

        expect(scanCount()).toBe(1);
    });

    it('rescans once for a burst of events after the interval has passed', async () => {
        const { result } = renderHook(() => useCoinpayObligations('w1', 'a1', { pollMs: POLL_MS }));
        await waitFor(() => expect(result.current.scanning).toBe(false));

        vi.setSystemTime(Date.now() + POLL_MS);
        // An alt-tab back delivers the event more than once in practice; the
        // second must ride the scan the first started.
        fireVisible();
        fireVisible();

        expect(scanCount()).toBe(2);
        await waitFor(() => expect(result.current.scanning).toBe(false));
        // Still one: the rescan restarted the window as it landed.
        fireVisible();
        expect(scanCount()).toBe(2);
    });

    it('scans at once for a manual refresh, however fresh the rows are', async () => {
        const { result } = renderHook(() => useCoinpayObligations('w1', 'a1', { pollMs: POLL_MS }));
        await waitFor(() => expect(result.current.scanning).toBe(false));
        expect(scanCount()).toBe(1);

        await act(async () => { result.current.refresh(); });
        expect(scanCount()).toBe(2);

        await waitFor(() => expect(result.current.scanning).toBe(false));
        await act(async () => { result.current.refresh(); });
        expect(scanCount()).toBe(3);
    });
});
