// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';

function pending() {
    return new Promise(() => {});
}

function mount(overrides = {}) {
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
            />
        </MessagingProvider>,
    );
    return { messaging, onOpenContract };
}

afterEach(() => cleanup());

describe('ContractsList states', () => {
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
});
