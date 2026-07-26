// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home must render the wallet the HOST says is active, not the first wallet in
// the list. Home used to own `activeWalletId` outright and only ever seeded it
// to wallets[0], while the shell handed down `activeAccountId` for whichever
// wallet the user switched to. After any switch the two disagreed, and the
// balance read went out as a cross-wallet (walletId, accountId) pair that
// `walletBalances` rejects by design - "account X does not belong to wallet Y" -
// which blanked Home behind an error for every multi-wallet user.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const WALLET_A = { id: 'wallet-a', name: 'Main Wallet' };
const WALLET_B = { id: 'wallet-b', name: 'Buyer Wallet' };
const ACCOUNT_B = 'account-b';

function mountHome(props = {}) {
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
        listAccounts: vi.fn().mockResolvedValue([{ id: ACCOUNT_B, index: 0, walletId: WALLET_B.id }]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { ...props }),
        ),
    );
    return { messaging, view };
}

afterEach(() => cleanup());

describe('Home honours the host active wallet', () => {
    it('reads balances for the HOST wallet, not wallets[0]', async () => {
        // The switched-to wallet is second in the list: self-electing wallets[0]
        // is exactly the bug, so a passing assertion here has to come from the
        // prop winning.
        const { messaging } = mountHome({
            activeWalletId: WALLET_B.id,
            activeAccountId: ACCOUNT_B,
        });

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        const [walletId, accountId] = messaging.getWalletBalances.mock.calls[0];
        expect(walletId).toBe(WALLET_B.id);
        expect(accountId).toBe(ACCOUNT_B);
        // The pair must be internally consistent: the account belongs to the
        // wallet that was queried, which is what walletBalances enforces.
        expect(messaging.getWalletBalances.mock.calls
            .every(([w]) => w === WALLET_B.id)).toBe(true);
    });

    it('falls back to the first wallet when the host wires no active wallet', async () => {
        // Shells that predate the prop keep working off Home's local state.
        const { messaging } = mountHome({});
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(messaging.getWalletBalances.mock.calls[0][0]).toBe(WALLET_A.id);
    });

    it('re-reads balances against the new wallet when the host switches', async () => {
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET_A, WALLET_B]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const tree = (walletId, accountId) => React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { activeWalletId: walletId, activeAccountId: accountId }),
        );
        const { rerender } = render(tree(WALLET_A.id, 'account-a'));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());

        rerender(tree(WALLET_B.id, ACCOUNT_B));
        await waitFor(() => {
            const last = messaging.getWalletBalances.mock.calls.at(-1);
            expect(last[0]).toBe(WALLET_B.id);
            expect(last[1]).toBe(ACCOUNT_B);
        });
    });
});
