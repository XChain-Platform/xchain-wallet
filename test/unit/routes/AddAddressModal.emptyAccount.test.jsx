// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Add-address built its coin list from "the chains the account
// is already on", so an account with zero addresses got zero options -
// "No chains are active for this account yet." and a Close button. You
// could only add an address on a chain you already occupied, which made
// a freshly added wallet unrecoverable from inside the app. The list is
// now that set UNION the chains active on the current network.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: {
        'bitcoin-mainnet': { strategy: 'normal' },
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
        'dogecoin-regtest': { strategy: 'normal' },
    },
};

function renderModal(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddAddressModal
                walletId="w1"
                accountId="acct-1"
                chainIds={[]}
                onClose={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

describe('Add address on an account with no addresses', () => {
    it('offers the chains active on the current network', async () => {
        const messaging = {
            getSettings: async () => REGTEST_SETTINGS,
            generateReceiveAddress: vi.fn(async () => ({ address: 'bcrt1qexample' })),
        };
        renderModal(messaging);

        // The dead end: no options at all, only a Close button.
        await waitFor(() => expect(screen.queryByText(/No coins are available/)).toBeNull());
        expect(screen.getByRole('button', { name: /Generate/ })).toBeTruthy();
        // The picker preselects the first active chain rather than nothing.
        expect(screen.getByText('Bitcoin')).toBeTruthy();
    });

    it('generates the first address on an active chain', async () => {
        const generateReceiveAddress = vi.fn(async () => ({ address: 'bcrt1qexample' }));
        renderModal({ getSettings: async () => REGTEST_SETTINGS, generateReceiveAddress });

        await waitFor(() => expect(screen.getByRole('button', { name: /Generate/ })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(1));
        expect(generateReceiveAddress.mock.calls[0][0]).toMatchObject({
            walletId: 'w1',
            accountId: 'acct-1',
            chainId: 'bitcoin-regtest',
        });
        // The address type must be the chain default, never blank: an empty
        // type would be handed straight to the derive flow.
        expect(generateReceiveAddress.mock.calls[0][0].addressType).toBeTruthy();
    });

    it('keeps offering the chains the account already occupies', async () => {
        const generateReceiveAddress = vi.fn(async () => ({ address: 'bc1qexample' }));
        renderModal(
            { getSettings: async () => REGTEST_SETTINGS, generateReceiveAddress },
            { chainIds: ['bitcoin-mainnet'] },
        );

        await waitFor(() => expect(screen.getByRole('button', { name: /Generate/ })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(1));
        // The account's own chain stays first, so this screen behaves exactly
        // as before for a wallet that already has addresses.
        expect(generateReceiveAddress.mock.calls[0][0].chainId).toBe('bitcoin-mainnet');
    });

    it('falls back to the account chains when settings cannot be read', async () => {
        renderModal({
            getSettings: async () => { throw new Error('locked'); },
            generateReceiveAddress: vi.fn(),
        }, { chainIds: [] });

        await waitFor(() => expect(screen.getByText(/No coins are available/)).toBeTruthy());
    });
});
