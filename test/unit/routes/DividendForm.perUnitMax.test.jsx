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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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
    walletMode = 'full',
    feeQuote = { supported: true, valid: true, xchainFee: '0.00000000' },
} = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getHoldersForToken: vi.fn().mockResolvedValue({
            tick: 'S19MINT', total: holders.length, data: holders,
        }),
        // creator/totalSupply mark this as a resolved, real token so the
        // dividend-ticker existence check (DividendForm.tickChecks) reads it
        // as found, not as an empty "no such token" record.
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'XCHAIN', creator: '1xchainCreatorAddr', totalSupply: '10000',
            divisibility, locks: {},
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
        requoteNativeFee: vi.fn().mockResolvedValue(feeQuote),
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
    await flushTimers();
    fireEvent.click(screen.getByRole('button', { name: /Dividend token/i }));
    await flushTimers();
    const row = Array.from(document.querySelectorAll('button'))
        .find((button) => (button.textContent || '').includes('XCHAIN'));
    if (!row) throw new Error('no XCHAIN row in the token picker');
    fireEvent.click(row);
}

const amountField = () => screen.getByLabelText(/^Per-unit amount/);
const maxButton = () => screen.getByRole('button', { name: /max available/i });
// Hidden Max and inert Max are both acceptable; a LIVE Max on an
// uncomputable rate is not.
const maxButtonOrNull = () => screen.queryByRole('button', { name: /max available/i });
const submitButton = () => screen.getByRole('button', { name: /^(Pay dividend|Preview)$/ });

// The summary line is assembled from several JSX expressions inside one
// paragraph, so its text lands in separate DOM text nodes; match against
// the rendered text as a whole.
async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
}

const maxReady = async () => {
    await flushTimers();
    expect(maxButton().disabled).toBe(false);
};

const expectText = async (re) => {
    await flushTimers();
    expect(document.body.textContent).toMatch(re);
};

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('DividendForm Max fills a rate, not the balance', () => {
    it('fills balance / eligible units, not the whole balance', async () => {
        mountDividend();
        await pickDividendToken();
        await maxReady();
        fireEvent.click(maxButton());
        // 4,999 XCHAIN across 500 units = 9.998 per unit. The old, wrong
        // number was the balance itself.
        expect(amountField().value).toBe('9.998');
        expect(amountField().value).not.toBe('4,999');
    });

    it('quotes a total distribution the balance can actually pay', async () => {
        mountDividend();
        await pickDividendToken();
        await maxReady();
        fireEvent.click(maxButton());
        // The form's own summary line: 9.998 x 500 = 4,999, the balance.
        // It used to read ~2,499,500 off the same click.
        await expectText(/total distribution ~4,999 XCHAIN/);
        expect(document.body.textContent).not.toMatch(/2,499,500/);
    });

    it('keeps the live total token cost identical on watcher review', async () => {
        mountDividend({
            walletMode: 'watcher',
            feeQuote: {
                supported: true,
                valid: true,
                xchainFee: '1.00000000',
                requiredFeeNative: '0.00002',
            },
        });
        await pickDividendToken();
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/Total token cost ~501 XCHAIN/);

        fireEvent.change(amountField(), { target: { value: '2' } });
        await expectText(/Total token cost ~1,001 XCHAIN/);
        fireEvent.click(submitButton());

        const reviewTotal = screen.getByTestId('dividend-review-total-cost');
        expect(reviewTotal).toHaveTextContent('~1,001 XCHAIN');
        expect(screen.getByRole('form', { name: 'Review dividend' }))
            .not.toHaveTextContent('~501 XCHAIN');
    });

    it('carries the latest live total token cost into the full signing review', async () => {
        mountDividend({
            feeQuote: {
                supported: true,
                valid: true,
                xchainFee: '1.00000000',
                requiredFeeNative: '0.00002',
            },
        });
        await pickDividendToken();
        fireEvent.change(amountField(), { target: { value: '1' } });
        await expectText(/Total token cost ~501 XCHAIN/);

        fireEvent.change(amountField(), { target: { value: '2' } });
        await expectText(/Total token cost ~1,001 XCHAIN/);
        fireEvent.click(submitButton());
        await flushTimers();

        expect(screen.getByTestId('confirm-total'))
            .toHaveTextContent('Total token cost: ~1,001 XCHAIN');
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
        await maxReady();
        fireEvent.click(maxButton());
        expect(amountField().value).toBe('3');
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
        await maxReady();
        fireEvent.click(maxButton());
        expect(amountField().value).toBe('9.998');
    });

    it('offers no Max when nobody is eligible to receive', async () => {
        mountDividend({ holders: [{ address: SOURCE, amount: '500' }] });
        await pickDividendToken();
        await expectText(/0 eligible holders/);
        const max = maxButtonOrNull();
        expect(max === null || max.disabled).toBe(true);
        expect(amountField().value).toBe('');
    });

    it('blocks a hand-typed over-payout at the form, before composing', async () => {
        const messaging = mountDividend();
        await pickDividendToken();
        await maxReady();
        fireEvent.change(amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        expect(screen.getByRole('alert')).toHaveTextContent(
            'This pays ~2,499,500 XCHAIN in total, more than the 4,999 XCHAIN this address holds.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('includes an XCHAIN protocol fee in total cost and the balance refusal', async () => {
        const messaging = mountDividend({
            feeQuote: {
                supported: true,
                valid: true,
                xchainFee: '1.00000000',
                requiredFeeNative: '0.00002',
            },
        });
        await pickDividendToken();
        fireEvent.change(amountField(), { target: { value: '9.998' } });
        await flushTimers();

        const cost = screen.getByTestId('dividend-cost-preview');
        expect(cost.textContent).toContain('Total token cost ~5,000 XCHAIN');
        expect(cost.textContent).toContain('includes 1 XCHAIN protocol fee');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Total token cost is ~5,000 XCHAIN: 4,999 payout + 1 protocol fee, but this address holds 4,999 XCHAIN.',
        );

        fireEvent.click(submitButton());
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.requoteNativeFee).toHaveBeenCalledWith({
            chainId: CHAIN,
            source: SOURCE,
            actionString: 'DIVIDEND|0|S19MINT|XCHAIN|9.998',
        });
    });

    it('does not count holder shares whose individually rounded payout is zero', async () => {
        mountDividend({
            holders: [
                { address: HOLDER, amount: '0.5' },
                { address: 'bc1qsecondholder000000000000000000000', amount: '0.5' },
            ],
            divisibility: 0,
        });
        await pickDividendToken();
        fireEvent.change(await amountField(), { target: { value: '0.5' } });
        await expectText(/0 eligible holders/);
        expect(document.body.textContent).not.toMatch(/2 eligible holders/);
        await expectText(/total distribution ~0 XCHAIN/);
    });

    it('keeps a fractional indivisible-token payout out of review', async () => {
        const messaging = mountDividend({
            balance: '10',
            holders: [{ address: HOLDER, amount: '3' }],
            divisibility: 0,
        });
        await pickDividendToken();
        fireEvent.change(amountField(), { target: { value: '1.5' } });
        fireEvent.click(submitButton());
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Per-unit amount must be a whole number because XCHAIN is indivisible.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets a payable rate through to composing', async () => {
        const messaging = mountDividend();
        await pickDividendToken();
        await maxReady();
        fireEvent.change(amountField(), { target: { value: '9.998' } });
        fireEvent.click(submitButton());
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalled();
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params).toEqual({
            VERSION: '0', TICK: 'S19MINT', DIVIDEND_TICK: 'XCHAIN', AMOUNT: '9.998',
        });
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
        fireEvent.change(amountField(), { target: { value: '4999' } });
        fireEvent.click(submitButton());
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalled();
    });
});

describe('DividendForm review hint', () => {
    it('names the payout token and the fee in plain words', async () => {
        // Only a watcher wallet stops on the in-form review step before encoding.
        mountDividend({ walletMode: 'watcher' });
        await pickDividendToken();
        await maxReady();
        fireEvent.change(amountField(), { target: { value: '9.998' } });
        fireEvent.click(submitButton());
        await flushTimers();
        const hint = screen.getByTestId('dividend-review-fee-hint');
        expect(hint.textContent).toMatch(/holds enough XCHAIN\s+to cover the full payout/);
        expect(hint.textContent).toMatch(/grows with the number\s+of holders paid/);
        expect(hint.textContent).not.toMatch(/§|database hits|DIVIDEND ticker|DIVIDEND charges/);
    });
});
