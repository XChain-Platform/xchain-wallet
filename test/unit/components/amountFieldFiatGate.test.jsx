// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The other half. `fiatRateForTick` returns null for a token, and the
// whole fix rests on null meaning "render no fiat at all" in AmountField. That
// contract is documented in a JSDoc line and nowhere else, so it is pinned here:
// if a future edit made a null rate render "≈ 0.00 USD" or kept the unit toggle
// alive, the gate would go on returning null and the wrong number would come
// back with no test failing anywhere.

import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';

const RATE = { rate: 67000, fiatCurrency: 'USD' };

beforeAll(() => {
    registerLocale('de-DE', {});
    registerLocale('fr-FR', {});
    registerLocale('hi-IN', {});
});

afterEach(async () => {
    await setLocale('en');
});

function mount(props) {
    return render(React.createElement(AmountField, {
        amount: '2',
        tick: 'BTC',
        onAmountFieldChange() {},
        toggleAmountInputMode() {},
        amountInputMode: 'coin',
        ...props,
    }));
}

describe('AmountField fiat gate', () => {
    it('shows the approximate value and the unit toggle when a rate is supplied', () => {
        const u = mount({ fiatRate: RATE });
        expect(u.getByRole('button', { name: /switch input to usd/i })).toBeTruthy();
        expect(u.container.textContent).toMatch(/≈\s*\$134,000\.00 USD/);
    });

    it('formats the preview in the selected fiat currency', () => {
        const u = mount({ fiatRate: { rate: 50000, fiatCurrency: 'EUR' } });
        expect(u.getByRole('button', { name: /switch input to eur/i })).toBeTruthy();
        expect(u.container.textContent).toMatch(/≈\s*€100,000\.00 EUR/);
        expect(u.container.textContent).not.toContain('$');
    });

    it('keeps a fiat preview above the safe integer boundary exact', () => {
        const u = mount({
            amount: '9007199254740993.01',
            fiatRate: { rate: 1, fiatCurrency: 'USD' },
        });
        expect(u.container.textContent)
            .toContain('≈ $9,007,199,254,740,993.01 USD');
    });

    it('labels a token conversion sourced from a DEX market', () => {
        const u = mount({
            tick: 'PEPECASH',
            fiatRate: { rate: 0.02, fiatCurrency: 'USD', source: 'market' },
        });
        expect(u.container.textContent).toMatch(/≈\s*\$0\.04 USD · DEX price/);
    });

    // What a token amount must look like: no number, no toggle, nothing to
    // misread as a valuation.
    it('renders no fiat preview and no toggle when the rate is null', () => {
        const u = mount({ fiatRate: null, tick: 'XCHAIN', amount: '50000' });
        expect(u.queryByRole('button', { name: /switch input to/i })).toBeNull();
        expect(u.container.textContent).not.toMatch(/≈/);
        expect(u.container.textContent).not.toMatch(/USD/);
    });

    // Belt and braces: even if a stale 'fiat' input mode survives the switch to
    // a token, a null rate must not resurrect the fiat rendering.
    it('ignores a stale fiat input mode when the rate is null', () => {
        const u = mount({
            fiatRate: null, tick: 'XCHAIN', amount: '50000',
            fiatAmount: '999', amountInputMode: 'fiat',
        });
        expect(u.container.textContent).not.toMatch(/≈/);
        expect(u.queryByRole('button', { name: /switch input to/i })).toBeNull();
    });
});

describe('AmountField input contract', () => {
    it('switches display modes without replacing the canonical coin value', () => {
        const toggleAmountInputMode = vi.fn();
        const props = {
            amount: '2',
            fiatAmount: '134000.00',
            tick: 'BTC',
            fiatRate: RATE,
            onAmountFieldChange() {},
            toggleAmountInputMode,
        };
        const u = render(<AmountField {...props} amountInputMode="coin" />);

        expect(u.getByRole('textbox', { name: 'Amount (BTC)' })).toHaveValue('2');
        fireEvent.click(u.getByRole('button', { name: 'Switch input to USD' }));
        expect(toggleAmountInputMode).toHaveBeenCalledOnce();

        u.rerender(<AmountField {...props} amountInputMode="fiat" />);
        expect(u.getByRole('textbox', { name: 'Amount (USD)' })).toHaveValue('134,000.00');
        expect(u.container.textContent).toMatch(/≈\s*2 BTC/);

        u.rerender(<AmountField {...props} amountInputMode="coin" />);
        expect(u.getByRole('textbox', { name: 'Amount (BTC)' })).toHaveValue('2');
    });

    it.each([
        ['grouped amount', '1 234,567.89', {}, '1234567.89'],
        ['trailing ticker', '0.5 BTC', {}, '0.5'],
        ['fiat sign', '$1,234.56', {
            amountInputMode: 'fiat',
            fiatAmount: '',
            fiatRate: RATE,
        }, '1234.56'],
    ])('normalizes a pasted %s', (_label, pasted, props, expected) => {
        const onAmountFieldChange = vi.fn();
        const u = mount({ amount: '', onAmountFieldChange, ...props });
        const input = u.getByRole('textbox');

        fireEvent.change(input, {
            target: { value: pasted, selectionStart: pasted.length },
        });

        expect(onAmountFieldChange).toHaveBeenCalledWith(expected, expected.length);
    });

    it.each([
        ['malformed spaced grouping', '1 23', {}],
        ['another ticker', '0.5 ETH', {}],
        ['fiat sign in coin mode', '$10', {}],
        ['wrong fiat sign', '€10', {
            amountInputMode: 'fiat',
            fiatAmount: '',
            fiatRate: RATE,
        }],
    ])('refuses a pasted %s with a plain message', (_label, pasted, props) => {
        const onAmountFieldChange = vi.fn();
        const u = mount({ amount: '', onAmountFieldChange, ...props });

        fireEvent.change(u.getByRole('textbox'), {
            target: { value: pasted, selectionStart: pasted.length },
        });

        expect(onAmountFieldChange).not.toHaveBeenCalled();
        expect(u.getByRole('alert')).toHaveTextContent('Enter a valid decimal amount');
    });

    it.each([
        ['de-DE', '12,34,567.89', '1.234.567,89'],
        ['fr-FR', '1.234.567,89', '1\u202f234\u202f567,89'],
        ['hi-IN', '1\u202f234\u202f567,89', '12,34,567.89'],
    ])('uses %s separators for display while accepting another locale\'s paste style', async (
        locale,
        pasted,
        displayed,
    ) => {
        await setLocale(locale);
        const onAmountFieldChange = vi.fn();
        const u = mount({ amount: '1234567.89', onAmountFieldChange });
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        expect(input).toHaveValue(displayed);
        fireEvent.change(input, {
            target: { value: pasted, selectionStart: pasted.length },
        });
        expect(onAmountFieldChange).toHaveBeenCalledWith(
            '1234567.89',
            locale === 'hi-IN' ? '1234567.89'.length : null,
        );
    });

    it('shows a plain error for malformed mixed separators', () => {
        const onAmountFieldChange = vi.fn();
        const u = mount({ amount: '', onAmountFieldChange });
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        fireEvent.change(input, { target: { value: '12.34,56' } });

        expect(onAmountFieldChange).not.toHaveBeenCalled();
        expect(u.getByRole('alert')).toHaveTextContent('Enter a valid decimal amount');
    });

    it('rejects precision beyond the selected asset divisibility', () => {
        const onAmountFieldChange = vi.fn();
        const u = mount({ amount: '', divisibility: 2, onAmountFieldChange });
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        fireEvent.change(input, { target: { value: '1.234' } });

        expect(onAmountFieldChange).not.toHaveBeenCalled();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(u.getByRole('alert')).toHaveTextContent('at most 2 decimal places');
    });

    it('keeps labels and status semantics explicit for assistive technology', () => {
        const onMax = vi.fn();
        const u = mount({
            amount: '2',
            fiatRate: RATE,
            balanceText: '3 BTC available',
            onMax,
            maxBusy: true,
        });

        expect(u.getByRole('textbox', { name: 'Amount (BTC)' }))
            .toHaveAttribute('inputmode', 'decimal');
        expect(u.getByRole('status')).toHaveTextContent('3 BTC available');
        expect(u.getByRole('button', { name: 'Use max available amount' })).toBeDisabled();
        expect(u.getByRole('button', { name: 'Switch input to USD' }))
            .toHaveAttribute('aria-pressed', 'false');
    });

    it('forwards caller errors through the labelled input', () => {
        const u = mount({ error: 'Amount exceeds the available balance.' });
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(u.getByRole('alert')).toHaveTextContent('Amount exceeds the available balance.');
    });
});
