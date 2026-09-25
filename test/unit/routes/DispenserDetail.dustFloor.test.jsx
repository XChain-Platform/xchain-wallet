// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A coin-paid dispenser can be opened priced below the chain's dust
// floor (GET_AMOUNT 0.00001985 DOGE against DOGE's 0.001 floor, seen live on
// Dogecoin testnet), and the indexer still fills floor(paid / GET_AMOUNT)
// times, so the smallest payment anyone can send buys 51 fills and a buyer
// asking for fewer builds a payment every node refuses before it ever reaches
// the dispenser. These drive the real buy panel through that boundary.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'dogecoin-testnet';
const BUYER = 'nBuyerBuyerBuyerBuyerBuyerBuyerBuyer1';
const OWNER = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

const buyerAddress = {
    id: 'addr-1', address: BUYER, publicKey: '02ab',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd',
};

// The live testnet shape: 1 DOGESWAP per fill for 0.00001985 DOGE, well under
// DOGE's 100000-sat (0.001 DOGE) dust floor. Plenty of escrow (1000 fills'
// worth), so the floor is what limits a buy, not the dispenser running dry.
const DUST_PRICED = {
    action_index: '3048',
    source: OWNER,
    address: OWNER,
    give_tick: 'DOGESWAP',
    give_amount: '1',
    get_tick: null,
    get_coin: 'DOGE',
    get_amount: '0.00001985',
    fiat: null,
    fiat_amount: null,
    oracle_address: null,
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};
// Same price, but only 20 fills left in escrow - fewer than the 51 a payment
// needs to clear the floor, so no fill count a buyer types can ever work.
const DUST_PRICED_SPARSE = { ...DUST_PRICED, action_index: '3049', escrow_remaining: '20' };
// Priced comfortably above the floor: the check must stay silent here.
const NORMAL_PRICED = { ...DUST_PRICED, action_index: '3050', get_amount: '2.00000000' };

function mount(dispenser, { addresses = [buyerAddress], dogeSats = '1000000000' } = {}) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: addresses }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: addresses.map((a) => ({
                address: a.address,
                balances: { native: { tick: 'DOGE', quantity: dogeSats, divisibility: 8 }, tokens: [] },
            })),
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        sendAssetHw: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: dispenser.action_index,
                onBack() {}, onCanceled() {},
            }),
        ),
    );
    return messaging;
}

const buyButton = () => screen.findByRole('button', { name: /^Buy \d+ fills?$/ });
const fillsInput = () => screen.findByLabelText(/Fills/i);

afterEach(() => cleanup());

describe('coin-paid dispenser priced below the dust floor', () => {
    it('defaults Fills to the smallest whole purchase and states it in plain language', async () => {
        mount(DUST_PRICED);
        const input = await fillsInput();
        await waitFor(() => expect(input).toHaveValue('51'));
        expect(await screen.findByTestId('min-fills-notice')).toHaveTextContent(
            'The smallest purchase is 51 fills (0.00101235 DOGE): DOGE payments under '
            + '0.001 DOGE are refused by every node.',
        );
        expect(screen.queryByTestId('buy-dust-block')).toBeNull();
        expect(await buyButton()).toBeEnabled();
    });

    it('blocks Buy below the minimum and retracts the block once Fills clears it', async () => {
        mount(DUST_PRICED);
        await fillsInput();
        fireEvent.change(await fillsInput(), { target: { value: '10' } });

        const block = await screen.findByTestId('buy-dust-block');
        expect(block).toHaveTextContent(
            'Buying fewer than 51 fills builds a payment under 0.001 DOGE, which every '
            + 'node refuses. Enter at least 51 fills to buy from this dispenser.',
        );
        expect(await buyButton()).toBeDisabled();

        fireEvent.change(await fillsInput(), { target: { value: '51' } });
        await waitFor(() => expect(screen.queryByTestId('buy-dust-block')).toBeNull());
        expect(await buyButton()).toBeEnabled();
    });

    it('says the dispenser cannot be bought from as priced when its escrow can never clear the floor', async () => {
        mount(DUST_PRICED_SPARSE);
        await fillsInput();
        const block = await screen.findByTestId('buy-dust-block');
        expect(block).toHaveTextContent(
            'This dispenser cannot be bought from as priced: every payment it can still '
            + 'pay out prices below the 0.001 DOGE minimum the network will relay.',
        );
        // No fill count fixes it: the floor is unreachable however Fills is set.
        expect(screen.queryByTestId('min-fills-notice')).toBeNull();
        expect(await buyButton()).toBeDisabled();
        fireEvent.change(await fillsInput(), { target: { value: '20' } });
        expect(await buyButton()).toBeDisabled();
    });

    it('stays silent when the per-fill price already clears the floor', async () => {
        mount(NORMAL_PRICED);
        const input = await fillsInput();
        expect(input).toHaveValue('1');
        expect(screen.queryByTestId('min-fills-notice')).toBeNull();
        expect(screen.queryByTestId('buy-dust-block')).toBeNull();
        expect(await buyButton()).toBeEnabled();
    });
});
