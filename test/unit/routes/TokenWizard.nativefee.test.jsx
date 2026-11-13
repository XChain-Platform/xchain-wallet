// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for the Create a token route's native-coin fee toggle
// (the Network fee section of the one Issue Token form). The render guard
// (routes-render) only proves the route mounts; this drives the form to the
// shared confirm page and asserts the opt-in actually threads
// `payFeeInNativeCoin` into BOTH the host-side compose (so the previewed PSBT
// already carries the native-fee output) and the messaging.issueToken submit
// payload, and that both fees are shown in the chosen fiat before approval.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../../packages/core/src/flows/priceLookup.js';

// One HD address on Bitcoin mainnet so the wizard auto-picks a fee-payer
// and the native-coin toggle resolves a coin ticker (BTC).
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

let issueToken;
let composeForConfirm;

const NOW = Date.parse('2026-10-13T12:00:00Z');
const FRESH_TS = Math.floor(NOW / 1000) - 60;

function configurePrices() {
    configureFiatRateSource({
        now: () => NOW,
        explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        fetch: vi.fn(async (url) => {
            if (url.includes('api.coingecko.com')) {
                return { ok: true, json: async () => ({ bitcoin: { eur: 50000 } }) };
            }
            if (url.includes('/api/market/XCHAIN/BTC')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [{
                            tick1: 'XCHAIN', tick2: 'BTC', tick1_price: '0.000008',
                            tick2_price: '125000', last_updated: FRESH_TS,
                        }],
                    }),
                };
            }
            return { ok: true, json: async () => ({ data: [] }) };
        }),
    });
}

function mountWizard() {
    issueToken = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        chainId: 'bitcoin-mainnet', networkFeeSats: 1000, xchainFee: '0.5',
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', fiatCurrency: 'EUR' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken,
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

// The Network fee section, opened (it starts closed).
function openFeeSection() {
    const header = screen.getByRole('button', { name: /^Network fee/ });
    if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
    return header.closest('[data-form-section]');
}

// Meme template, ticker and supply, then Issue Token -> confirm page.
// `nativeFee` flips the Network fee section's toggle when true.
async function driveToConfirm({ nativeFee }) {
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: /Meme token/ }));
    fireEvent.change(screen.getByLabelText('Ticker'), {
        target: { value: 'MEMECOIN' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), {
        target: { value: '1000' },
    });
    if (nativeFee) {
        openFeeSection();
        fireEvent.click(screen.getByRole('switch', { name: 'Pay protocol fee in BTC' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
    // The confirm page opens once compose + pre-flight resolve.
    await screen.findByTestId('confirm-modal');
}

beforeEach(() => {
    _resetPriceLookupForTests();
    configurePrices();
    issueToken = undefined;
});
afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
});

describe('Issue Token native-coin fee toggle', () => {
    it('shows network and protocol costs in the selected fiat currency before approval', async () => {
        mountWizard();

        fireEvent.change(await screen.findByLabelText('Ticker'), {
            target: { value: 'MEMECOIN' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });

        // The Network fee section prices the broadcast in the chosen fiat
        // before anything is composed.
        const feeSection = openFeeSection();
        await waitFor(() => expect(within(feeSection).getAllByText(/~€/).length).toBeGreaterThan(0));
        expect(feeSection.textContent).toMatch(/BTC/);

        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
        await screen.findByTestId('confirm-modal');
        await waitFor(() => {
            expect(screen.getByTestId('confirm-fee')).toHaveTextContent(/0\.00001 BTC.*~€0\.50/);
            expect(screen.getByTestId('confirm-protocol-fee')).toHaveTextContent(/0\.5 XCHAIN.*~€0\.20/);
        });
    });

    it('threads payFeeInNativeCoin: true into the issueToken submit when toggled on', async () => {
        mountWizard();
        await driveToConfirm({ nativeFee: true });

        // The flag reaches the host-side compose, so the PSBT the user
        // approves already carries the native-fee output.
        expect(composeForConfirm.mock.calls[0][0].encoderOpts.payFeeInNativeCoin).toBe(true);

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'pw' },
        });
        fireEvent.click(screen.getByTestId('confirm-approve'));

        await waitFor(() => expect(issueToken).toHaveBeenCalledTimes(1));
        expect(issueToken.mock.calls[0][0].payFeeInNativeCoin).toBe(true);
        expect(issueToken.mock.calls[0][0].prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
    });

    it('omits the flag (undefined, not false) when the toggle is left off', async () => {
        mountWizard();
        await driveToConfirm({ nativeFee: false });

        // No toggle => the flag is omitted (undefined), never sent as false.
        expect(composeForConfirm.mock.calls[0][0].encoderOpts.payFeeInNativeCoin)
            .toBeUndefined();

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'pw' },
        });
        fireEvent.click(screen.getByTestId('confirm-approve'));

        await waitFor(() => expect(issueToken).toHaveBeenCalledTimes(1));
        expect(issueToken.mock.calls[0][0].payFeeInNativeCoin).toBeUndefined();
    });
});
