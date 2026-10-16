// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';

function pending() {
    return new Promise(() => {});
}

function mount(overrides = {}, props = {}) {
    const onOpenContract = vi.fn();
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getContractsForSource: vi.fn().mockResolvedValue({ data: [] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractsBrowseAll: vi.fn().mockResolvedValue({ data: [] }),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ContractsList
                walletId="wallet-1"
                onBack={() => {}}
                onOpenContract={onOpenContract}
                {...props}
            />
        </MessagingProvider>,
    );
    return { messaging, onOpenContract };
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    localStorage.clear();
});

describe('ContractsList states', () => {
    it('offers Publish contract once, in the toolbar, with a button-free empty state', async () => {
        mount({}, { onDeploy: vi.fn() });

        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /Publish contract/ })).toHaveLength(1);
        expect(screen.getByRole('button', { name: '+ Publish contract' })).toBeInTheDocument();
    });

    it('shows loading while wallet addresses resolve', () => {
        mount({ getAddressesByChain: vi.fn(() => pending()) });

        expect(screen.getByRole('heading', { name: 'Contracts' })).toBeInTheDocument();
        expect(screen.getByRole('status', { name: 'Loading contracts' })).toBeInTheDocument();
        expect(screen.queryByText('No supported address')).toBeNull();
    });

    it('shows the empty-wallet state when no supported address exists', async () => {
        mount({ getAddressesByChain: vi.fn().mockResolvedValue({}) });

        expect(await screen.findByRole('heading', { name: 'No supported address' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Filter contracts')).toBeNull();
    });

    it('shows address failures and offers a retry', async () => {
        mount({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Wallet unavailable')) });

        // The raw error stays out of the UI; the screen shows fixed recovery copy.
        expect(await screen.findByText('Could not load addresses. Try again.')).toBeInTheDocument();
        expect(screen.queryByText('Wallet unavailable')).toBeNull();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
        expect(screen.queryByText('No supported address')).toBeNull();
    });

    it('renders and opens a published contract from the main state', async () => {
        const { onOpenContract } = mount({
            getContractsForSource: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 7,
                    source: ADDRESS,
                    status: 'valid',
                    meta_name: 'Escrow',
                    meta_version: '1.0.0',
                }],
            }),
        });

        const rows = await screen.findAllByRole('button', { name: /Escrow/ });
        fireEvent.click(rows[0]);
        expect(onOpenContract).toHaveBeenCalledWith(CHAIN, '7');
        expect(screen.getByLabelText('Filter contracts')).toBeInTheDocument();
    });

    it('settles a demo wallet to its empty sections without asking an explorer', async () => {
        markDemoWallet('demo-wallet');
        const { messaging } = mount({}, { walletId: 'demo-wallet' });

        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
        expect(screen.getByText('No contract interactions')).toBeInTheDocument();
        expect(screen.getByText('No indexed contracts')).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: /Loading contracts/ })).toBeNull();
        expect(messaging.getContractsForSource).not.toHaveBeenCalled();
        expect(messaging.getDepositsForAddress).not.toHaveBeenCalled();
        expect(messaging.getContractsBrowseAll).not.toHaveBeenCalled();
    });
});
