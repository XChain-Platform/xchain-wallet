// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// U61 on the Quick Give/Get cards: typed text stays as typed while the field
// has focus, then the amount shows in the picked asset's format, the way
// AmountField shows it in the Full view: a whole amount without decimals, a
// fractional one padded to the asset's decimal places.

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';

function Harness({ divisibility, initial = '' }) {
    const [amount, setAmount] = useState(initial);
    const [decimals, setDecimals] = useState(divisibility);
    const [getAmount, setGetAmount] = useState('');
    const side = (label, extra) => ({
        label,
        asset: { chainId: 'bitcoin-mainnet', tick: 'PEPECASH' },
        assetLabel: `${label} asset`,
        onOpenAsset: () => {},
        amount: '',
        onAmountChange: () => {},
        amountLabel: `${label} amount`,
        ...extra,
    });
    return (
        <>
            <GiveGetQuick
                give={side('You give', { amount, onAmountChange: setAmount, divisibility: decimals })}
                get={side('You get', { amount: getAmount, onAmountChange: setGetAmount, divisibility: decimals })}
            />
            <button type="button" onClick={() => setDecimals(0)}>Make indivisible</button>
            <button type="button" onClick={() => setDecimals(2)}>Make two places</button>
        </>
    );
}

afterEach(cleanup);

describe('Quick Give/Get amount format (U61)', () => {
    it('keeps a typed whole amount as typed after blur', () => {
        render(<Harness divisibility={8} />);
        const input = screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '25' } });
        expect(input).toHaveValue('25');
        fireEvent.blur(input);
        expect(input).toHaveValue('25');
    });

    it.each([
        ['25', '25'],
        ['25.0', '25'],
        ['1.00000000', '1'],
        ['25.1', '25.10000000'],
        ['25.01', '25.01000000'],
    ])('shows a typed You get amount %j as %j once editing ends', (typed, shown) => {
        render(<Harness divisibility={8} />);
        const input = screen.getByRole('textbox', { name: 'You get amount (PEPECASH)' });
        fireEvent.change(input, { target: { value: typed } });
        expect(input).toHaveValue(typed);
        fireEvent.blur(input);
        expect(input).toHaveValue(shown);
    });

    it('re-formats under the new rule when the token decimals change', () => {
        render(<Harness divisibility={8} initial="25.1" />);
        const input = screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' });
        expect(input).toHaveValue('25.10000000');
        fireEvent.click(screen.getByRole('button', { name: 'Make two places' }));
        expect(input).toHaveValue('25.10');
    });

    it('shows a stored amount in the token format before any edit', () => {
        render(<Harness divisibility={8} initial="1.5" />);
        expect(screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' })).toHaveValue('1.50000000');
    });

    it('leaves an amount finer than the token allows as typed, for its precision error', () => {
        render(<Harness divisibility={2} initial="1.234" />);
        expect(screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' })).toHaveValue('1.234');
    });

    it('re-formats at once when the token decimals change, even mid-edit', () => {
        render(<Harness divisibility={8} />);
        const input = screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' });
        fireEvent.change(input, { target: { value: '7' } });
        expect(input).toHaveValue('7');
        fireEvent.click(screen.getByRole('button', { name: 'Make indivisible' }));
        expect(input).toHaveValue('7');
        fireEvent.change(input, { target: { value: '7.' } });
        fireEvent.blur(input);
        expect(input).toHaveValue('7');
    });

    it('shows the amount unchanged when the side names no decimals', () => {
        render(<Harness divisibility={undefined} initial="3" />);
        expect(screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' })).toHaveValue('3');
    });
});
