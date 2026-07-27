// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : every "you have no addresses" surface has to offer a way to
// get one. Home's hint pointed at Receive, Receive's error pointed
// nowhere, and the Import-WIF chain picker only listed chains the
// account already occupied - so an account whose seeding failed had no
// route to a first address by derivation OR by import. Covered here:
// Home's CTA and the widened import picker; Receive's CTA lives in
// Receive.emptyAccount.test.jsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { offerableChainIds } from '../../../packages/core/src/flows/seedChainIds.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

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

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };

afterEach(() => cleanup());

function emptyMessaging(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        ...overrides,
    };
}

function mount(node, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

describe('offerableChainIds', () => {
    const registry = defaultRegistry();

    it('unions the occupied chains with the ones active on the network', () => {
        const out = offerableChainIds({
            occupied: ['bitcoin-mainnet'],
            settings: REGTEST_SETTINGS,
            chainRegistry: registry,
        });
        // Occupied first, so a populated wallet keeps its old ordering.
        expect(out[0]).toBe('bitcoin-mainnet');
        expect(out).toContain('bitcoin-regtest');
        expect(out).toContain('litecoin-regtest');
    });

    it('offers the active chains even when the account occupies none', () => {
        const out = offerableChainIds({
            occupied: [],
            settings: REGTEST_SETTINGS,
            chainRegistry: registry,
        });
        expect(out.length).toBeGreaterThan(0);
        expect(out).toContain('bitcoin-regtest');
    });

    it('degrades to the occupied set when settings are unreadable', () => {
        expect(offerableChainIds({
            occupied: ['bitcoin-mainnet'],
            settings: null,
            chainRegistry: registry,
        })).toEqual(['bitcoin-mainnet']);
        expect(offerableChainIds({ occupied: [], settings: null, chainRegistry: registry })).toEqual([]);
    });

    it('never emits a duplicate when a chain is both occupied and active', () => {
        const out = offerableChainIds({
            occupied: ['bitcoin-regtest'],
            settings: REGTEST_SETTINGS,
            chainRegistry: registry,
        });
        expect(out.filter((id) => id === 'bitcoin-regtest')).toHaveLength(1);
    });
});

describe(': Home with no addresses', () => {
    it('offers a generate CTA instead of pointing at Receive', async () => {
        mount(
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
            emptyMessaging(),
        );

        const cta = await screen.findByRole('button', { name: /Generate an address/i });
        expect(cta).toBeTruthy();
        // The old copy told the user to go somewhere else and stopped there.
        expect(screen.queryByText(/Use Receive to generate one/)).toBeNull();
    });

    it('opens Add addresses and derives on an active chain', async () => {
        const generateReceiveAddress = vi.fn(async () => ({ address: 'bcrt1qexample' }));
        mount(
            <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />,
            emptyMessaging({ generateReceiveAddress }),
        );

        fireEvent.click(await screen.findByRole('button', { name: /Generate an address/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^Generate$/ }));

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(1));
        expect(generateReceiveAddress.mock.calls[0][0]).toMatchObject({
            walletId: WALLET.id,
            accountId: ACCOUNT.id,
            chainId: 'bitcoin-regtest',
        });
    });

    it('refetches balances once the address lands', async () => {
        const messaging = emptyMessaging({
            generateReceiveAddress: vi.fn(async () => ({ address: 'bcrt1qexample' })),
        });
        mount(<Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />, messaging);

        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        const before = messaging.getWalletBalances.mock.calls.length;

        fireEvent.click(await screen.findByRole('button', { name: /Generate an address/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^Generate$/ }));

        await waitFor(() => {
            expect(messaging.getWalletBalances.mock.calls.length).toBeGreaterThan(before);
        });
    });
});

describe(': Import WIF chain picker', () => {
    async function openImportForm(messaging) {
        mount(
            <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />,
            messaging,
        );
        fireEvent.click(await screen.findByRole('button', { name: /Add or import address/i }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /Import address/i }));
        return screen.findByRole('button', { name: /Import/i });
    }

    it('lists chains the account does not occupy yet', async () => {
        await openImportForm(emptyMessaging({ importWifRequest: vi.fn() }));

        // The picker trigger carries the preselected chain; with zero
        // occupied chains it used to sit on the placeholder with an empty
        // list behind it.
        const trigger = await screen.findByRole('button', { name: /Bitcoin/ });
        fireEvent.click(trigger);
        await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
        const labels = screen.getAllByRole('option').map((o) => o.textContent);
        expect(labels.some((l) => /Litecoin/.test(l))).toBe(true);
        expect(labels.some((l) => /Dogecoin/.test(l))).toBe(true);
    });

    it('imports onto a chain the account had no address on', async () => {
        const importWifRequest = vi.fn(async () => ({ address: { address: 'bcrt1qimported' } }));
        await openImportForm(emptyMessaging({ importWifRequest }));

        const wifField = await screen.findByLabelText(/WIF private key/i);
        fireEvent.change(wifField, { target: { value: 'cQexampleWifKeyValueForRegtestOnly' } });
        const pwField = screen.queryByLabelText(/Wallet password/i);
        if (pwField) fireEvent.change(pwField, { target: { value: 'correct horse' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

        await waitFor(() => expect(importWifRequest).toHaveBeenCalledTimes(1));
        expect(importWifRequest.mock.calls[0][0].chainId).toBe('bitcoin-regtest');
    });
});
