// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
const LITECOIN_REGTEST_ADDRESS = 'rltc1qmr46t4ca5wh35k6mczdzrkepqw2d8ne92hnush';

function mountFork({ type = '1', items = ['KEEP', 'REMOVE'], chainId = CHAIN, owner = ADDRESS, anyCoins } = {}) {
    const row = {
        action_index: 2700,
        type,
        source: owner.address,
        list: items,
        state: {
            edit_resolution_active: true,
            current_list: items,
            owner: owner.address,
        },
    };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [owner] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: { id: owner.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
        ...(anyCoins ? { listAnyCoinItems: vi.fn().mockResolvedValue(anyCoins) } : {}),
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
                    chainId,
                    actionIndex: '2700',
                    type,
                    items,
                    editResolutionActive: true,
                    source: owner.address,
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
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
        fireEvent.change(additions, { target: { value: 'BAD TICK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Remove 1 invalid token name before reviewing.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();

        fireEvent.change(additions, { target: { value: 'GOOD' } });
        expect(screen.queryByText(/invalid token name before reviewing/)).toBeNull();
    });

    it('keeps an address from another network out of review', async () => {
        mountFork({ type: '2', items: [ADDRESS.address] });
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: LITECOIN_ADDRESS },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();
    });

    // Token-policy inheritance: the explorer's gate flag widens address items to
    // every configured coin on the network, the rule the indexer applies.
    it('takes another coin\'s address into review when the explorer gate is on', async () => {
        const messaging = mountFork({ type: '2', items: [ADDRESS.address], anyCoins: ['bitcoin', 'litecoin'] });
        await waitFor(() => expect(messaging.listAnyCoinItems).toHaveBeenCalledWith({
            chainId: CHAIN, coin: 'bitcoin', networkKind: 'mainnet',
        }));
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: LITECOIN_ADDRESS },
        });

        expect(await screen.findByText(/1 to add · 0 to remove/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(screen.queryByText(/invalid address before reviewing/)).toBeNull();
    });

    it('keeps a regtest coin out of a mainnet list even with the gate on', async () => {
        mountFork({ type: '2', items: [ADDRESS.address], anyCoins: ['bitcoin', 'litecoin'] });
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: LITECOIN_REGTEST_ADDRESS },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
    });

    // A ^<index> reference is still kept out, but the note says it is a reference, not a typo.
    it('keeps an address reference out of review and says what it is', async () => {
        mountFork({ type: '2', items: [ADDRESS.address] });
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: '^123' },
        });

        expect(await screen.findByText(/One entry is an address reference/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('Remove 1 invalid address before reviewing.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish add' })).toBeNull();
    });

    it('counts a Litecoin regtest member stored in uppercase as already on the list', async () => {
        const owner = { ...ADDRESS, id: 'litecoin-0', address: LITECOIN_REGTEST_ADDRESS };
        const stored = LITECOIN_REGTEST_ADDRESS.toUpperCase();
        mountFork({ type: '2', items: [stored], chainId: 'litecoin-regtest', owner });
        fireEvent.change(await screen.findByLabelText(/Add addresses/), {
            target: { value: LITECOIN_REGTEST_ADDRESS },
        });

        expect(await screen.findByText(/0 to add · 0 to remove/)).toBeTruthy();
        expect(document.body.textContent).toMatch(/1 already on the list/);
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
