// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The amount field follows the selected asset's divisibility. A stored amount
// shows padded to the asset's decimal places, a change of asset re-pads or
// re-validates it, and an amount finer than the asset allows shows the
// decimal-places error instead of being kept or cut silently. Padding is
// display only: the parent's canonical amount stays as the parent set it,
// and text the user is typing is never padded under the cursor.

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

afterEach(cleanup);

const RATE = { rate: 67000, fiatCurrency: 'USD' };

function field(props) {
    return React.createElement(AmountField, {
        amount: '1',
        tick: 'BTC',
        onAmountFieldChange() {},
        amountInputMode: 'coin',
        ...props,
    });
}

function Harness({ divisibility, onValue }) {
    const [amount, setAmount] = useState('');
    return (
        <AmountField
            amount={amount}
            tick="BTC"
            divisibility={divisibility}
            onAmountFieldChange={(value) => { setAmount(value); onValue?.(value); }}
        />
    );
}

function type(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const character of text) {
        const next = input.value + character;
        setter.call(input, next);
        input.setSelectionRange(next.length, next.length);
        fireEvent(input, new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
    }
}

describe('AmountField follows the asset divisibility', () => {
    it('pads a stored amount to the asset decimal places and re-pads on a divisibility change', () => {
        const onAmountFieldChange = vi.fn();
        const u = render(field({ divisibility: 8, onAmountFieldChange }));
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });
        expect(input.value).toBe('1.00000000');

        u.rerender(field({ divisibility: 0, onAmountFieldChange }));
        expect(input.value).toBe('1');

        u.rerender(field({ divisibility: 2, onAmountFieldChange }));
        expect(input.value).toBe('1.00');
        expect(onAmountFieldChange).not.toHaveBeenCalled();
    });

    it('shows the decimal-places error for a stored amount finer than the asset allows', () => {
        const onValidationError = vi.fn();
        const u = render(field({ amount: '1.123456789', divisibility: 8, onValidationError }));
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        expect(input.value).toBe('1.123456789');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(u.getByRole('alert')).toHaveTextContent('Amount can have at most 8 decimal places.');
        expect(onValidationError).toHaveBeenLastCalledWith('Amount can have at most 8 decimal places.');

        u.rerender(field({ amount: '1.123456789', divisibility: 9, onValidationError }));
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(onValidationError).toHaveBeenLastCalledWith(null);
    });

    it('revalidates a valid amount when the asset narrows its decimal places', () => {
        const u = render(field({ amount: '1.5', divisibility: 8 }));
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });
        expect(input.value).toBe('1.50000000');

        u.rerender(field({ amount: '1.5', divisibility: 0 }));
        expect(input.value).toBe('1.5');
        expect(u.getByRole('alert')).toHaveTextContent('Amount can have at most 0 decimal places.');
    });

    it('clears typed errors and reformats in place when precision changes', () => {
        const onValidationError = vi.fn();
        const u = render(field({ amount: '1234.', divisibility: 8, onValidationError }));
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        expect(input).toHaveAttribute('placeholder', '0.00000000');
        fireEvent.change(input, { target: { value: '1.123456789' } });
        expect(u.getByRole('alert')).toHaveTextContent('Amount can have at most 8 decimal places.');

        u.rerender(field({ amount: '1234.', divisibility: 0, onValidationError }));
        expect(u.getByRole('textbox', { name: 'Amount (BTC)' })).toBe(input);
        expect(input).toHaveAttribute('placeholder', '0');
        expect(input.value).toBe('1,234');
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(onValidationError).toHaveBeenLastCalledWith(null);

        u.rerender(field({ amount: '12.5', divisibility: 0, onValidationError }));
        expect(input.value).toBe('12.5');
        expect(u.getByRole('alert')).toHaveTextContent('Amount can have at most 0 decimal places.');

        u.rerender(field({ amount: '12.5', divisibility: 8, onValidationError }));
        expect(input).toHaveAttribute('placeholder', '0.00000000');
        expect(input.value).toBe('12.50000000');
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
        expect(onValidationError).toHaveBeenLastCalledWith(null);
    });

    it('leaves typing in progress unpadded and pads on blur', () => {
        let latest = '';
        const u = render(<Harness divisibility={8} onValue={(value) => { latest = value; }} />);
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });

        type(input, '1.5');
        expect(latest).toBe('1.5');
        expect(input.value).toBe('1.5');

        fireEvent.blur(input);
        expect(input.value).toBe('1.50000000');
        expect(latest).toBe('1.5');
    });

    it('edits a padded display from the text the field shows', () => {
        let latest = '';
        const u = render(<Harness divisibility={2} onValue={(value) => { latest = value; }} />);
        const input = u.getByRole('textbox', { name: 'Amount (BTC)' });
        type(input, '1000');
        fireEvent.blur(input);
        expect(input.value).toBe('1,000.00');

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '1,000.0');
        input.setSelectionRange(7, 7);
        fireEvent(input, new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        expect(latest).toBe('1000.0');
        expect(input.value).toBe('1,000.0');
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('leaves the field empty when no amount is stored', () => {
        const u = render(field({ amount: '', divisibility: 8 }));
        expect(u.getByRole('textbox', { name: 'Amount (BTC)' }).value).toBe('');
    });

    it('forwards optional state while keeping the active unit in the bare label', () => {
        const u = render(field({ label: 'Initial mint', optional: true }));
        const input = u.getByRole('textbox', { name: 'Initial mint (BTC)' });
        const pill = u.container.querySelector('[data-optional-pill]');

        expect(pill).toHaveTextContent('Optional');
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(pill.id);
    });

    it('ignores divisibility in fiat mode', () => {
        const u = render(field({
            amount: '1.123456789',
            fiatAmount: '12.5',
            fiatRate: RATE,
            amountInputMode: 'fiat',
            toggleAmountInputMode() {},
            divisibility: 0,
        }));
        const input = u.getByRole('textbox', { name: 'Amount (USD)' });
        expect(input.value).toBe('12.5');
        expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });
});
