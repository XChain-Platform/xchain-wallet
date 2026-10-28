// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qfunded000000000000000000000000000000000';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-funded',
        address: ADDRESS,
        label: 'Funded address',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        role: 'receive',
        accountId: ACCOUNT.id,
    }],
};

function messagingWith(getWalletBalances) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances,
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        deleteAddress: vi.fn().mockResolvedValue({ ok: true }),
    };
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function addressRow() {
    return screen.findByRole('button', { name: `View address ${ADDRESS}` });
}

afterEach(() => cleanup());

describe('AddressList unknown balances', () => {
    it('does not show a zero balance when the balance read rejects', async () => {
        mount(messagingWith(vi.fn().mockRejectedValue(new Error('balance read failed'))));

        await addressRow();
        expect(await screen.findByText('Balance unavailable')).toBeInTheDocument();
        expect(screen.queryByText('0 BTC')).toBeNull();
    });

    it('does not show a zero balance while the balance read is pending', async () => {
        mount(messagingWith(vi.fn(() => new Promise(() => {}))));

        await addressRow();
        expect(screen.getByText('Balance unavailable')).toBeInTheDocument();
        expect(screen.queryByText('0 BTC')).toBeNull();
    });

    it('warns before delete when the balance read failed', async () => {
        mount(messagingWith(vi.fn().mockRejectedValue(new Error('balance read failed'))));

        const row = await addressRow();
        await screen.findByText('Balance unavailable');
        fireEvent.click(row);
        fireEvent.click(screen.getByRole('button', { name: /Delete/ }));

        const dialog = await screen.findByRole('dialog', { name: /Delete this address\?/ });
        expect(dialog).toHaveTextContent("The balance couldn't be checked. This address may hold coins.");
    });

    it('shows a loaded zero and keeps the normal delete confirmation', async () => {
        const balances = {
            [CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '0', divisibility: 8 },
                    tokens: [],
                },
            }],
        };
        mount(messagingWith(vi.fn().mockResolvedValue(balances)));

        const row = await addressRow();
        await waitFor(() => expect(screen.getByText(/^0(?:\.0+)? BTC$/)).toBeInTheDocument());
        fireEvent.click(row);
        fireEvent.click(screen.getByRole('button', { name: /Delete/ }));

        const dialog = await screen.findByRole('dialog', { name: /Delete this address\?/ });
        expect(dialog).not.toHaveTextContent("The balance couldn't be checked.");
        expect(dialog).toHaveTextContent('Add address > Generate re-derives the lowest missing address');
    });
});
