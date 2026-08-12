// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// D-64, the rest of the screen. The import form was fixed first
// because that is where the defect was reported, but every other failure
// path on Addresses still rendered `err.message` straight into the page -
// including the one that produced the message D-65 was filed for,
// "setActiveAddress: address does not belong to this account", when a user
// pressed Use on an imported key. The cause of that particular rejection is
// fixed; the rendering that would show the next one is what these cover.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const IMPORTED = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';

afterEach(() => cleanup());

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-regtest': [
                {
                    id: 'addr-1',
                    address: IMPORTED,
                    label: 'WIF vector',
                    source: 'imported-wif',
                    addressType: 'p2pkh',
                    accountId: null,
                },
            ],
        }),
        ...overrides,
    };
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />
        </MessagingProvider>,
    );
}

// Open the detail screen for the one address the fixture lists.
async function openDetail(messaging) {
    mount(messaging);
    fireEvent.click(await screen.findByRole('button', { name: `View address ${IMPORTED}` }));
    await screen.findByRole('button', { name: /Use/ });
}

describe('D-64: Use reports a refusal in the user\'s language', () => {
    it('does not render the flow name from a setActiveAddress rejection', async () => {
        const messaging = messagingWith({
            setActiveAddress: vi.fn(async () => {
                // The exact string D-65 was filed for.
                throw new Error('setActiveAddress: address does not belong to this account');
            }),
        });
        await openDetail(messaging);
        fireEvent.click(screen.getByRole('button', { name: /Use/ }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/setActiveAddress/);
        expect(alert.textContent).toMatch(/Could not switch to that address/i);
    });

    it('keeps copy that was already written for a user', async () => {
        const messaging = messagingWith({
            setActiveAddress: vi.fn(async () => {
                throw new Error('This wallet is locked. Unlock it and try again.');
            }),
        });
        await openDetail(messaging);
        fireEvent.click(screen.getByRole('button', { name: /Use/ }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/This wallet is locked/);
    });
});

describe('D-64: the other Addresses failures', () => {
    it('shows house copy when the address list cannot be read', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn(async () => {
                throw new Error('addresses.byChain: walletId is required');
            }),
        });
        mount(messaging);

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/addresses\.byChain/);
        expect(alert.textContent).toMatch(/Could not load the addresses/i);
    });

    it('shows house copy when a label cannot be saved', async () => {
        const messaging = messagingWith({
            setAddressLabel: vi.fn(async () => {
                throw new Error('setAddressLabel: Cannot read properties of undefined');
            }),
        });
        await openDetail(messaging);
        fireEvent.change(screen.getByLabelText(/Address label/i), { target: { value: 'Paper key' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/setAddressLabel|Cannot read propert/);
        expect(alert.textContent).toMatch(/Could not save that label/i);
    });

    it('shows house copy when a delete is refused', async () => {
        const messaging = messagingWith({
            deleteAddress: vi.fn(async () => {
                throw new Error('deleteAddress: address not found');
            }),
        });
        await openDetail(messaging);
        fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
        // The screen confirms first; an imported key is unrecoverable. The
        // quick action keeps its own "Delete", so take the modal's copy.
        await screen.findByText(/Delete this address\?/);
        const confirm = screen.getAllByRole('button', { name: /^Delete$/ }).at(-1);
        fireEvent.click(confirm);

        await waitFor(() => {
            const alert = screen.queryByRole('alert');
            expect(alert?.textContent).toMatch(/Could not delete that address/i);
        });
        expect(screen.queryByText(/deleteAddress:/)).toBeNull();
    });
});
