// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';

function pending() {
    return new Promise(() => {});
}

function mount(listCoSignerAccounts, props = {}) {
    const onOpen = vi.fn();
    const onProvision = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={{ listCoSignerAccounts }}>
            <CoSignerAccountList
                walletId="wallet-1"
                onBack={() => {}}
                onOpen={onOpen}
                onProvision={onProvision}
                {...props}
            />
        </MessagingProvider>,
    );
    return { onOpen, onProvision };
}

afterEach(() => cleanup());

describe('CoSignerAccountList states', () => {
    it('shows loading while agent accounts resolve', () => {
        mount(vi.fn(() => pending()));

        expect(screen.getByRole('heading', { name: 'Agent accounts' })).toBeInTheDocument();
        expect(screen.getByText(/Loading/)).toBeInTheDocument();
        expect(screen.queryByText('No agent accounts yet')).toBeNull();
    });

    it('offers provisioning from the empty state', async () => {
        const { onProvision } = mount(vi.fn().mockResolvedValue([]));

        expect(await screen.findByRole('heading', { name: 'No agent accounts yet' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'New agent account' }));
        expect(onProvision).toHaveBeenCalledTimes(1);
    });

    it('shows load failures without the empty state', async () => {
        mount(vi.fn().mockRejectedValue(new Error('Account service unavailable')));

        expect(await screen.findByText('Account service unavailable')).toBeInTheDocument();
        expect(screen.queryByText('No agent accounts yet')).toBeNull();
    });

    it('renders and opens an account from the main state', async () => {
        const { onOpen } = mount(vi.fn().mockResolvedValue([{
            id: 'account-1',
            name: 'Build agent',
            chainId: 'bitcoin-mainnet',
            aggregateAddress: 'bc1pagentaccount',
            enabled: true,
        }]));

        const name = await screen.findByText('Build agent');
        expect(screen.getByText('Active')).toBeInTheDocument();
        fireEvent.click(name.closest('button'));
        expect(onOpen).toHaveBeenCalledWith('account-1');
    });
});
