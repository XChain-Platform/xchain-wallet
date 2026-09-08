// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// History's `focus` bump and its 20-second beat (rate-limits spec, M3a for the
// bump, M4 row 41 for the beat). A fan-out costs one read per (chain, address)
// on each of four channels - history, links, mempool, our own pending sends -
// and it was the one re-poll on the wallet's hot path with no guard at all, so
// a user cycling between windows paid for every switch. What is pinned here:
// the first return after the rows age out refetches at once, a burst behind it
// does not, and NOTHING starts a second fan-out while one is still running,
// which is what a 429 the SDK is waiting out looks like from here.
//
// Two faking modes. The focus cases fake only `Date`: the window is a clock
// comparison, and leaving the timers real keeps the 20-second beat out of the
// test. The in-flight cases also fake `setInterval`, because the beat is the
// thing under test; `setTimeout` stays real either way, so React Testing
// Library's async helpers keep their normal path.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

/** A promise the test resolves by hand, to hold a fan-out open. */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function mountHistory(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        ...overrides,
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
    return messaging;
}

const fireFocus = () => act(() => { window.dispatchEvent(new Event('focus')); });

/** Fan-outs so far, counted at one read every fetch makes per address. */
const fanOuts = (messaging) => messaging.getAddressHistory.mock.calls.length;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('History throttles its focus bump', () => {
    it('refetches for the first return after the rows age out, then drops the burst behind it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const messaging = mountHistory();
        await waitFor(() => expect(fanOuts(messaging)).toBeGreaterThan(0));
        const afterMount = fanOuts(messaging);

        // The mount fan-out restarts the window where it lands, so a return
        // straight after it buys nothing: those rows ARE the fresh ones.
        fireFocus();
        expect(fanOuts(messaging)).toBe(afterMount);

        // Leading edge: the first return once the rows have aged past one
        // interval is honoured at once.
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        fireFocus();
        await waitFor(() => expect(fanOuts(messaging)).toBe(afterMount + 1));

        // The rest of the switching costs nothing until the rows age out.
        fireFocus();
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS - 1);
        fireFocus();
        expect(fanOuts(messaging)).toBe(afterMount + 1);

        vi.setSystemTime(Date.now() + 1);
        fireFocus();
        await waitFor(() => expect(fanOuts(messaging)).toBe(afterMount + 2));
    });
});

describe('History will not stack a fan-out on one still in flight', () => {
    // The beat is the thing under test here, so `setInterval` is faked too and
    // `advanceTimersByTimeAsync` both fires it and moves the clock the window
    // reads. The real-timer restore first is load-bearing: `useFakeTimers` over
    // an already-installed fake clock keeps the OLD `toFake` list, so the
    // interval would silently stay real and every assertion below would be
    // vacuous. `waitFor` polls on `setInterval`, so past this point the flushes
    // are explicit instead.
    const useBeatTimers = () => {
        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    };
    const settle = async () => {
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    };
    const beat = async () => {
        await act(async () => { await vi.advanceTimersByTimeAsync(BALANCE_POLL_INTERVAL_MS); });
    };

    it('drops the beat while the fan-out is open, and honours the next one after it lands', async () => {
        useBeatTimers();
        const held = deferred();
        // One held read is enough to hold the whole fan-out: it lands on a
        // single Promise.all over every task.
        const messaging = mountHistory({
            getAddressHistory: vi.fn().mockReturnValue(held.promise),
        });
        await settle();
        expect(fanOuts(messaging)).toBe(1);

        // This is the 429 shape: the SDK is sitting on a `Retry-After` of up
        // to 60 s, so three beats can pass under one open fan-out.
        await beat();
        await beat();
        await beat();
        expect(fanOuts(messaging)).toBe(1);

        held.resolve([]);
        await settle();
        // Landed, so the slot is free and the window restarts here.
        await beat();
        expect(fanOuts(messaging)).toBe(2);
    });

    it('drops a focus during the fan-out and one inside the window it lands in', async () => {
        useBeatTimers();
        const held = deferred();
        const messaging = mountHistory({
            getAddressHistory: vi.fn().mockReturnValue(held.promise),
        });
        await settle();
        expect(fanOuts(messaging)).toBe(1);

        // In flight: the window's opinion does not matter, the slot is taken.
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS * 3);
        fireFocus();
        fireFocus();
        await settle();
        expect(fanOuts(messaging)).toBe(1);

        held.resolve([]);
        await settle();
        // Landed: the slot is free, but the window restarted at the landing,
        // so a return inside it is still dropped.
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS - 1);
        fireFocus();
        await settle();
        expect(fanOuts(messaging)).toBe(1);

        vi.setSystemTime(Date.now() + 1);
        fireFocus();
        await settle();
        expect(fanOuts(messaging)).toBe(2);
    });
});
