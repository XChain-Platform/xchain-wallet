// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : Receive's "no addresses anywhere" state was a bare red error
// string with no way out. Receive is the screen Home points at ("Use
// Receive to generate one"), so the one surface that names the problem
// also has to offer the cure: a generate CTA that opens Add addresses.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: {
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
        'dogecoin-regtest': { strategy: 'normal' },
    },
};

function baseMessaging(overrides = {}) {
    return {
        getSettings: async () => REGTEST_SETTINGS,
        getAddressesByChain: async () => ({}),
        getNewestAddress: async () => null,
        ...overrides,
    };
}

function renderReceive(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="w1" accountId="acct-1" {...props} />
        </MessagingProvider>,
    );
}

describe(': Receive with no addresses on any chain', () => {
    it('offers a generate CTA instead of dead-ending on the error string', async () => {
        renderReceive(baseMessaging());

        await waitFor(() => expect(screen.getByText(/No addresses yet on any chain/)).toBeTruthy());
        expect(screen.getByRole('button', { name: /Generate an address/i })).toBeTruthy();
    });

    it('opens Add addresses from the CTA and generates on an active chain', async () => {
        const generateReceiveAddress = vi.fn(async () => ({ address: 'bcrt1qexample' }));
        renderReceive(baseMessaging({ generateReceiveAddress }));

        const cta = await screen.findByRole('button', { name: /Generate an address/i });
        fireEvent.click(cta);

        // Add addresses takes over the screen, preselecting an active chain
        // even though the account occupies none.
        const generate = await screen.findByRole('button', { name: /^Generate$/ });
        fireEvent.click(generate);

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(1));
        expect(generateReceiveAddress.mock.calls[0][0]).toMatchObject({
            walletId: 'w1',
            accountId: 'acct-1',
            chainId: 'bitcoin-regtest',
        });
    });

    it('reloads the chain list after generating, so the QR appears', async () => {
        let addresses = {};
        const messaging = baseMessaging({
            getAddressesByChain: async () => addresses,
            getNewestAddress: async () => (
                addresses['bitcoin-regtest']?.[0] || null
            ),
            generateReceiveAddress: vi.fn(async () => {
                addresses = { 'bitcoin-regtest': [{ id: 'a1', address: 'bcrt1qexample', addressType: 'p2wpkh' }] };
                return addresses['bitcoin-regtest'][0];
            }),
        });
        renderReceive(messaging);

        fireEvent.click(await screen.findByRole('button', { name: /Generate an address/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^Generate$/ }));

        await waitFor(() => expect(screen.getByDisplayValue('bcrt1qexample')).toBeTruthy());
        expect(screen.queryByText(/No addresses yet on any chain/)).toBeNull();
    });
});
