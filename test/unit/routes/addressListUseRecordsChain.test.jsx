// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Pressing Use on an address is the clearest signal of which chain the
// user is working on, and it was the signal the action forms ignored: they
// kept opening on the wallet's oldest chain. Use now records the address's
// chain as the last-used chain of its network, keyed by the chain's own
// network so a regtest choice never becomes the mainnet default.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const CHAIN = 'dogecoin-regtest';
const REGTEST_SETTINGS = {
    schemaVersion: 3,
    activeNetwork: 'regtest',
    fees: { [CHAIN]: { strategy: 'normal' } },
};
const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const ADDRESS = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';

afterEach(() => cleanup());

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        setActiveAddress: vi.fn().mockResolvedValue({ ok: true }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address: ADDRESS,
                label: 'Doge',
                source: 'hd',
                addressType: 'p2pkh',
                derivationPath: "m/44'/1'/0'/0/1",
                accountId: ACCOUNT.id,
            }],
        }),
        ...overrides,
    };
}

async function pressUse(messaging, onBack = () => {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={onBack} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));
    fireEvent.click(await screen.findByRole('button', { name: /Use/ }));
}

describe('Addresses: Use records the last-used chain', () => {
    it('writes the address\'s chain into its own network slot after the address is made active', async () => {
        const messaging = messagingWith();
        const onBack = vi.fn();
        await pressUse(messaging, onBack);

        await waitFor(() => expect(messaging.setActiveAddress).toHaveBeenCalledWith(ACCOUNT.id, CHAIN, 'addr-1'));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            lastUsedChain: { regtest: CHAIN },
        }));
        // Still leaves for Home, as before.
        await waitFor(() => expect(onBack).toHaveBeenCalled());
    });

    it('writes nothing when the activation itself was refused', async () => {
        const messaging = messagingWith({
            setActiveAddress: vi.fn().mockRejectedValue(new Error('This wallet is locked.')),
        });
        await pressUse(messaging);

        await screen.findByRole('alert');
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('a refused preference write does not turn the switch into an error', async () => {
        const messaging = messagingWith({
            updateSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        });
        const onBack = vi.fn();
        await pressUse(messaging, onBack);

        await waitFor(() => expect(onBack).toHaveBeenCalled());
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalled());
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
