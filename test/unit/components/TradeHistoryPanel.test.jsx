// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

vi.mock('@xchain-wallet/core/ui', () => ({
    AddressText: ({ address }) => React.createElement('span', null, address),
    StatusMessage: ({ variant, children }) => React.createElement(
        'div',
        { role: variant === 'error' ? 'alert' : 'status' },
        children,
    ),
}));

import { TradeHistoryPanel } from '../../../packages/core/src/shared/components/TradeHistoryPanel.jsx';

const ADDRESSES = [{ address: 'addr-one' }, { address: 'addr-two' }];

function renderPanel(props = {}) {
    return render(
        <TradeHistoryPanel
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            tick1="XCP"
            tick2="BTC"
            {...props}
        />,
    );
}

function historyRow(overrides = {}) {
    return {
        price: '0.0005',
        amount: '2',
        type: 'buy',
        timestamp: 1_700_000_000,
        tx_hash: 'tx-one',
        ...overrides,
    };
}

beforeEach(() => {
    messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': ADDRESSES,
        }),
        getMarketHistory: vi.fn(({ address }) => Promise.resolve({
            rows: [historyRow(address === 'addr-two' ? {
                amount: '3',
                type: 'sell',
                timestamp: 1_700_000_100,
                tx_hash: 'tx-two',
            } : {})],
        })),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('TradeHistoryPanel', () => {
    it('loads every wallet address and opens the selected transaction', async () => {
        const onOpenTx = vi.fn();
        renderPanel({ onOpenTx });

        expect(await screen.findByRole('button', { name: 'Open transaction tx-two' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open transaction tx-one' }))
            .toBeInTheDocument();
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith('wallet-1');
        expect(messaging.getMarketHistory).toHaveBeenCalledTimes(2);
        expect(messaging.getMarketHistory).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            tick1: 'XCP',
            tick2: 'BTC',
            address: 'addr-one',
        });
        expect(screen.getAllByRole('listitem').map((item) => item.textContent))
            .toEqual([
                expect.stringContaining('Selladdr-two'),
                expect.stringContaining('Buyaddr-one'),
            ]);

        fireEvent.click(screen.getByRole('button', { name: 'Open transaction tx-two' }));
        expect(onOpenTx).toHaveBeenCalledWith('tx-two');
    });

    it('disables Refresh while a manual reload is pending', async () => {
        renderPanel();
        await waitFor(() => expect(messaging.getMarketHistory).toHaveBeenCalledTimes(2));

        let resolveReload;
        const reload = new Promise((resolve) => {
            resolveReload = resolve;
        });
        messaging.getMarketHistory = vi.fn(() => reload);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

        expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
        resolveReload({ rows: [] });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    });

    it('reports a load error when every address request fails', async () => {
        messaging.getMarketHistory = vi.fn().mockRejectedValue(new Error('offline'));
        renderPanel();

        expect(await screen.findByText(/Couldn't load your trade history\./))
            .toBeInTheDocument();
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();
    });

    it('keeps available history when only one address request fails', async () => {
        messaging.getMarketHistory = vi.fn(({ address }) => (address === 'addr-one'
            ? Promise.reject(new Error('offline'))
            : Promise.resolve({ rows: [historyRow({ tx_hash: 'tx-two' })] })));
        renderPanel();

        expect(await screen.findByText('addr-two')).toBeInTheDocument();
        expect(screen.queryByText(/Couldn't load your trade history\./)).toBeNull();
        expect(screen.queryByText('No trades on this market yet.')).toBeNull();
    });
});
