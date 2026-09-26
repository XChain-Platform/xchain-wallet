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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    const messaging = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };

    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Home
                activeWalletId={WALLET.id}
                activeAccountId={ACCOUNT.id}
                onHistory={onHistory}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Home Activity tab', () => {
    it('plainly marks the non-demo feed unbuilt and opens History', async () => {
        const onHistory = vi.fn();
        mountHome(onHistory);

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));

        expect(screen.getByText('Activity feed not built yet')).toBeTruthy();
        expect(screen.queryByText('Recent activity')).toBeNull();

        const openHistory = screen.getByRole('button', { name: 'Open History' });
        expect(openHistory.disabled).toBe(false);
        fireEvent.click(openHistory);
        expect(onHistory).toHaveBeenCalledTimes(1);
    });

    it('keeps demo wallets on their synthesized activity list', async () => {
        const onHistory = vi.fn();
        markDemoWallet(WALLET.id);
        mountHome(onHistory);

        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));

        expect(screen.getByText('No activity yet')).toBeTruthy();
        expect(screen.queryByText('Activity feed not built yet')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open History' })).toBeNull();
        expect(onHistory).not.toHaveBeenCalled();
    });
});
