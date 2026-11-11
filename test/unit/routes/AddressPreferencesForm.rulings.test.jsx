// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// On-chain preferences against the app-wide rulings: the form opens with
// Network, then From (U60), and picking another own address edits that
// address, reloading its current values; every choice carries a help tip and
// no how-it-works box stands in for it (U57); the main action is named and
// iconned (U63); Memo and the network fee are not filed under Dispensers.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN = 'bitcoin-regtest';
const ADDR_A = { id: 'a0', address: 'bcrt1qprefsprefsprefsprefsprefsprefsprefs00', source: 'hd' };
const ADDR_B = { id: 'a1', address: 'bcrt1qotherotherotherotherotherotherother11', source: 'hd' };

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId}>
            <button type="button" onClick={() => onPick(ADDR_B)}>Pick the other address</button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

afterEach(() => cleanup());

function mount() {
    const getAddressPreferences = vi.fn(({ address }) => Promise.resolve(address === ADDR_B.address
        ? { onChain: true, feePreference: 1, requireMemo: 1, dispenserPreference: 2 }
        : { onChain: false, feePreference: 0, requireMemo: 0, dispenserPreference: 0 }));
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDR_A, ADDR_B] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDR_A }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getAddressPreferences,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressPreferencesForm walletId="w" chainId={CHAIN} address={ADDR_A.address} onBack={() => {}} />
        </MessagingProvider>,
    );
    return { getAddressPreferences };
}

describe('AddressPreferencesForm rulings', () => {
    it('opens with Network, then From, with tips and no disclosure box', async () => {
        mount();
        const from = await screen.findByLabelText('From');
        expect(from).toHaveValue(ADDR_A.address);
        const network = screen.getByRole('button', { name: /^Network:/ });
        const follows = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(network.compareDocumentPosition(from) & follows).toBeTruthy();
        expect(from.compareDocumentPosition(screen.getByRole('group', { name: 'Choose how the protocol fee is handled' })) & follows).toBeTruthy();
        expect(screen.queryByText('Who can see these preferences?')).toBeNull();
        for (const name of ['About From', 'About Choose how the protocol fee is handled', 'About Incoming sends', 'About Who may open dispensers', 'About Memo']) {
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        }
    });

    it('keeps Memo and the network fee out of the Dispensers section', async () => {
        mount();
        await screen.findByLabelText('From');
        const dispensers = screen.getByRole('group', { name: 'Who may open dispensers' });
        const memo = screen.getByLabelText('Memo');
        expect(dispensers.parentElement.contains(memo)).toBe(false);
        expect(screen.getByRole('heading', { name: 'Memo and network fee' })).toBeInTheDocument();
    });

    it('uses the kit Checkbox for the memo requirement', async () => {
        mount();
        await screen.findByLabelText('From');
        expect(screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' })).toBeInTheDocument();
    });

    it('names its main action Update preferences with an icon', async () => {
        mount();
        await screen.findByLabelText('From');
        const submit = screen.getByRole('button', { name: 'Update preferences' });
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('picking another own address edits that address and reloads its values', async () => {
        const { getAddressPreferences } = mount();
        await waitFor(() => expect(getAddressPreferences).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDR_A.address }));
        // A pick made for the first address must not carry over.
        fireEvent.click(await screen.findByLabelText('Destroy the fee (reduces supply)'));
        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN);
        fireEvent.click(screen.getByRole('button', { name: 'Pick the other address' }));

        expect(await screen.findByLabelText('From')).toHaveValue(ADDR_B.address);
        await waitFor(() => expect(getAddressPreferences).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDR_B.address }));
        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Require a memo on any send to this address' })).toBeChecked());
        expect(screen.getByLabelText('Anyone may open a dispenser funded by this address')).toBeChecked();
    });
});
