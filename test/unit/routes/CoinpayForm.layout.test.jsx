// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pay-for-matched-order screen: the Payments-due picker is one list card of
// selectable rows with no inline styles, the chain shows as an icon only, and
// the forward actions are named, green and carry an icon.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoinpayForm } from '../../../packages/core/src/shared/routes/CoinpayForm.jsx';

const WALLET_ID = 'wallet-a';
const CHAIN = 'dogecoin-testnet';
const PAYER = 'ndevmockaaaaaaaaaaaaaaaaaaaaaaaa';
const PAYEE = 'ndevmockbbbbbbbbbbbbbbbbbbbbbbbb';

function obligation(actionIndex, coinAmount = '10', expiration = Math.floor(Date.now() / 1000) + 3600) {
    return {
        coinpay_status: 'pending_coinpay',
        payer_address: PAYER,
        payee_address: PAYEE,
        action_index: actionIndex,
        coin_amount: coinAmount,
        expiration: String(expiration),
    };
}

function makeMessaging(rows) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: PAYER, publicKey: '02ab', derivationPath: "m/44'/3'/0'/0/0" }],
        }),
        getCoinpayObligationsForAddress: vi.fn().mockResolvedValue(rows),
        getSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
    };
}

function mount(props, messaging) {
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(CoinpayForm, { walletId: WALLET_ID, onBack: vi.fn(), ...props }),
    ));
}

afterEach(() => cleanup());

describe('CoinpayForm Payments due list', () => {
    it('draws every row inside one list card with no inline styles', async () => {
        mount({}, makeMessaging([obligation('648'), obligation('649', '2.5')]));
        await screen.findByText('Payments due');
        const lists = document.querySelectorAll('ul');
        expect(lists).toHaveLength(1);
        const list = lists[0];
        expect(list.getAttribute('style')).toBeNull();
        expect(list.className).toMatch(/dueList/);
        const rows = within(list).getAllByRole('button');
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(row.closest('ul')).toBe(list);
        expect(list.querySelectorAll('li, button, div, strong')).not.toHaveLength(0);
        for (const el of list.querySelectorAll('li, button, div, strong')) expect(el.getAttribute('style')).toBeNull();
    });

    it('marks the chosen row with aria-pressed and shows the chain as an icon only', async () => {
        mount({}, makeMessaging([obligation('648'), obligation('649')]));
        await screen.findByText('Payments due');
        const rows = within(document.querySelector('ul')).getAllByRole('button');
        expect(rows.every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true);
        fireEvent.click(rows[1]);
        expect(rows[1].getAttribute('aria-pressed')).toBe('true');
        expect(rows[0].getAttribute('aria-pressed')).toBe('false');
        for (const row of rows) {
            expect(row.textContent).not.toMatch(/Dogecoin/i);
            expect(within(row).getByRole('img').getAttribute('aria-label')).toMatch(/Dogecoin/i);
        }
    });

    it('keeps the expired warning text on an expired row', async () => {
        mount({}, makeMessaging([obligation('648', '10', Math.floor(Date.now() / 1000) - 60)]));
        await screen.findByText(/EXPIRED, do not pay/);
    });
});

describe('CoinpayForm forward actions', () => {
    async function mountPrefilled() {
        mount(
            { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' },
            makeMessaging([obligation('648')]),
        );
        return screen.findByRole('button', { name: 'Pay order' });
    }

    it('names the form action "Pay order" as a green button with an icon', async () => {
        const button = await mountPrefilled();
        expect(button.className).toMatch(/success/);
        expect(button.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('labels the paying row "From" and shows the network as an icon without its name', async () => {
        await mountPrefilled();
        const form = screen.getByRole('form', { name: 'Selected payment' });
        const dl = form.querySelector('dl');
        expect(within(dl).getByText('From')).toBeInTheDocument();
        expect(within(dl).queryByText('Paying from')).toBeNull();
        const network = within(dl).getByText('Network').nextElementSibling;
        expect(network.textContent).not.toMatch(/Dogecoin/i);
        expect(within(network).getByRole('img')).toBeInTheDocument();
    });

    it('names the review action with the amount, green, with an icon', async () => {
        const button = await mountPrefilled();
        fireEvent.click(button);
        await screen.findByText('Review payment');
        const pay = await screen.findByRole('button', { name: 'Pay 10 DOGE' });
        expect(pay.className).toMatch(/success/);
        expect(pay.querySelector('svg')).not.toBeNull();
        const network = screen.getByText('Network').nextElementSibling;
        expect(network.textContent).not.toMatch(/Dogecoin/i);
        expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
    });
});
