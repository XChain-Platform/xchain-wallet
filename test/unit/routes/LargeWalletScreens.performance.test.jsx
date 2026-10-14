// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { slowTimeout } from '../../helpers/testEnvSpeed.js';

const WALLET = { id: 'large-wallet', name: 'Large Wallet', format: 'bip39' };
const ACCOUNT = { id: 'large-account', index: 0, walletId: WALLET.id };
const CHAIN = 'litecoin-regtest';
const TOKEN_COUNT = 500;
const HISTORY_COUNT = 5_000;
const ADDRESS_COUNT = 300;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const addresses = Array.from({ length: ADDRESS_COUNT }, (_, index) => ({
    id: `address-${index}`,
    address: `rltc1qlargewallet${String(index).padStart(4, '0')}xxxxxxxxxxxxxxxxxxxx`,
    label: `Scale address ${String(index).padStart(3, '0')}`,
    source: 'hd',
    role: 'receive',
    accountId: ACCOUNT.id,
}));

const tokens = Array.from({ length: TOKEN_COUNT }, (_, index) => ({
    tick: `S${String(index).padStart(3, '0')}`,
    displayName: `Scale token ${String(index).padStart(3, '0')}`,
    quantity: String(index + 1),
    divisibility: 0,
    fiatRate: 1,
}));

const historyItems = Array.from({ length: HISTORY_COUNT }, (_, index) => ({
    action: 'SEND',
    action_index: String(HISTORY_COUNT - index),
    block_index: 500_000 - index,
    timestamp: NOW_SECONDS - index,
    tx_hash: `large-wallet-history-${index}`,
    status: 'valid',
    details: {
        action_format: 0,
        source: addresses[0].address,
        destination: `rltc1qhistorydestination${String(index).padStart(4, '0')}`,
        tick: 'LTC',
        amount: '1',
    },
}));

const balances = {
    [CHAIN]: [{
        address: addresses[0].address,
        balances: {
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8, fiatRate: 1 },
            tokens,
        },
    }],
};

function largeWalletMessaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getSettings: vi.fn().mockResolvedValue({
            activeNetwork: 'regtest',
            fiatCurrency: 'USD',
            verifyProofs: false,
        }),
        getWalletBalances: vi.fn().mockResolvedValue(balances),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: addresses }),
        getAddressHistory: vi.fn(({ address }) => Promise.resolve(
            address === addresses[0].address ? historyItems : [],
        )),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        listContacts: vi.fn().mockResolvedValue([]),
    };
}

function withProviders(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

beforeEach(() => {
    globalThis.localStorage?.clear();
    globalThis.localStorage?.setItem('xc:historyGroupingMode', 'flat');
});

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear();
});

describe('large wallet screens', () => {
    it.skip('Home renders all 500 token rows; enable after Home paginates or virtualises them', async () => {
        const messaging = largeWalletMessaging();
        const tree = (tokenQuery = '') => withProviders(messaging, (
            <Home
                activeWalletId={WALLET.id}
                activeAccountId={ACCOUNT.id}
                tokenQuery={tokenQuery}
            />
        ));
        const startedAt = performance.now();
        const view = render(tree());

        fireEvent.click(await screen.findByRole('tab', { name: 'Tokens' }));
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-balance-key]').length).toBeGreaterThan(0);
        });

        expect(performance.now() - startedAt).toBeLessThan(slowTimeout(2_500));
        expect(view.container.querySelectorAll('[data-balance-key]').length).toBeLessThan(TOKEN_COUNT);

        view.rerender(tree('Scale token 499'));
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-balance-key]')).toHaveLength(1);
        });
        expect(screen.getByText('S499')).toBeInTheDocument();
    });

    it('paginates 5,000 History items, filters the complete set, and renders within its jsdom budget', async () => {
        const messaging = largeWalletMessaging();
        const startedAt = performance.now();
        const view = render(withProviders(messaging, (
            <History walletId={WALLET.id} accountId={ACCOUNT.id} />
        )));

        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(100);
        }, { timeout: 10_000 });

        expect(performance.now() - startedAt).toBeLessThan(slowTimeout(3_500));
        expect(screen.getByText('100 of 5,000 history items shown')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'rltc1qhistorydestination4999' },
        });
        await waitFor(() => {
            const rows = view.container.querySelectorAll('[data-history-key]');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toHaveAttribute(
                'data-history-key',
                `${CHAIN}:1:${addresses[0].address}`,
            );
        });
        expect(screen.queryByRole('button', { name: 'Show more history' })).toBeNull();
    });

    it('paginates 300 Addresses, filters the complete set, and renders within its jsdom budget', async () => {
        const messaging = largeWalletMessaging();
        const startedAt = performance.now();
        const view = render(withProviders(messaging, (
            <AddressList
                walletId={WALLET.id}
                accountId={ACCOUNT.id}
                onBack={() => {}}
            />
        )));

        const list = await screen.findByRole('list', { name: 'Addresses' });
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(100));

        expect(performance.now() - startedAt).toBeLessThan(slowTimeout(1_500));
        expect(screen.getByText('100 of 300 addresses shown')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('textbox', { name: 'Search addresses' }), {
            target: { value: 'Scale address 299' },
        });
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(1));
        expect(screen.getByRole('button', { name: `View address ${addresses[299].address}` }))
            .toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show more addresses' })).toBeNull();
    });
});
