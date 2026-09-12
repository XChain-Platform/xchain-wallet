// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The delete confirm on Addresses used to say only that an IMPORTED key is
// gone, which read as "a derived one is safe" while Generate could not bring
// a deleted interior index back. The dialog now names what the address
// holds (from the balances the list already loaded), whether it runs a
// dispenser, whether it is the active or only address on its chain, and how
// a derived key comes back.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList, deleteAddressMessage } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';

const FUNDED = 'bcrt1qfunded000000000000000000000000000000000';
const DISPENSER = 'bcrt1qdispenser0000000000000000000000000000';
const PLAIN = 'bcrt1qplain0000000000000000000000000000000000';
const IMPORTED = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';

function hd(id, address, index, extra = {}) {
    return {
        id,
        address,
        label: `BTC Address #${index + 1}`,
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: `m/84'/1'/0'/0/${index}`,
        role: 'receive',
        accountId: ACCOUNT.id,
        ...extra,
    };
}

const ADDRESSES = {
    [CHAIN]: [
        hd('addr-funded', FUNDED, 0),
        hd('addr-disp', DISPENSER, 1, { role: 'dispenser', label: 'BTC Dispenser #1' }),
        hd('addr-plain', PLAIN, 2),
        {
            id: 'addr-imp',
            address: IMPORTED,
            label: 'WIF vector',
            source: 'imported-wif',
            addressType: 'p2pkh',
            derivationPath: null,
            role: 'receive',
            accountId: null,
        },
    ],
};

const BALANCES = {
    [CHAIN]: [
        {
            address: FUNDED,
            balances: {
                native: { tick: 'BTC', quantity: '150000000', divisibility: 8 },
                tokens: [{ tick: 'XCP', quantity: '1000', divisibility: 0 }],
            },
        },
        {
            address: DISPENSER,
            balances: { native: { tick: 'BTC', quantity: '0', divisibility: 8 }, tokens: [] },
        },
        {
            address: PLAIN,
            balances: { native: { tick: 'BTC', quantity: '0', divisibility: 8 }, tokens: [] },
        },
    ],
};

afterEach(() => cleanup());

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-funded', address: FUNDED } }),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        deleteAddress: vi.fn().mockResolvedValue({ ok: true }),
        ...overrides,
    };
}

// Open the detail screen for one address, press Delete, return the dialog.
// `balanceText` is what the detail's Balance field must show first, so the
// dialog is built after the cached balance read has landed, not before.
async function openDeleteDialog(address, messaging = messagingWith(), balanceText = /BTC/) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: `View address ${address}` }));
    await vi.waitFor(() => {
        expect(screen.getByTestId('address-detail-balance').textContent).toMatch(balanceText);
    });
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    return screen.findByRole('dialog', { name: /Delete this address\?/ });
}

describe('Addresses delete confirm names what the address holds', () => {
    it('a funded derived address: native and token balances, active, and the re-derive path', async () => {
        const dialog = await openDeleteDialog(FUNDED, messagingWith(), /1\.50000000 BTC/);
        const text = dialog.textContent;
        expect(text).toMatch(/It holds 1\.50000000 BTC, 1,000 XCP\./);
        expect(text).toMatch(/active Bitcoin address/);
        expect(text).toMatch(/Generate on Bitcoin re-derives the lowest missing address/);
        expect(text).not.toMatch(/imported key is gone/);
    });

    it('a dispenser address names the dispenser', async () => {
        const dialog = await openDeleteDialog(DISPENSER);
        const text = dialog.textContent;
        expect(text).toMatch(/It runs a dispenser/);
        expect(text).not.toMatch(/It holds/);
        expect(text).toMatch(/re-derives the lowest missing address/);
    });

    it('an unfunded plain derived address states only the re-derive path', async () => {
        const dialog = await openDeleteDialog(PLAIN);
        const text = dialog.textContent;
        expect(text).not.toMatch(/It holds/);
        expect(text).not.toMatch(/dispenser/);
        expect(text).not.toMatch(/active/);
        expect(text).toMatch(/not lost: Add address > Generate on Bitcoin re-derives the lowest missing address/);
        expect(text).not.toMatch(/imported key is gone/);
    });

    it('an imported key keeps the backup warning and never claims re-derivation', async () => {
        const dialog = await openDeleteDialog(IMPORTED);
        const text = dialog.textContent;
        expect(text).toMatch(/An imported key is gone unless you have a separate backup\./);
        expect(text).not.toMatch(/re-derives/);
    });

    it('the only address on a chain says the chain leaves the wallet', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [hd('addr-plain', PLAIN, 2)] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-plain', address: PLAIN } }),
        });
        const dialog = await openDeleteDialog(PLAIN, messaging);
        expect(dialog.textContent).toMatch(/only Bitcoin address in this wallet/);
        expect(dialog.textContent).toMatch(/active Bitcoin address/);
    });

    it('confirming still deletes the record', async () => {
        const messaging = messagingWith();
        const dialog = await openDeleteDialog(PLAIN, messaging);
        fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ }).at(-1));
        expect(dialog).toBeTruthy();
        await vi.waitFor(() => expect(messaging.deleteAddress).toHaveBeenCalledWith('addr-plain'));
    });
});

describe('deleteAddressMessage', () => {
    it('hides amounts in Privacy Mode but still says funds exist', () => {
        const text = deleteAddressMessage({
            record: hd('x', PLAIN, 0),
            chainName: 'Dogecoin',
            holdings: ['12.5 DOGE'],
            hidden: true,
        });
        expect(text).toMatch(/It holds funds\./);
        expect(text).not.toMatch(/12\.5/);
    });

    it('a hardware-derived address gets the re-derive path, a watch-only one does not', () => {
        const hw = deleteAddressMessage({
            record: { source: 'trezor', derivationPath: "m/84'/0'/0'/0/3", role: 'receive' },
            chainName: 'Bitcoin',
        });
        expect(hw).toMatch(/re-derives the lowest missing address/);
        const wo = deleteAddressMessage({
            record: { source: 'watch-only', derivationPath: null, role: 'receive' },
            chainName: 'Bitcoin',
        });
        expect(wo).toMatch(/watch-only address can be added again/);
        expect(wo).not.toMatch(/re-derives/);
    });
});
