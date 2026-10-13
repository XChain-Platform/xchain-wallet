// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { clearLastView } from '../../../packages/core/src/shared/utils/lastViewMemory.js';
import {
    readHistoryCache,
    writeHistoryCache,
} from '../../../packages/core/src/shared/utils/historyCache.js';

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

describe('History offline cache', () => {
    it('shows the last wallet-scoped rows offline and disables network actions with a reason', async () => {
        setNavigatorOnline(true);
        const client = messaging([{
            action_index: '12',
            action: 'SEND',
            block_index: 100,
            timestamp: Math.floor(Date.now() / 1000),
            tx_hash: TX_HASH,
            source: ADDRESS,
            destination: 'bc1qrecipient',
            asset: 'XCHAIN',
            quantity: '10',
        }]);
        const online = mountHistory(client);

        await screen.findByRole('button', { name: /Send.*Confirmed/i });
        await waitFor(() => expect(readHistoryCache('wallet-a', 'account-a')).not.toBeNull());
        online.unmount();

        client.getAddressHistory.mockClear();
        setNavigatorOnline(false);
        mountHistory(client);

        expect(await screen.findByText(/Showing the last saved history/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Send.*Confirmed/i })).toBeInTheDocument();
        expect(client.getAddressHistory).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Send.*Confirmed/i }));
        const explorer = screen.getByRole('button', { name: 'XChain' });
        expect(explorer).toBeDisabled();
        expect(explorer).toHaveAttribute('title', 'This action needs a network connection.');

        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });
        await waitFor(() => expect(client.getAddressHistory).toHaveBeenCalledOnce());
    });

    it('clears every account snapshot for only the removed wallet', () => {
        const snapshot = { entries: [], addressesByChain: {}, fetchedAt: Date.now() };
        writeHistoryCache('wallet-a', 'account-a', snapshot);
        writeHistoryCache('wallet-a', 'account-b', snapshot);
        writeHistoryCache('wallet-b', 'account-a', snapshot);

        clearLastView('wallet-a');

        expect(readHistoryCache('wallet-a', 'account-a')).toBeNull();
        expect(readHistoryCache('wallet-a', 'account-b')).toBeNull();
        expect(readHistoryCache('wallet-b', 'account-a')).toEqual(snapshot);
    });

    it('keeps network actions disabled after the history row opens as a page', async () => {
        setNavigatorOnline(false);
        const client = messaging([]);
        render(
            <MessagingProvider shell="web" messaging={client}>
                <ToastHost>
                    <ActionDetail
                        walletId="wallet-a"
                        entry={{
                            key: `${CHAIN}:12:${ADDRESS}`,
                            action: 'SEND',
                            actionIndex: '12',
                            blockIndex: 100,
                            chainId: CHAIN,
                            txHash: TX_HASH,
                            source: ADDRESS,
                            address: ADDRESS,
                            raw: {},
                        }}
                    />
                </ToastHost>
            </MessagingProvider>,
        );

        expect(await screen.findByText(/Showing saved action details/)).toBeInTheDocument();
        const networkButtons = screen.getAllByTitle('This action needs a network connection.');
        expect(networkButtons.length).toBeGreaterThan(1);
        for (const button of networkButtons) expect(button).toBeDisabled();
    });
});
