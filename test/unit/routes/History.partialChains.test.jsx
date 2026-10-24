// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { readHistoryCache } from '../../../packages/core/src/shared/utils/historyCache.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TX_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function messaging(history) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        replaceTx: vi.fn(),
    };
}

function mountHistory(client) {
    return render(
        <MessagingProvider shell="web" messaging={client}>
            <ToastHost>
                <History walletId="wallet-a" accountId="account-a" />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    globalThis.localStorage.clear();
    delete navigator.onLine;
});

describe('History with one network unreadable', () => {
    const DOGE = 'dogecoin-mainnet';
    const DOGE_ADDRESS = 'D8vFz4p1L37jdg4y5r3zarvary0c5xw7k';
    const row = {
        action_index: '12',
        action: 'SEND',
        block_index: 100,
        timestamp: Math.floor(Date.now() / 1000),
        tx_hash: TX_HASH,
        source: ADDRESS,
        destination: 'bc1qrecipient',
        asset: 'XCHAIN',
        quantity: '10',
    };

    function twoChainClient(dogeFails) {
        const client = messaging([row]);
        client.getAddressesByChain.mockResolvedValue({
            [CHAIN]: [{ address: ADDRESS }],
            [DOGE]: [{ address: DOGE_ADDRESS }],
        });
        client.getAddressHistory.mockImplementation(async ({ chainId }) => {
            if (chainId === DOGE && dogeFails) throw new Error('doge explorer down');
            return chainId === DOGE ? [] : [row];
        });
        return client;
    }

    it('shows the rows that loaded and names the chain that could not be read', async () => {
        setNavigatorOnline(true);
        mountHistory(twoChainClient(true));

        expect(await screen.findByRole('button', { name: /Send.*Confirmed/i })).toBeInTheDocument();
        expect(screen.getByText(/History for .*Dogecoin.* couldn't be read/i)).toBeInTheDocument();
        expect(screen.queryByText(/Could not load history/)).toBeNull();
        expect(readHistoryCache('wallet-a', 'account-a')).toBeNull();
    });

    it('shows no chain notice when every network answers', async () => {
        setNavigatorOnline(true);
        mountHistory(twoChainClient(false));

        await screen.findByRole('button', { name: /Send.*Confirmed/i });
        expect(screen.queryByText(/couldn't be read/)).toBeNull();
    });

    it('still reports a failed load when every network fails', async () => {
        setNavigatorOnline(true);
        const client = twoChainClient(true);
        client.getAddressHistory.mockRejectedValue(new Error('all down'));
        mountHistory(client);

        expect(await screen.findByText(/Could not load history/)).toBeInTheDocument();
    });
});
