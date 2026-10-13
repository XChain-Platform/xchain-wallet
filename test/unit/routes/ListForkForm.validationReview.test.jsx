// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListForkForm } from '../../../packages/core/src/shared/routes/ListForkForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'bitcoin-0',
    address: '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
    publicKey: '02aa',
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const LITECOIN_ADDRESS = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function mountFork({ type = '1', items = ['KEEP', 'REMOVE'] } = {}) {
    const row = {
        action_index: 2700,
        type,
        source: ADDRESS.address,
        list: items,
        state: {
            edit_resolution_active: true,
            current_list: items,
            owner: ADDRESS.address,
        },
    };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListForkForm
                walletId="wallet-1"
                listRef={{
                    chainId: CHAIN,
                    actionIndex: '2700',
                    type,
                    items,
                    editResolutionActive: true,
                    source: ADDRESS.address,
                    parentIndex: null,
                }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListForkForm addition validation', () => {
    it('keeps malformed token names out of review and writes the error as a sentence', async () => {
        mountFork();
        const additions = await screen.findByLabelText(/Add tokens/);
        fireEvent.change(additions, { target: { value: 'BAD TICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText("These don't look like token names: BAD TICK.")).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();

        fireEvent.change(additions, { target: { value: 'GOOD' } });
        expect(screen.queryByText(/don't look like token names/)).toBeNull();
    });

    it('keeps an address from another network out of review', async () => {
        mountFork({ type: '2', items: [ADDRESS.address] });
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: LITECOIN_ADDRESS },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(new RegExp(`aren't valid .* addresses: ${LITECOIN_ADDRESS}\\.$`))).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();
    });
});

describe('ListForkForm review', () => {
    it('shows both legs before an add-and-remove fork is signed', async () => {
        mountFork();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'REMOVE' }));
        fireEvent.change(screen.getByLabelText(/Add tokens/), { target: { value: 'ADD' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const details = await screen.findByText('Adding');
        expect(details.closest('dl')?.textContent).toMatch(/Adding1 item/);
        expect(details.closest('dl')?.textContent).toMatch(/Removing1 item/);
        expect(screen.getByText('Review list edit')).toBeTruthy();
    });
});
