// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The badge hook's re-poll rule (rate-limits spec, M3a for the tab switch, M4
// row 41 for the beat). The scan costs one explorer read per (chain, address),
// and `visibilitychange` fires at the same moment Home re-polls balances, so an
// an alt-tab once added a whole extra sweep on top of the poll it just had. What
// is pinned here: a tab switch inside the poll interval scans nothing, the
// first one after the interval scans once however many events arrive, the
// manual refresh is never throttled, and the beat starts nothing while a scan
// is still open, which is what a 429 the SDK is waiting out looks like here.
//
// Most cases fake only `Date`. The window is a clock comparison, so moving the
// clock is what "advance" means, and leaving the timers real keeps React
// Testing Library's async helpers on their normal path. The in-flight case
// fakes every timer, because there the beat itself is under test.

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

    it('does not start a second scan while the first is still open, and beats again once it lands', async () => {
        // The beat is the thing under test here, so every timer is faked, not
        // just `Date`: `advanceTimersByTimeAsync` then both fires the interval
        // and moves the clock the window reads. The real-timer restore first is
        // load-bearing - `useFakeTimers` over an already-installed fake clock
        // keeps the OLD `toFake` list, so the interval would silently stay real
        // and every assertion below would be vacuous. Testing Library's
        // `waitFor` polls on `setInterval`, so it cannot be used past this
        // point; the flushes are explicit instead.
        vi.useRealTimers();
        vi.useFakeTimers();
        let release;
        const held = new Promise((r) => { release = r; });
        messaging.getAddressesByChain.mockReset().mockReturnValueOnce(held)
            .mockResolvedValue({ [CHAIN]: [{ address: ADDR }] });

        renderHook(() => useCoinpayObligations('w1', 'a1', { pollMs: POLL_MS }));
        // The mount scan issues its first read synchronously inside the effect.
        expect(scanCount()).toBe(1);

        // This is the 429 shape: the SDK sits on a `Retry-After` of up to 60 s,
        // so a whole poll interval (and more) passes under one open scan.
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
        expect(scanCount()).toBe(1);

        await act(async () => {
            release({ [CHAIN]: [{ address: ADDR }] });
            await vi.advanceTimersByTimeAsync(1);
        });
        // Landed, so the slot is free and the next beat scans again.
        await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
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
