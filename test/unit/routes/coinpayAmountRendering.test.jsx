// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A CoinPay obligation's coin_amount is the explorer's decimal COIN figure
// ("10" for ten coins). Several surfaces show it to the user before they
// sign:
//
//   - the Payments-due queue (ObligationsView), which read a bare integer as
//     base units and offered "Pay 0.0000001 DOGE" for a 10 DOGE debt;
//   - the Pay screen (CoinpayForm), whose confirm and review stages printed
//     the BASE-unit figure beside the ticker: "10 DOGE" for a ten-coin debt
//     only by coincidence, "1050000000 DOGE" for 10.5;
//   - the same screen's obligation picker card (now its You pay card), which
//     echoed coin_amount verbatim rather than through the canonical reader,
//     so a figure with trailing zeros ("10.500000") never got normalized;
//   - Home's own "Payment due" resume card, which named the debt with no
//     ticker at all ("pay 0.5" - 0.5 what?).
//
// All four now render the debt in coins with its ticker.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';
import { CoinpayForm } from '../../../packages/core/src/shared/routes/CoinpayForm.jsx';
import { buildPendingNoticeAlerts } from '../../../packages/core/src/shared/walletAlerts.js';

const WALLET_ID = 'wallet-a';
const CHAIN = 'dogecoin-testnet';
const PAYER = 'ndevmockaaaaaaaaaaaaaaaaaaaaaaaa';
const PAYEE = 'ndevmockbbbbbbbbbbbbbbbbbbbbbbbb';

function obligation(coinAmount, actionIndex = '648') {
    return {
        coinpay_status: 'pending_coinpay',
        payer_address: PAYER,
        payee_address: PAYEE,
        action_index: actionIndex,
        coin_amount: coinAmount,
        expiration: String(Math.floor(Date.now() / 1000) + 3600),
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

function mount(element, messaging) {
    render(React.createElement(MessagingProvider, { shell: 'web', messaging }, element));
}

afterEach(() => cleanup());

describe('ObligationsView: the Payments-due card shows the debt in coins', () => {
    it('shows a scan failure instead of claiming there are no payments due', async () => {
        const messaging = makeMessaging([]);
        messaging.getCoinpayObligationsForAddress.mockRejectedValue(new Error('Explorer unavailable'));
        mount(
            React.createElement(ObligationsView, { walletId: WALLET_ID, onPay: vi.fn(), onBack: vi.fn() }),
            messaging,
        );

        await screen.findByText("Couldn't load payments due. Check your connection and try again.");
        expect(screen.queryByText('No payments due')).toBeNull();
    });

    it('[REGRESSION] renders "10 DOGE" for coin_amount "10", not 0.0000001', async () => {
        mount(
            React.createElement(ObligationsView, { walletId: WALLET_ID, onPay: vi.fn(), onBack: vi.fn() }),
            makeMessaging([obligation('10')]),
        );
        await screen.findByText(/\b10 DOGE\b/);
        expect(screen.queryByText(/0\.0000001/)).toBeNull();
    });

    it('renders "10.5 DOGE" for coin_amount "10.5"', async () => {
        mount(
            React.createElement(ObligationsView, { walletId: WALLET_ID, onPay: vi.fn(), onBack: vi.fn() }),
            makeMessaging([obligation('10.5')]),
        );
        await screen.findByText(/\b10\.5 DOGE\b/);
    });
});

describe('CoinpayForm: confirm and review stages show the debt in coins', () => {
    async function mountPrefilled(coinAmount) {
        mount(
            React.createElement(CoinpayForm, {
                walletId: WALLET_ID,
                chainId: CHAIN,
                address: PAYER,
                orderMatchActionIndex: '648',
                onBack: vi.fn(),
            }),
            makeMessaging([obligation(coinAmount)]),
        );
        // The prefilled obligation lands on the confirm stage with a Pay order button.
        return screen.findByRole('button', { name: 'Pay Order' });
    }

    it('[REGRESSION] "10" reads as 10 DOGE on confirm and on review, never 1000000000 DOGE', async () => {
        const review = await mountPrefilled('10');
        // The You pay card states ten coins beside the DOGE ticker.
        const youPay = screen.getByText('You pay', { selector: 'dt' }).nextElementSibling;
        expect(youPay.textContent).toMatch(/^10 DOGE/);
        expect(screen.queryByText(/1000000000/)).toBeNull();

        fireEvent.click(review);
        await screen.findByText('Review Payment');
        expect(screen.getByText('648')).toBeInTheDocument();
        expect(screen.getAllByText(/\b10 DOGE\b/).length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText(/1000000000/)).toBeNull();
        expect(screen.queryByText(/base units/)).toBeNull();
    });

    it('[REGRESSION] "10.5" reads as 10.5 DOGE on review, not 1050000000 DOGE', async () => {
        const review = await mountPrefilled('10.5');
        fireEvent.click(review);
        await screen.findByText('Review Payment');
        expect(screen.getByText('648')).toBeInTheDocument();
        expect(screen.getAllByText(/\b10\.5 DOGE\b/).length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText(/1050000000/)).toBeNull();
    });

    it('[REGRESSION] the You pay card normalizes the figure like the review stage does, not the raw string', async () => {
        // No orderMatchActionIndex prefilled: the page opens the payment due
        // soonest, and its You pay card reads the amount through the canonical reader.
        mount(
            React.createElement(CoinpayForm, { walletId: WALLET_ID, chainId: CHAIN, onBack: vi.fn() }),
            makeMessaging([obligation('10.500000', '900')]),
        );
        const youPay = (await screen.findByText('You pay', { selector: 'dt' })).nextElementSibling;
        expect(youPay.textContent).toMatch(/^10\.5 DOGE/);
        expect(screen.queryByText(/10\.500000/)).toBeNull();
    });
});

describe('Home: the Payment due resume card names the ticker', () => {
    const ADDR = 'nHomePayerFixture00000000000000000';

    it('[REGRESSION] names the chain ticker beside the debt, not a bare number', () => {
        // The payment-due item now lives behind the header bell, so the ticker is
        // pinned on the notification item Home's card used to carry.
        const [item] = buildPendingNoticeAlerts({
            pendingCoinpays: [{ chainId: CHAIN, orderMatchActionIndex: '648', coinAmount: '10', address: ADDR }],
        }, { onResumeCoinpay: vi.fn() });
        // The row's short title names the coin beside the figure; the order
        // sits on the message line (alertCopy.js three-line copy).
        expect(item.label).toBe('Payment due');
        expect(item.title).toBe('Pay 10 DOGE');
        expect(item.message).toBe('Order #648: sign to pay');
    });
});
