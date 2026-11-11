// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
    clearDemoWalletId,
    markDemoWallet,
} from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };

function mountHome(onHistory) {
    const address = 'bc1qsamplehomeactivity0000000000000000000000';
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ id: 'address-a', address }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressHistory: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };

    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Home
                activeWalletId={WALLET.id}
                activeAccountId={ACCOUNT.id}
                onHistory={onHistory}
            />
        </MessagingProvider>,
    );
    return { ...view, messaging };
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Home Activity tab', () => {
    it('shows an empty Activity tab for a real wallet with no history', async () => {
        const onHistory = vi.fn();
        mountHome(onHistory);

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));

        await waitFor(() => expect(screen.getByText('No activity yet')).toBeTruthy());
        expect(screen.queryByText('Your activity is in History')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open History' })).toBeNull();
        expect(screen.getByRole('button', { name: 'See all activity' })).toBeTruthy();
        expect(onHistory).not.toHaveBeenCalled();
    });

    it('loads demo activity through the standard recent activity list', async () => {
        const onHistory = vi.fn();
        markDemoWallet(WALLET.id);
        const { messaging } = mountHome(onHistory);

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));

        expect(await screen.findByRole('list', { name: 'Recent activity' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: /Send|Receive|Issue|Mint|Dispenser|Order|Swap/i }).length)
            .toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'See all activity' })).toBeTruthy();
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
        expect(onHistory).not.toHaveBeenCalled();
    });
});
