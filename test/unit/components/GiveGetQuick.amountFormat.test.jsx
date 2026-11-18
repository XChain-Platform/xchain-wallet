// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// U61 on the Quick Give/Get cards: typed text stays as typed while the field
// has focus, then the amount shows in the picked asset's exact format, the
// way AmountField shows it in the Full view.

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';

function Harness({ divisibility, initial = '' }) {
    const [amount, setAmount] = useState(initial);
    const [decimals, setDecimals] = useState(divisibility);
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
                get={side('You get')}
            />
            <button type="button" onClick={() => setDecimals(0)}>Make indivisible</button>
        </>
    );
}

afterEach(cleanup);

describe('Quick Give/Get amount format (U61)', () => {
    it('keeps typed text while editing and pads to the token decimals on blur', () => {
        render(<Harness divisibility={8} />);
        const input = screen.getByRole('textbox', { name: 'You give amount (PEPECASH)' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '25' } });
        expect(input).toHaveValue('25');
        fireEvent.blur(input);
        expect(input).toHaveValue('25.00000000');
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
