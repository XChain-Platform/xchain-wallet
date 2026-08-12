// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (wallet E2E D-86): Pay dividend's Max dropped the WHOLE balance
// into the per-unit field. On S19MINT (500 units, one eligible holder)
// with 4,999 XCHAIN to pay out, Max filled 4,999 and the form's own
// summary then read "total distribution ~2,499,500 XCHAIN" - 500x the
// balance - with the submit button still live. The wrong DIMENSION, not
// merely the wrong quantity: a total pasted into a rate.
//
// These drive the real component. The number Max fills must be a rate the
// balance can actually pay, and a hand-typed over-payout must stop at the
// form rather than three screens later behind a "sign anyway" tick.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
const HOLDER = 'bc1qholderholderholderholderholderholder0';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: SOURCE,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

// Wallet balances arrive base-scaled; the form's balance lookup divides
// by divisibility, so the mock has to hand over the same shape the host
// does rather than a display string.
function baseUnits(decimalAmount, divisibility = 8) {
    const [int = '0', frac = ''] = String(decimalAmount).split('.');
    return `${int}${frac.padEnd(divisibility, '0')}`.replace(/^0+(?=\d)/, '');
}

/**
 * @param {object} opts
 * @param {string} [opts.balance]        XCHAIN the source address holds
 * @param {Array}  [opts.holders]        explorer holder rows for S19MINT
 * @param {number} [opts.divisibility]   divisibility of the DIVIDEND token
 */
function mountDividend({
    balance = '4999',
    holders = [{ address: HOLDER, amount: '500' }],
    divisibility = 8,
} = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getHoldersForToken: vi.fn().mockResolvedValue({
            tick: 'S19MINT', total: holders.length, data: holders,
        }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'XCHAIN', divisibility, locks: {},
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'XCHAIN', quantity: baseUnits(balance), divisibility: 8 },
                        { tick: 'S19MINT', quantity: '500', divisibility: 0 },
                    ],
                },
            }],
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        dividendAction: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DividendForm, {
                walletId: 'w',
                initialChainId: CHAIN,
                initialTick: 'S19MINT',
                onBack() {},
            }),
        ),
    );
    return messaging;
}

// The dividend ticker is only settable through the shared TokenPicker, so
// every case opens it and takes the XCHAIN row, exactly as a user does.
async function pickDividendToken() {
    fireEvent.click(await screen.findByRole('button', { name: /Dividend token/i }));
    const row = await waitFor(() => {
        const hit = Array.from(document.querySelectorAll('button'))
            .find((b) => (b.textContent || '').includes('XCHAIN'));
        if (!hit) throw new Error('no XCHAIN row in the token picker');
        return hit;
    }, { timeout: 3000 });
    fireEvent.click(row);
}

const amountField = () => screen.findByLabelText(/^Per-unit amount/);
const maxButton = () => screen.getByRole('button', { name: /max available/i });
// Hidden Max and inert Max are both acceptable; a LIVE Max on an
// uncomputable rate is not.
const maxButtonOrNull = () => screen.queryByRole('button', { name: /max available/i });
const submitButton = () => screen.getByRole('button', { name: /^(Pay dividend|Preview)$/ });

// The summary line is assembled from several JSX expressions inside one
// paragraph, so its text lands in separate DOM text nodes; match against
// the rendered text as a whole.
const expectText = (re, timeout = 3000) => waitFor(
    () => expect(document.body.textContent).toMatch(re),
    { timeout },
);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DividendForm Max fills a rate, not the balance', () => {
    it('fills balance / eligible units, not the whole balance', async () => {
        mountDividend();
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(maxButton());
        // 4,999 XCHAIN across 500 units = 9.998 per unit. The old, wrong
        // number was the balance itself.
        await waitFor(async () => expect((await amountField()).value).toBe('9.998'));
        expect((await amountField()).value).not.toBe('4,999');
    });

    it('quotes a total distribution the balance can actually pay', async () => {
        mountDividend();
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(maxButton());
        // The form's own summary line: 9.998 x 500 = 4,999, the balance.
        // It used to read ~2,499,500 off the same click.
        await expectText(/total distribution ~4,999 XCHAIN/);
        expect(document.body.textContent).not.toMatch(/2,499,500/);
    });

    it('names the per-unit ceiling next to the available balance', async () => {
        mountDividend();
        await pickDividendToken();
        await expectText(/4,999 XCHAIN available · up to 9\.998 per unit/);
    });

    it('floors the rate to the dividend token divisibility', async () => {
        // An indivisible dividend token cannot be paid at 3.33333333 per
        // unit, so the ceiling is a whole number.
        mountDividend({
            balance: '10',
            holders: [{ address: HOLDER, amount: '3' }],
            divisibility: 0,
        });
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(maxButton());
        await waitFor(async () => expect((await amountField()).value).toBe('3'));
    });

    it('excludes the source address from the divisor, as the payout does', async () => {
        // DIVIDEND.md: the source address receives nothing, so its own
        // units must not inflate the divisor and shrink the rate.
        mountDividend({
            holders: [
                { address: HOLDER, amount: '500' },
                { address: SOURCE, amount: '4500' },
            ],
        });
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.click(maxButton());
        await waitFor(async () => expect((await amountField()).value).toBe('9.998'));
    });

    it('offers no Max when nobody is eligible to receive', async () => {
        mountDividend({ holders: [{ address: SOURCE, amount: '500' }] });
        await pickDividendToken();
        await expectText(/0 eligible holders/);
        const max = maxButtonOrNull();
        expect(max === null || max.disabled).toBe(true);
        expect((await amountField()).value).toBe('');
    });

    it('blocks a hand-typed over-payout at the form, before composing', async () => {
        const messaging = mountDividend();
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.change(await amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This pays ~2,499,500 XCHAIN in total, more than the 4,999 XCHAIN this address holds.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets a payable rate through to composing', async () => {
        const messaging = mountDividend();
        await pickDividendToken();
        await waitFor(() => expect(maxButton().disabled).toBe(false), { timeout: 3000 });
        fireEvent.change(await amountField(), { target: { value: '9.998' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });
    });

    it('stays ungated when the holder list cannot be read', async () => {
        // An explorer hiccup must not block every dividend; the confirm
        // page's preflight is still behind it.
        const messaging = mountDividend();
        messaging.getHoldersForToken.mockRejectedValue(new Error('explorer down'));
        cleanup();
        __clearTokenInfoCache();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DividendForm, {
                    walletId: 'w',
                    initialChainId: CHAIN,
                    initialTick: 'S19MINT',
                    onBack() {},
                }),
            ),
        );
        await pickDividendToken();
        fireEvent.change(await amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });
    });
});
