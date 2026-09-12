// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A coin-priced dispenser (the common shape on the public testnet) had no Buy
// control: the panel printed the pay-to address and told the buyer to use
// another wallet, though this wallet already sends the native coin through
// the same flow the token lane calls. These drive the real component through
// to the signed request and pin the base-unit amount that request becomes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { nativePaymentOutput } from '../../../packages/core/src/flows/nativePayment.js';

const CHAIN = 'dogecoin-testnet';
const BUYER = 'nBuyerBuyerBuyerBuyerBuyerBuyerBuyer1';
const OWNER = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

const buyerAddress = {
    id: 'addr-1', address: BUYER, publicKey: '02ab',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd',
};
const ownerAddress = {
    id: 'addr-2', address: OWNER, publicKey: '02cd',
    derivationPath: "m/44'/1'/0'/0/1", source: 'hd',
};

// 100 DOGESWAP per fill for 2 DOGE.
const COIN_PAID = {
    action_index: '816',
    source: OWNER,
    address: OWNER,
    give_tick: 'DOGESWAP',
    give_amount: '100',
    get_tick: null,
    get_coin: 'DOGE',
    get_amount: '2.00000000',
    fiat: null,
    fiat_amount: null,
    oracle_address: null,
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};
const TOKEN_PAID = {
    ...COIN_PAID, action_index: '817', get_tick: 'MEMEVALID', get_coin: null, get_amount: '5',
};
// Priced in fiat: GET_AMOUNT is a placeholder and the coin owed is fixed only
// when the payment lands, so the wallet cannot size a send for it.
const FIAT_PRICED = {
    ...COIN_PAID, action_index: '818', get_amount: '0.00000000', fiat: 'USD', fiat_amount: '1.50',
};

function mount(dispenser, { addresses = [buyerAddress], dogeSats = '1000000000' } = {}) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: addresses }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: addresses.map((a) => ({
                address: a.address,
                balances: {
                    native: { tick: 'DOGE', quantity: dogeSats, divisibility: 8 },
                    tokens: [{ tick: 'MEMEVALID', quantity: '250', divisibility: 0 }],
                },
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
const noBuyButton = () => screen.queryByRole('button', { name: /^Buy \d+ fills?$/ });

afterEach(() => cleanup());

describe('coin-paid dispenser: Buy from this wallet', () => {
    it('shows a Buy control with the native balance, beside the pay-to address and Copy', async () => {
        mount(COIN_PAID);
        expect(await buyButton()).toBeInTheDocument();
        expect(await screen.findByText(/10 DOGE available/)).toBeInTheDocument();
        // The other-wallet path stays for buyers who prefer it.
        expect(screen.getByText(OWNER, { selector: 'code' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/on the roadmap/);
    });

    it('signs 3 fills of 2 DOGE as one native send of 600000000 base units to the dispenser', async () => {
        const messaging = mount(COIN_PAID);
        await screen.findByText(/10 DOGE available/);
        fireEvent.change(await screen.findByLabelText(/Fills/i), { target: { value: '3' } });
        const buy = await buyButton();
        await waitFor(() => expect(buy).toBeEnabled());
        fireEvent.click(buy);

        // Review: the exact total, then the same approval screen the token lane uses.
        expect(await screen.findByText(/pay 6 DOGE/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'pw' } });
        const sign = await screen.findByRole('button', { name: /Sign buy/ });
        await waitFor(() => expect(sign).toBeEnabled());
        fireEvent.click(sign);

        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
        const req = messaging.sendToken.mock.calls[0][0];
        expect(req.to).toBe(OWNER);
        expect(req.tick).toBe('DOGE');
        expect(req.amount).toBe('6');
        expect(req.from.address).toBe(BUYER);
        expect(req.password).toBe('pw');
        expect(req.actionSummary).toMatch(/^Buy 3 fills from dispenser #816: 6 DOGE for 300 DOGESWAP$/);
        // What the flow turns that request into on the wire: the destination
        // output, in base units, exact.
        const out = nativePaymentOutput({
            tick: req.tick, amount: req.amount, destination: req.to, descriptor: { coin: 'dogecoin' },
        });
        expect(out).toEqual({ address: OWNER, value: '600000000' });
        expect(messaging.sendAssetHw).not.toHaveBeenCalled();
        expect(await screen.findByText(/Buy submitted/)).toBeInTheDocument();
        expect(screen.getByText(/You paid 6 DOGE/)).toBeInTheDocument();
    });

    it('blocks a fill count the native balance cannot cover', async () => {
        // 10 DOGE buys 5 fills, not 6.
        mount(COIN_PAID);
        await screen.findByText(/10 DOGE available/);
        fireEvent.change(await screen.findByLabelText(/Fills/i), { target: { value: '6' } });
        await waitFor(async () => expect(await buyButton()).toBeDisabled());
        expect(await screen.findByTestId('preflight-chip')).toHaveTextContent(/Will likely fail/);
    });

    it('keeps the list warning on a restricted dispenser next to the Buy control', async () => {
        mount({ ...COIN_PAID, allow_list: '1690' });
        await buyButton();
        const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
        expect(alerts.filter((t) => /list #1690/.test(t))).toHaveLength(1);
        expect(alerts.join(' ')).toMatch(/not returned/);
    });

    it('offers no Buy control when the row names a coin this chain does not pay in', async () => {
        // The send flow recognises a native payment by the CHAIN's ticker, so a
        // row asking for another coin is one this wallet must not try to pay.
        mount({ ...COIN_PAID, get_coin: 'LTC' });
        await screen.findByText(/Pay to buy/);
        expect(noBuyButton()).toBeNull();
    });

    it('offers no Buy control for a fiat-priced dispenser, and keeps the pay-here panel', async () => {
        mount(FIAT_PRICED);
        await screen.findByText(/Pay to buy/);
        expect(noBuyButton()).toBeNull();
        expect(document.body.textContent).toMatch(/fiat-priced/);
    });
});

describe('dispenser owned by the viewer', () => {
    it('shows no Buy control and no pay-here panel on a coin-paid dispenser', async () => {
        mount(COIN_PAID, { addresses: [buyerAddress, ownerAddress] });
        await screen.findByText(/\(you\)/);
        expect(noBuyButton()).toBeNull();
        expect(screen.queryByText(/Pay to buy/)).toBeNull();
    });

    it('shows no Buy control on a token-paid dispenser', async () => {
        mount(TOKEN_PAID, { addresses: [buyerAddress, ownerAddress] });
        await screen.findByText(/\(you\)/);
        expect(noBuyButton()).toBeNull();
    });
});
