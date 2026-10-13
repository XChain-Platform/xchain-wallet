// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function expectEveryButtonNamed(container) {
    const unnamed = Array.from(container.querySelectorAll('button'))
        .filter((button) => computeAccessibleName(button).trim() === '')
        .map((button) => button.outerHTML);
    expect(unnamed).toEqual([]);
}

afterEach(cleanup);

describe('main screen button names', () => {
    it('names every button on Home', async () => {
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet', name: 'Main wallet' }]),
            listAccounts: vi.fn().mockResolvedValue([{ id: 'account', index: 0 }]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Home
                    activeWalletId="wallet"
                    activeAccountId="account"
                    onSend={() => {}}
                    onReceive={() => {}}
                    onExchange={() => {}}
                    onActions={() => {}}
                    onOpenSettings={() => {}}
                    onCommandPalette={() => {}}
                />
            </MessagingProvider>,
        );

        await waitFor(() => expect(screen.queryByLabelText('Loading balances')).toBeNull());
        expectEveryButtonNamed(view.container);
    });

    it('names every button on History', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <History walletId="wallet" accountId="account" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText('No activity yet');
        expectEveryButtonNamed(view.container);
    });

    it('names every button on Settings', () => {
        const messaging = {
            getSettings: () => new Promise(() => {}),
            listConnectedSites: vi.fn().mockResolvedValue([]),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Settings
                    onBack={() => {}}
                    activeWallet={{ id: 'wallet', name: 'Main wallet' }}
                    activeAccount={{ id: 'account', index: 0, name: 'Primary' }}
                    onOpenWalletPicker={() => {}}
                    onOpenAccountPicker={() => {}}
                />
            </MessagingProvider>,
        );

        expectEveryButtonNamed(view.container);
    });
});
