// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';

function pending() {
    return new Promise(() => {});
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
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

    it('renders a synchronous messaging failure instead of throwing from the effect', async () => {
        mount(vi.fn(() => { throw new Error('Messaging is unavailable'); }));

        expect(await screen.findByText('Messaging is unavailable')).toBeInTheDocument();
    });

    it('clears the previous wallet accounts while the next wallet loads', async () => {
        const next = deferred();
        const listCoSignerAccounts = vi.fn(({ walletId }) => walletId === 'wallet-1'
            ? Promise.resolve([{
                id: 'account-1',
                name: 'First wallet agent',
                chainId: 'bitcoin-mainnet',
                aggregateAddress: 'bc1pfirst',
                enabled: true,
            }])
            : next.promise);
        const props = { onBack: () => {}, onOpen: () => {}, onProvision: () => {} };
        const view = render(
            <MessagingProvider shell="web" messaging={{ listCoSignerAccounts }}>
                <CoSignerAccountList walletId="wallet-1" {...props} />
            </MessagingProvider>,
        );
        expect(await screen.findByText('First wallet agent')).toBeInTheDocument();

        view.rerender(
            <MessagingProvider shell="web" messaging={{ listCoSignerAccounts }}>
                <CoSignerAccountList walletId="wallet-2" {...props} />
            </MessagingProvider>,
        );
        expect(screen.queryByText('First wallet agent')).toBeNull();
        expect(screen.getByText(/Loading/)).toBeInTheDocument();

        await act(async () => next.resolve([]));
        expect(await screen.findByText('No agent accounts yet')).toBeInTheDocument();
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
