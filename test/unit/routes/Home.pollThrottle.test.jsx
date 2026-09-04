// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's re-poll rule (rate-limits spec, M3a). One alt-tab back into the
// wallet delivers `focus` and `visibilitychange` together, and each used to
// run a full balance load of every address on every chain, so a user flicking
// between windows put two or three whole wallet loads into one rate-limit
// period. What is pinned here: a burst inside the poll interval costs nothing
// beyond the poll that already ran, and the first event once the balances have
// aged past the interval still fires at once.
//
// Only `Date` is faked: the window is a clock comparison, so moving the clock
// is what "waiting out the interval" means, and leaving the timers real keeps
// the 20-second beat from firing inside the test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };

function mountHome() {
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { activeWalletId: WALLET.id }),
        ),
    );
    return messaging;
}

/** The alt-tab: both events, in the order a browser delivers them. */
const fireAltTab = () => act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Home throttles its focus/visibilitychange re-poll', () => {
    it('does not re-read balances for a burst inside the poll interval', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const messaging = mountHome();
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        const afterMount = messaging.getWalletBalances.mock.calls.length;

        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS - 1);
        fireAltTab();
        fireAltTab();

        expect(messaging.getWalletBalances.mock.calls.length).toBe(afterMount);
    });

    it('re-reads once, not twice, for the alt-tab that follows a full interval', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const messaging = mountHome();
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        const afterMount = messaging.getWalletBalances.mock.calls.length;

        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        fireAltTab();

        // One load for the pair of events, and the load that landed restarts
        // the window, so the next alt-tab rides it.
        await waitFor(() => expect(messaging.getWalletBalances.mock.calls.length)
            .toBe(afterMount + 1));
        fireAltTab();
        expect(messaging.getWalletBalances.mock.calls.length).toBe(afterMount + 1);
    });
});
