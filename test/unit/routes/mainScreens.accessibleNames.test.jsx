// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { AlertsRoute } from '../../../packages/core/src/shared/routes/AlertsRoute.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const RAW_I18N_KEY = /\b(?:(?:common|home|send|receive|history|pending|scan|settings)\.[a-z][\w-]*(?:\.[a-z][\w-]*)*|[a-z][\w-]*(?:\.[a-z][\w-]*){2,})\b/;
const BROKEN_COPY = /\b(?:undefined|null|NaN)\b|\[object Object\]|\{[a-zA-Z][^{}]*\}/;

function expectEveryButtonNamed(container) {
    const unnamed = Array.from(container.querySelectorAll('button'))
        .filter((button) => computeAccessibleName(button).trim() === '')
        .map((button) => button.outerHTML);
    expect(unnamed).toEqual([]);
}

function expectVisibleCopyResolved(container) {
    const visibleCopy = [
        container.textContent,
        ...Array.from(container.querySelectorAll('input[placeholder], textarea[placeholder]'))
            .map((field) => field.getAttribute('placeholder')),
        ...Array.from(container.querySelectorAll('input[type="button"], input[type="submit"]'))
            .map((button) => button.value),
    ].join('\n');

    expect(visibleCopy).not.toMatch(RAW_I18N_KEY);
    expect(visibleCopy).not.toMatch(BROKEN_COPY);
}

afterEach(cleanup);

describe('main screen rendering', () => {
    it('names every button and resolves visible copy on Home', async () => {
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
        expectVisibleCopyResolved(view.container);
    });

    it('names every button and resolves visible copy on History', async () => {
        const onReceive = vi.fn();
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
                <History
                    walletId="wallet"
                    accountId="account"
                    onBack={() => {}}
                    onReceive={onReceive}
                />
            </MessagingProvider>,
        );

        await screen.findByText('No activity yet');
        expect(screen.getByText('Activity appears here after you send or receive on a selected chain.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Start receiving' }));
        expect(onReceive).toHaveBeenCalledOnce();
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('offers the first action from an empty Markets screen', async () => {
        const onChangeAsset = vi.fn();
        const messaging = {
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketsList
                    walletId="wallet"
                    selectedAsset={null}
                    onChangeAsset={onChangeAsset}
                    onOpenMarket={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(screen.getByText('Choose a coin or token to view its markets.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Choose an asset' }));
        expect(onChangeAsset).toHaveBeenCalledOnce();
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('offers the first action from an empty Contacts screen', async () => {
        const messaging = {
            listContacts: vi.fn().mockResolvedValue([]),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <ContactsList walletId="wallet" onBack={() => {}} />
                </ToastHost>
            </MessagingProvider>,
        );

        expect(await screen.findByText('Saved contacts label addresses across the inbox and history.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Create first contact' }));
        expect(screen.getByRole('heading', { name: 'New contact' })).toBeTruthy();
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('explains empty Alerts and opens notification settings', () => {
        const view = render(
            <MessagingProvider shell="web" messaging={{}}>
                <AlertsRoute
                    onBack={() => {}}
                    walletId="wallet"
                    alerts={[]}
                />
            </MessagingProvider>,
        );

        expect(screen.getByText('Wallet activity, security, and price changes appear here.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Manage notifications' }));
        expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('names every button and resolves visible copy on Send', async () => {
        const balances = {
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address', address: ADDRESS, source: 'hd' }],
            }),
            getAddressBalances: vi.fn().mockResolvedValue(balances),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{ address: ADDRESS, balances, error: null }],
            }),
            getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
            getAddressHistory: vi.fn().mockResolvedValue([]),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Send walletId="wallet" accountId="account" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText(/LTC available/);
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('names every button and resolves visible copy on Receive', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getNewestAddress: vi.fn().mockResolvedValue(null),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Receive walletId="wallet" accountId="account" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByText('No addresses yet');
        expectEveryButtonNamed(view.container);
        expectVisibleCopyResolved(view.container);
    });

    it('names every button and resolves visible copy on Settings', () => {
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
        expectVisibleCopyResolved(view.container);
    });
});
