// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A wallet with no activity at all says so, even with a search typed;
// "No results for these filters" is reserved for a filter that hides
// rows that exist.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';

function mount(props = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi' }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('History empty state', () => {
    it('does not render a late history response from the previous wallet', async () => {
        let resolveOldHistory;
        let resolveNewAddresses;
        const oldHistory = new Promise((resolve) => { resolveOldHistory = resolve; });
        const newAddresses = new Promise((resolve) => { resolveNewAddresses = resolve; });
        const oldAddress = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
        const messaging = {
            getAddressesByChain: vi.fn()
                .mockResolvedValueOnce({ [CHAIN]: [{ address: oldAddress }] })
                .mockImplementationOnce(() => newAddresses),
            getAddressHistory: vi.fn(() => oldHistory),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const tree = (walletId) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <History walletId={walletId} accountId={`${walletId}-account`} />
            </MessagingProvider>
        );
        const view = render(tree('wallet-a'));
        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());

        view.rerender(tree('wallet-b'));
        await act(async () => {
            resolveOldHistory([{
                action_index: '7',
                action: 'SEND',
                timestamp: Math.floor(Date.now() / 1000),
                source: oldAddress,
                destination: 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1',
                asset: 'OLDWALLET',
                quantity: '1',
            }]);
            await Promise.resolve();
        });

        expect(screen.queryByText('OLDWALLET')).toBeNull();
        expect(screen.getByRole('status', { name: 'Loading history' })).toBeTruthy();

        await act(async () => { resolveNewAddresses({}); });
        expect(await screen.findByText('No addresses yet')).toBeTruthy();
    });

    it('says there is no activity yet when the wallet has no history', async () => {
        mount({ onReceive: vi.fn() });
        // History re-renders once the per-chain loads settle; wait on the
        // settled screen rather than the first node that matched.
        await waitFor(() => expect(screen.getByText('No activity yet')).toBeInTheDocument());
        expect(screen.queryByText(/No results for these filters/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
    });

    it('keeps saying so when a search is typed on a wallet with no history', async () => {
        mount();
        await screen.findByText('No activity yet');
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'abc' } });
        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.queryByText(/No results for these filters/)).toBeNull();
        expect(screen.queryByText(/Reset the filters/)).toBeNull();
    });
});
