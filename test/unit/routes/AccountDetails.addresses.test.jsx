// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G131: a hardware wallet's accounts live on the same pages as a local
// wallet's. My Accounts lists one row per account number (never one per
// network), and Account Details' Addresses tab shows the account's addresses
// in one list, for either wallet type.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';

const HW = { id: 'hw-1', name: 'My Ledger', format: 'hardware', origin: 'connected-hardware' };
const LOCAL = { id: 'w-1', name: 'Everyday', format: 'bip39', origin: 'created' };
const SIGNER = { id: 'sig-1', walletId: HW.id, kind: 'ledger', vendor: 'ledger', model: 'nanoX' };

// What addHardwareWallet writes for a three-network setup with two accounts:
// one Account per account number, one Address per network naming it.
const HW_ACCOUNTS = [
    { id: 'hw-a1', walletId: HW.id, index: 0, name: 'Account 1' },
    { id: 'hw-a2', walletId: HW.id, index: 1, name: 'Account 2' },
];
const hwAddress = (accountId, chain, address, path) => ({
    id: `${accountId}-${chain}`, accountId, address, derivationPath: path, source: 'ledger', signerId: SIGNER.id, label: `${chain} Address #1`, chain,
});
const HW_BY_CHAIN = {
    'bitcoin-mainnet': [
        hwAddress('hw-a1', 'BTC', 'bc1qhardwareaccountonebitcoinaddress0000', "m/84'/0'/0'/0/0"),
        hwAddress('hw-a2', 'BTC', 'bc1qhardwareaccounttwobitcoinaddress0000', "m/84'/0'/1'/0/0"),
    ],
    'litecoin-mainnet': [
        hwAddress('hw-a1', 'LTC', 'ltc1qhardwareaccountonelitecoinaddress00', "m/84'/2'/0'/0/0"),
        hwAddress('hw-a2', 'LTC', 'ltc1qhardwareaccounttwolitecoinaddress00', "m/84'/2'/1'/0/0"),
    ],
    'dogecoin-mainnet': [
        hwAddress('hw-a1', 'DOGE', 'DHardwareAccountOneDogecoinAddress000', "m/44'/3'/0'/0/0"),
        hwAddress('hw-a2', 'DOGE', 'DHardwareAccountTwoDogecoinAddress000', "m/44'/3'/1'/0/0"),
    ],
};

function messagingFor(wallet, accounts, byChain) {
    return {
        listWallets: vi.fn(async () => [wallet]),
        listAccounts: vi.fn(async () => accounts),
        listSigners: vi.fn(async () => (wallet.format === 'hardware' ? [SIGNER] : [])),
        getSettings: vi.fn(async () => ({ activeNetwork: 'mainnet' })),
        getAddressesByChain: vi.fn(async () => byChain),
        activateChainRequest: vi.fn(async () => ({})),
    };
}

async function flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('a hardware wallet in My Accounts', () => {
    it('lists one row per account number, as for a local wallet', async () => {
        const messaging = messagingFor(HW, HW_ACCOUNTS, HW_BY_CHAIN);
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <AccountPicker walletId={HW.id} activeAccountId="hw-a1" onSwitch={() => {}} onAddAccount={() => {}} onBack={() => {}} />
                </MessagingProvider>,
            );
            await flush();
        });
        const list = screen.getByRole('list', { name: 'My Accounts' });
        const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
        expect(rows).toEqual([
            expect.stringContaining('Account 1'),
            expect.stringContaining('Account 2'),
        ]);
        expect(rows.join(' ')).not.toMatch(/Bitcoin|Litecoin|Dogecoin/);
        // Its addresses still find it, through the shared search.
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith(HW.id);
    });
});

describe('Account Details, Addresses tab', () => {
    async function renderDetails(messaging, walletId, accountId) {
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <AccountDetails walletId={walletId} accountId={accountId} activeAccountId={accountId} onBack={() => {}} onRename={() => {}} />
                </MessagingProvider>,
            );
            await flush();
        });
    }

    it('puts Addresses between Actions and Details, as View Contact does', async () => {
        await renderDetails(messagingFor(HW, HW_ACCOUNTS, HW_BY_CHAIN), HW.id, 'hw-a2');
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Actions', 'Addresses', 'Details']);
    });

    // jsdom has no layout, so the fit itself (G99) is AddressText's own
    // contract; this pins that each row draws its address through it.
    it('shows one flat network-ordered list for a hardware account, its own only, each through AddressText', async () => {
        const messaging = messagingFor(HW, HW_ACCOUNTS, HW_BY_CHAIN);
        await renderDetails(messaging, HW.id, 'hw-a2');
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
            await flush();
        });
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith(HW.id, 'hw-a2');
        const list = screen.getByRole('list', { name: 'Addresses' });
        const rows = within(list).getAllByRole('listitem').map((item) => item.firstElementChild);
        expect(rows.map((row) => row.getAttribute('data-chain-id'))).toEqual([
            'bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet',
        ]);
        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
        expect(rows[0].querySelector('[aria-label="bc1qhardwareaccounttwobitcoinaddress0000"]')).not.toBeNull();
        expect(rows[1].querySelector('[aria-label="DHardwareAccountTwoDogecoinAddress000"]')).not.toBeNull();
        expect(rows[2].querySelector('[aria-label="ltc1qhardwareaccounttwolitecoinaddress00"]')).not.toBeNull();
        expect(document.body.innerHTML).not.toContain('accountone');
        // Every network is already there, so nothing to add.
        expect(screen.queryByRole('heading', { name: 'Add a Network' })).toBeNull();
    });

    it('shows a local account\'s addresses by network on the same tab', async () => {
        const accounts = [{ id: 'l-a1', walletId: LOCAL.id, index: 0, name: 'Main' }];
        const byChain = {
            'bitcoin-mainnet': [
                { id: 'b2', accountId: 'l-a1', address: 'bc1qlocalsecond', derivationPath: "m/84'/0'/0'/0/1", label: 'Savings', source: 'hd' },
                { id: 'b1', accountId: 'l-a1', address: 'bc1qlocalfirst', derivationPath: "m/84'/0'/0'/0/0", label: 'BTC Address #1', source: 'hd' },
            ],
        };
        await renderDetails(messagingFor(LOCAL, accounts, byChain), LOCAL.id, 'l-a1');
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
            await flush();
        });
        const items = within(screen.getByRole('list', { name: 'Addresses' })).getAllByRole('listitem');
        expect(items.map((li) => li.textContent)).toEqual([
            expect.stringContaining('BTC Address #1'),
            expect.stringContaining('Savings'),
        ]);
    });

    // One bulk read of the account's addresses, whatever their number.
    it.each([1, 40])('reads the addresses once for %i addresses on a network', async (count) => {
        const accounts = [{ id: 'l-a1', walletId: LOCAL.id, index: 0, name: 'Main' }];
        const byChain = {
            'bitcoin-mainnet': Array.from({ length: count }, (_, i) => ({
                id: `b${i}`, accountId: 'l-a1', address: `bc1qlocal${i}`, derivationPath: `m/84'/0'/0'/0/${i}`, source: 'hd',
            })),
        };
        const messaging = messagingFor(LOCAL, accounts, byChain);
        await renderDetails(messaging, LOCAL.id, 'l-a1');
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
            await flush();
        });
        expect(within(screen.getByRole('list', { name: 'Addresses' })).getAllByRole('listitem')).toHaveLength(count);
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(1);
        expect(messaging.listAccounts).toHaveBeenCalledTimes(1);
        expect(messaging.listWallets).toHaveBeenCalledTimes(1);
        expect(messaging.listSigners).not.toHaveBeenCalled();
    });

    it('says so when the account has no address yet', async () => {
        await renderDetails(messagingFor(LOCAL, [{ id: 'l-a1', walletId: LOCAL.id, index: 0 }], {}), LOCAL.id, 'l-a1');
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
            await flush();
        });
        expect(screen.getByText('No addresses yet')).toBeInTheDocument();
    });
});
