// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pay-for-matched-order screen (approved Layout 1): no Payments-due picker,
// a Payment section of one compact facts list (You pay and You get with fiat,
// Time left, Pay to, Matched order). The match is read once per
// page load. The forward actions are named, green and carry an icon.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoinpayForm } from '../../../packages/core/src/shared/routes/CoinpayForm.jsx';

// Fiat rates by tick, served through the wallet's own rate hook so the test
// controls which assets the wallet can price.
const fiatRates = vi.hoisted(() => ({}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useTickFiatRate: ({ tick, enabled }) => (enabled && fiatRates[tick]
        ? { rate: fiatRates[tick], source: 'test', fetchedAt: 0 }
        : null),
}));

const WALLET_ID = 'wallet-a';
const CHAIN = 'dogecoin-testnet';
const MAINNET = 'dogecoin-mainnet';
const PAYER = 'ndevmockaaaaaaaaaaaaaaaaaaaaaaaa';
const PAYEE = 'ndevmockbbbbbbbbbbbbbbbbbbbbbbbb';
const now = () => Math.floor(Date.now() / 1000);

function obligation(actionIndex, coinAmount = '10', expiration = now() + 7200) {
    return {
        coinpay_status: 'pending_coinpay',
        payer_address: PAYER,
        payee_address: PAYEE,
        action_index: actionIndex,
        coin_amount: coinAmount,
        expiration: String(expiration),
        block_index: 1200,
    };
}

// The explorer's ORDER_MATCH detail: ticks and amounts from one order's side,
// the coin side with a blank tick.
function matchDetail(actionIndex, { coinAmount = '10', tick = 'PEPECASH', tokenAmount = '1000' } = {}) {
    return {
        data: [{
            action: 'ORDER_MATCH',
            action_index: actionIndex,
            give_coin: 'DOGE', give_tick: null, give_amount: coinAmount, give_action_index: '640',
            get_coin: 'DOGE', get_tick: tick, get_amount: tokenAmount, get_action_index: '641',
            status: 'pending_coinpay',
        }],
    };
}

function makeMessaging(rows, { chainId = CHAIN, getActionByIndex, getAddressBalances } = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [chainId]: [{ id: 'addr-1', address: PAYER, publicKey: '02ab', derivationPath: "m/44'/3'/0'/0/0" }],
        }),
        getCoinpayObligationsForAddress: vi.fn().mockResolvedValue(rows),
        getActionByIndex: getActionByIndex
            || vi.fn(({ actionIndex }) => Promise.resolve(matchDetail(actionIndex))),
        getSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm: vi.fn(),
        ...(getAddressBalances ? { getAddressBalances } : {}),
    };
}

// The value cell beside a label of the Payment section's one facts list.
function factValue(label) {
    return screen.getByText(label, { selector: 'dt' }).nextElementSibling;
}

function mount(props, messaging) {
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(CoinpayForm, { walletId: WALLET_ID, onBack: vi.fn(), ...props }),
    ));
    return messaging;
}

beforeEach(() => {
    for (const key of Object.keys(fiatRates)) delete fiatRates[key];
});
afterEach(() => cleanup());

describe('CoinpayForm opens one payment with no picker', () => {
    it('draws no Payments due card, list or selectable rows', async () => {
        mount({}, makeMessaging([obligation('648'), obligation('649', '2.5')]));
        await screen.findByRole('form', { name: 'Selected payment' });
        expect(screen.queryByText('Payments due')).toBeNull();
        expect(document.querySelector('ul')).toBeNull();
        expect(document.querySelector('[aria-pressed]')).toBeNull();
    });

    it('opens the payment due soonest when none is named, skipping an expired one', async () => {
        mount({}, makeMessaging([
            obligation('650', '1', now() + 9000),
            obligation('648', '10', now() - 60),
            obligation('649', '2.5', now() + 4000),
        ]));
        await screen.findByRole('form', { name: 'Selected payment' });
        expect(screen.getByText('Matched order').nextElementSibling.textContent).toBe('#649');
        expect(factValue('You pay').textContent).toMatch(/^2\.5 DOGE/);
    });

    it('keeps the pick on the chain the page was opened for', async () => {
        const messaging = makeMessaging([]);
        messaging.getAddressesByChain.mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: PAYER, publicKey: '02ab', derivationPath: "m/44'/3'/0'/0/0" }],
            [MAINNET]: [{ id: 'addr-2', address: 'Dmainnetpayer', publicKey: '02cd', derivationPath: "m/44'/3'/0'/0/1" }],
        });
        messaging.getCoinpayObligationsForAddress.mockImplementation(({ chainId }) => Promise.resolve(chainId === MAINNET
            ? [{ ...obligation('500', '1', now() + 4000), payer_address: 'Dmainnetpayer' }]
            : [obligation('648', '10', now() + 9000)]));
        mount({ chainId: CHAIN }, messaging);
        await screen.findByRole('form', { name: 'Selected payment' });
        expect(screen.getByText('Matched order').nextElementSibling.textContent).toBe('#648');
    });

    it('shows the scan failure, not "Payment not found", when part of the scan fails', async () => {
        const messaging = makeMessaging([]);
        messaging.getAddressesByChain.mockResolvedValue({
            [CHAIN]: [
                { id: 'addr-1', address: PAYER, publicKey: '02ab', derivationPath: "m/44'/3'/0'/0/0" },
                { id: 'addr-2', address: 'ndevmockdddddddddddddddddddddddd', publicKey: '02cd', derivationPath: "m/44'/3'/0'/0/1" },
            ],
        });
        messaging.getCoinpayObligationsForAddress.mockImplementation(({ address }) => (address === PAYER
            ? Promise.resolve([obligation('648')])
            : Promise.reject(new Error('Explorer returned HTTP 502'))));
        mount({ chainId: CHAIN, address: 'ndevmockdddddddddddddddddddddddd', orderMatchActionIndex: '700' }, messaging);
        await screen.findByText(/temporarily unavailable \(error 502\)/i);
        expect(screen.queryByText('Payment not found')).toBeNull();
    });

    it('says the named payment is gone instead of opening a different one', async () => {
        mount(
            { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '700' },
            makeMessaging([obligation('648')]),
        );
        await screen.findByText('Payment not found');
        expect(screen.queryByRole('form', { name: 'Selected payment' })).toBeNull();
    });
});

describe('CoinpayForm Payment section', () => {
    const named = { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' };

    it('shows one compact facts list: You pay, You get, Time left, Pay to, Matched order', async () => {
        // Rates exist, but a test network never shows fiat.
        fiatRates.DOGE = 0.25;
        fiatRates.PEPECASH = 0.001;
        mount(named, makeMessaging([obligation('648')]));
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(factValue('You get').textContent).toMatch(/1,000 PEPECASH$/));
        expect(factValue('You pay').textContent).toMatch(/10 DOGE$/);
        // Each amount carries its asset icon beside it.
        expect(factValue('You pay').querySelector('img, svg, [role="img"]')).not.toBeNull();
        expect(factValue('You get').querySelector('img, svg, [role="img"]')).not.toBeNull();
        // Read only, and no card boxes.
        const form = screen.getByRole('form', { name: 'Selected payment' });
        expect(screen.queryByRole('region', { name: 'You pay' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'You get' })).toBeNull();
        const dl = form.querySelector('dl[data-coinpay-facts]');
        expect(dl.querySelector('input, button')).toBeNull();
        const labels = [...dl.querySelectorAll('dt')].map((dt) => dt.textContent);
        expect(labels).toEqual(['You pay', 'You get', 'Time left', 'Pay to', 'Matched order']);
        expect(within(dl).getByText('Pay to').nextElementSibling.textContent).toContain(PAYEE.slice(0, 6));
        expect(within(dl).getByText('Matched order').nextElementSibling.textContent).toBe('#648');
        expect(within(dl).queryByText(/deadline/i)).toBeNull();
        // No fiat on a test network.
        expect(form.textContent).not.toMatch(/≈/);
    });

    it('puts a fiat line under each amount the wallet can price', async () => {
        fiatRates.DOGE = 0.25;
        fiatRates.PEPECASH = 0.001;
        mount(
            { chainId: MAINNET, address: PAYER, orderMatchActionIndex: '648' },
            makeMessaging([obligation('648')], { chainId: MAINNET }),
        );
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(factValue('You get').textContent).toMatch(/≈ \$1\.00$/));
        expect(factValue('You pay').textContent).toMatch(/≈ \$2\.50$/);
    });

    it('hides the fiat line of an asset with no price', async () => {
        fiatRates.DOGE = 0.25;
        mount(
            { chainId: MAINNET, address: PAYER, orderMatchActionIndex: '648' },
            makeMessaging([obligation('648')], { chainId: MAINNET }),
        );
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(factValue('You get').textContent).toMatch(/PEPECASH/));
        expect(factValue('You get').textContent).not.toMatch(/≈/);
        expect(factValue('You pay').textContent).toMatch(/≈ \$2\.50$/);
    });

    it('turns the Time left pill red under an hour', async () => {
        mount(named, makeMessaging([obligation('648', '10', now() + 1800)]));
        await screen.findByRole('form', { name: 'Selected payment' });
        const pill = screen.getByText('Time left').nextElementSibling.firstElementChild;
        expect(pill.textContent).toMatch(/^\d+m \d{2}s left$/);
        expect(pill.getAttribute('data-urgent')).toBe('true');
        expect(pill.className).toMatch(/pillUrgent/);
    });

    it('keeps the Time left pill calm with more than an hour left', async () => {
        mount(named, makeMessaging([obligation('648', '10', now() + 7200)]));
        await screen.findByRole('form', { name: 'Selected payment' });
        const pill = screen.getByText('Time left').nextElementSibling.firstElementChild;
        expect(pill.textContent).toMatch(/^[12]h \d{2}m left$/);
        expect(pill.getAttribute('data-urgent')).toBeNull();
        expect(pill.className).not.toMatch(/pillUrgent/);
    });

    it('marks an expired payment in the pill', async () => {
        mount(named, makeMessaging([obligation('648', '10', now() - 60)]));
        await screen.findByRole('form', { name: 'Selected payment' });
        expect(screen.getByText('Time left').nextElementSibling.textContent).toBe('Expired, do not pay');
    });

    it('shows You get loading while the match is read, with You pay and the rows already drawn', async () => {
        const held = new Promise(() => {});
        mount(named, makeMessaging([obligation('648')], { getActionByIndex: vi.fn(() => held) }));
        await screen.findByRole('form', { name: 'Selected payment' });
        const youGet = factValue('You get');
        expect(youGet.getAttribute('aria-busy')).toBe('true');
        expect(within(youGet).getByLabelText('Loading you get')).toBeInTheDocument();
        expect(factValue('You pay').textContent).toMatch(/10 DOGE/);
        expect(screen.getByText('Pay to')).toBeInTheDocument();
    });

    it('hides You get when the match read fails', async () => {
        const messaging = mount(named, makeMessaging([obligation('648')], {
            getActionByIndex: vi.fn(() => Promise.reject(new Error('Explorer returned HTTP 502'))),
        }));
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(messaging.getActionByIndex).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('You get', { selector: 'dt' })).toBeNull());
        expect(screen.getByText('You pay', { selector: 'dt' })).toBeInTheDocument();
    });

    it('hides You get rather than guess when the match does not fit this payment', async () => {
        const messaging = mount(named, makeMessaging([obligation('648')], {
            getActionByIndex: vi.fn(() => Promise.resolve(matchDetail('648', { coinAmount: '9' }))),
        }));
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(messaging.getActionByIndex).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('You get', { selector: 'dt' })).toBeNull());
    });
});

describe('CoinpayForm reads the match once per page load', () => {
    it.each([
        ['one payment due, named', [obligation('648')], { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' }],
        ['several payments due, named', [obligation('647'), obligation('648'), obligation('649')], { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' }],
        ['several payments due, none named', [obligation('647'), obligation('648'), obligation('649')], {}],
    ])('%s: one read, still one after Review and Back', async (_name, rows, props) => {
        const messaging = mount(props, makeMessaging(rows));
        await screen.findByRole('form', { name: 'Selected payment' });
        await waitFor(() => expect(factValue('You get').textContent).toMatch(/PEPECASH/));
        expect(messaging.getActionByIndex).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Pay Order' }));
        await screen.findByText('Review Payment');
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await screen.findByRole('form', { name: 'Selected payment' });
        expect(messaging.getActionByIndex).toHaveBeenCalledTimes(1);
        expect(messaging.getActionByIndex.mock.calls[0][0]).toEqual({
            chainId: CHAIN,
            actionIndex: props.orderMatchActionIndex || '647',
        });
    });
});

describe('CoinpayForm forward actions', () => {
    async function mountPrefilled() {
        mount(
            { chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' },
            makeMessaging([obligation('648')]),
        );
        return screen.findByRole('button', { name: 'Pay Order' });
    }

    it('names the form action "Pay Order" as a green button with an icon', async () => {
        const button = await mountPrefilled();
        expect(button.className).toMatch(/success/);
        expect(button.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('keeps Pay Order enabled and reports insufficient funds without composing', async () => {
        const messaging = makeMessaging([obligation('648')], {
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'DOGE', quantity: '1' },
            }),
        });
        mount({ chainId: CHAIN, address: PAYER, orderMatchActionIndex: '648' }, messaging);
        const button = await screen.findByRole('button', { name: 'Pay Order' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);

        expect(await screen.findByLabelText('Form errors')).toHaveTextContent('Insufficient DOGE balance.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    // The Wallet Form Standard puts Network and the paying address
    // in the From section at the top (its closed summary names the network,
    // as every form's From does), so the details list does not repeat them.
    it('puts the paying address in the From section and keeps the network out of the details', async () => {
        await mountPrefilled();
        const form = screen.getByRole('form', { name: 'Selected payment' });
        const from = within(form).getByRole('button', { name: /^From\b/ });
        expect(from).toHaveAttribute('aria-expanded', 'false');
        expect(within(form).getByLabelText('From address')).toHaveValue(PAYER);
        const dl = form.querySelector('dl');
        expect(within(dl).queryByText('From')).toBeNull();
        expect(within(dl).queryByText('Paying from')).toBeNull();
        expect(within(dl).queryByText('Network')).toBeNull();
        expect(dl.textContent).not.toMatch(/Dogecoin/i);
    });

    // The action is a verb only; the amount and ticker stay in the rows above it.
    it('names the review action Pay, green, with an icon and no amount', async () => {
        const button = await mountPrefilled();
        fireEvent.click(button);
        // Page titles are Title Case.
        await screen.findByText('Review Payment');
        const pay = await screen.findByRole('button', { name: 'Pay' });
        expect(pay.textContent).not.toMatch(/DOGE|\d/);
        expect(pay.className).toMatch(/success/);
        expect(pay.querySelector('svg')).not.toBeNull();
        const network = screen.getByText('Network').nextElementSibling;
        expect(network.textContent).not.toMatch(/Dogecoin/i);
        expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
    });
});
