// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keep an activity-free wallet focused on its empty state, even when the
// route opens with a search scope. "No results for these filters" remains
// reserved for a filter that hides rows that exist.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import {
    clearHistoryCacheForWallet,
    writeHistoryCache,
} from '../../../packages/core/src/shared/utils/historyCache.js';

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
    return messaging;
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    clearHistoryCacheForWallet('desktop-wallet');
});

describe('History empty state', () => {
    it('keeps desktop on skeleton rows until the first history page replaces an empty cache', async () => {
        let resolveHistory;
        const historyPage = new Promise((resolve) => { resolveHistory = resolve; });
        writeHistoryCache('desktop-wallet', 'desktop-account', {
            entries: [],
            addressesByChain: { [CHAIN]: [{ address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi' }] },
            fetchedAt: Date.now(),
        });
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi' }],
            }),
            getAddressHistory: vi.fn(() => historyPage),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        render(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <History walletId="desktop-wallet" accountId="desktop-account" />
            </MessagingProvider>,
        );

        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading history' })).toBeInTheDocument();
        expect(screen.queryByText('No activity yet')).toBeNull();

        await act(async () => resolveHistory([{
            action_index: '7',
            block_index: 100,
            action: 'SEND',
            timestamp: Math.floor(Date.now() / 1000),
            tx_hash: 'desktop-loading-proof',
            details: {
                source: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi',
                destination: 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1',
                tick: 'LTC',
                amount: '1',
            },
        }]));

        expect(await screen.findByRole('button', { name: /Send.*Confirmed/i })).toBeInTheDocument();
        expect(screen.queryByRole('status', { name: 'Loading history' })).toBeNull();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('loads chain history for a real wallet while another id is marked as demo', async () => {
        markDemoWallet('demo-wallet');
        const messaging = mount();

        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        expect(messaging.getAddressHistory).toHaveBeenCalledWith({
            chainId: CHAIN,
            address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi',
        });
    });

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
        expect(screen.queryByRole('group', { name: 'History filters' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
        expect(screen.queryByText(/Last synced/)).toBeNull();
    });

    it('keeps the empty state clear of filters when an initial search has no history to search', async () => {
        mount({ initialSearchQuery: 'abc' });
        await screen.findByText('No activity yet');
        expect(screen.queryByLabelText('Search history')).toBeNull();
        expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
        expect(screen.queryByText(/No results for these filters/)).toBeNull();
        expect(screen.queryByText(/Reset the filters/)).toBeNull();
    });
});
