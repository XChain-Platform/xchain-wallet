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
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

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
    it('has no serious axe violations in its open state', async () => {
        const view = renderModal({
            getSettings: async () => REGTEST_SETTINGS,
            generateReceiveAddress: vi.fn(async () => ({ address: 'bcrt1qexample' })),
        });

        await waitFor(() => expect(screen.getByRole('button', { name: /Generate/ })).toBeTruthy());
        await expectNoSeriousAxeViolations(view.container);
    });

    it('offers the chains active on the current network', async () => {
        const messaging = {
            getSettings: async () => REGTEST_SETTINGS,
            generateReceiveAddress: vi.fn(async () => ({ address: 'bcrt1qexample' })),
        };
        renderModal(messaging);

        // The dead end: no options at all, only a Close button.
        await waitFor(() => expect(screen.queryByText(/No coins available/)).toBeNull());
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

    it('generates the requested number of addresses sequentially', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const generateReceiveAddress = vi.fn(async () => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await Promise.resolve();
            inFlight -= 1;
            return { address: `bcrt1qexample${generateReceiveAddress.mock.calls.length}` };
        });
        const onGenerated = vi.fn();
        const onClose = vi.fn();
        renderModal(
            { getSettings: async () => REGTEST_SETTINGS, generateReceiveAddress },
            { onGenerated, onClose },
        );

        fireEvent.change(await screen.findByLabelText('Number of addresses'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3' }));

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(3));
        expect(maxInFlight).toBe(1);
        expect(onGenerated).toHaveBeenCalledWith(3);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('rejects a fractional address count instead of rounding it down', async () => {
        const generateReceiveAddress = vi.fn(async () => ({ address: 'bcrt1qexample' }));
        renderModal({ getSettings: async () => REGTEST_SETTINGS, generateReceiveAddress });

        const count = await screen.findByLabelText('Number of addresses');
        fireEvent.change(count, { target: { value: '1.5' } });
        fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }));

        expect(await screen.findByText(/Enter a number between 1 and 25/)).toBeTruthy();
        expect(generateReceiveAddress).not.toHaveBeenCalled();
    });

    it('reports addresses persisted before a later batch item fails', async () => {
        const generateReceiveAddress = vi.fn()
            .mockResolvedValueOnce({ address: 'bcrt1qfirst' })
            .mockRejectedValueOnce(new Error('device disconnected'));
        const onGenerated = vi.fn();
        const onClose = vi.fn();
        renderModal(
            { getSettings: async () => REGTEST_SETTINGS, generateReceiveAddress },
            { onGenerated, onClose },
        );

        fireEvent.change(await screen.findByLabelText('Number of addresses'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3' }));

        expect(await screen.findByText('device disconnected')).toBeTruthy();
        expect(generateReceiveAddress).toHaveBeenCalledTimes(2);
        expect(onGenerated).toHaveBeenCalledWith(1);
        expect(onClose).not.toHaveBeenCalled();
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

        await waitFor(() => expect(screen.getByText(/No coins available/)).toBeTruthy());
    });
});
