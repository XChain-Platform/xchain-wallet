// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// History's `focus` bump (rate-limits spec, M3a). The bump costs a full
// fan-out per (chain, address) - history, links, mempool, our own pending
// sends - and it was the one re-poll on the wallet's hot path with no guard at
// all, so a user cycling between windows paid for every switch. What is pinned
// here: the first return still refetches at once, and a burst behind it does
// not, until the rows are a poll interval old.
//
// Only `Date` is faked: the window is a clock comparison, and leaving the
// timers real keeps the 20-second beat out of the test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function mountHistory() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
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
    it('refetches for the first return, then drops the burst behind it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const messaging = mountHistory();
        await waitFor(() => expect(fanOuts(messaging)).toBeGreaterThan(0));
        const afterMount = fanOuts(messaging);

        // Leading edge: nothing has claimed the window since the route
        // mounted, so coming back is honoured at once.
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
