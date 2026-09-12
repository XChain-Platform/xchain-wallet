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
// ("10" for ten coins). Two surfaces show it to the user before they sign:
//
//   - the Payments-due queue (ObligationsView), which read a bare integer as
//     base units and offered "Pay 0.0000001 DOGE" for a 10 DOGE debt;
//   - the Pay screen (CoinpayForm), whose confirm and review stages printed
//     the BASE-unit figure beside the ticker: "10 DOGE" for a ten-coin debt
//     only by coincidence, "1050000000 DOGE" for 10.5.
//
// Both now render the same coin-scale label for the same row.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ObligationsView } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';
import { CoinpayForm } from '../../../packages/core/src/shared/routes/CoinpayForm.jsx';

const WALLET_ID = 'wallet-a';
const CHAIN = 'dogecoin-testnet';
const PAYER = 'nPayerAddressFixture00000000000000';
const PAYEE = 'nPayeeAddressFixture00000000000000';

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
        // The prefilled obligation lands on the confirm stage with a Review button.
        return screen.findByRole('button', { name: 'Review' });
    }

    it('[REGRESSION] "10" reads as 10 DOGE on confirm and on review, never 1000000000 DOGE', async () => {
        const review = await mountPrefilled('10');
        // The picker card carries the raw figure and the AMOUNT row the label;
        // both say ten coins.
        expect(screen.getAllByText(/\b10 DOGE\b/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/1000000000/)).toBeNull();

        fireEvent.click(review);
        await screen.findByText(/Pay 10 DOGE to complete matched order #648/);
        expect(screen.getAllByText(/\b10 DOGE\b/).length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText(/1000000000/)).toBeNull();
        expect(screen.queryByText(/base units/)).toBeNull();
    });

    it('[REGRESSION] "10.5" reads as 10.5 DOGE on review, not 1050000000 DOGE', async () => {
        const review = await mountPrefilled('10.5');
        fireEvent.click(review);
        await screen.findByText(/Pay 10\.5 DOGE to complete matched order #648/);
        expect(screen.getAllByText(/\b10\.5 DOGE\b/).length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText(/1050000000/)).toBeNull();
    });
});
