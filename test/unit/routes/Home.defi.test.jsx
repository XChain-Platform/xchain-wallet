// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const WALLET = { id: 'wallet-defi', name: 'DeFi Wallet' };
const ACCOUNT = { id: 'account-defi', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qhomedefiowner000000000000000000000000';

function messaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-defi', address: ADDRESS }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: [{
            action_index: '11', source: ADDRESS, status: 'open', current_status: 'open',
            give_tick: 'PEPE', give_amount: '5', escrow_remaining: '50', block_index: 101,
        }] }),
        getStakesForAddress: vi.fn().mockResolvedValue({ data: [{
            stake_id: 'stake-1', status: 'active', asset: 'XCHAIN', amount: '25', block_index: 102,
        }] }),
        getContractStakesForAddress: vi.fn().mockResolvedValue({ data: [{
            action_index: '13', target_contract_index: '7', tick: 'PEPE', amount: '10', block_index: 103,
        }] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForAddress: vi.fn().mockResolvedValue({ data: [{
            action_index: '14', source: ADDRESS, status: 'valid', give_tick: 'PEPE',
            give_amount: '4', block_index: 104, state: { status: 'open', give_remaining: '3' },
        }] }),
        getSwapsForAddress: vi.fn().mockResolvedValue({ data: [{
            action_index: '15', source: ADDRESS, status: 'valid', swap_status: 'open',
            give_tick: 'PEPE', give_amount: '2', block_index: 105,
        }] }),
    };
}

function mountHome(base) {
    return render(
        <MessagingProvider shell="web" messaging={base}>
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Home DeFi tab data source', () => {
    it('renders every real-wallet position kind returned by messaging', async () => {
        mountHome(messaging());
        fireEvent.click(await screen.findByRole('tab', { name: 'DeFi' }));

        await waitFor(() => expect(document.querySelectorAll('[data-activity-row]')).toHaveLength(5));
        const text = [...document.querySelectorAll('[data-activity-row]')]
            .map((row) => row.textContent).join(' ');
        expect(text).toContain('Stake');
        expect(text).toContain('Dispenser');
        expect(text).toContain('Order');
        expect(text).toContain('Swap');
        expect(text).toContain('locked');
    });

    it('renders sample orders and swaps through the same Home list', async () => {
        const base = messaging();
        markDemoWallet(WALLET.id);
        mountHome(base);
        fireEvent.click(await screen.findByRole('tab', { name: 'DeFi' }));

        await waitFor(() => {
            const text = [...document.querySelectorAll('[data-activity-row]')]
                .map((row) => row.textContent).join(' ');
            expect(text).toContain('Order');
            expect(text).toContain('Swap');
        });
        expect(base.getOrdersForAddress).not.toHaveBeenCalled();
        expect(base.getSwapsForAddress).not.toHaveBeenCalled();
    });
});

