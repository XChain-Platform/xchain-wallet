// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for the Token Creation Wizard's native-coin fee
// toggle. The render guard (routes-render) only proves the wizard mounts;
// this drives the full template -> chain -> details -> confirm flow and
// asserts the opt-in actually threads `payFeeInNativeCoin` into BOTH the
// host-side compose (so the previewed PSBT already carries the native-fee
// output) and the messaging.issueToken submit payload. Mirrors the
// per-form toggle that shipped on the standalone
// Issue/Dispenser/Swap/Order/Advanced forms.
//
// The wizard's own preview + sign stages were replaced by the
// shared confirm page, so the drive ends on that page.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
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

// Drive template -> chain -> details (meme: name + supply) -> review -> confirm.
// `nativeFee` flips the toggle on the details stage when true.
async function driveToConfirm({ nativeFee }) {
    fireEvent.click(await screen.findByText('Meme token'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
        target: { value: 'MEMECOIN' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), {
        target: { value: '1000' },
    });
    if (nativeFee) fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Review token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
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

describe('TokenWizard native-coin fee toggle', () => {
    it('shows network and protocol costs in the selected fiat currency before approval', async () => {
        mountWizard();

        fireEvent.click(await screen.findByText('Meme token'));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'MEMECOIN' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review token' }));

        const reviewFee = screen.getByText('Network fee').nextElementSibling;
        await waitFor(() => expect(reviewFee).toHaveTextContent(/BTC.*€.*EUR/));

        fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
        await screen.findByTestId('confirm-modal');
        await waitFor(() => {
            expect(screen.getByTestId('confirm-fee')).toHaveTextContent(/0\.00001 BTC.*€0\.50 EUR/);
            expect(screen.getByTestId('confirm-protocol-fee')).toHaveTextContent(/0\.5 XCHAIN.*€0\.20 EUR/);
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
