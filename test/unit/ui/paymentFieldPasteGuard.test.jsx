// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

function AddressHarness({ combobox = false, onPaste }) {
    const [value, setValue] = useState('');
    const props = {
        label: 'Destination',
        value,
        onChange: (event) => setValue(event.target.value),
        onPaste,
    };
    return combobox ? (
        <AddressCombobox
            {...props}
            suggestions={[]}
        />
    ) : (
        <AddressField
            {...props}
        />
    );
}

function DirectAmountHarness() {
    const [value, setValue] = useState('');
    return (
        <Input
            label="Additional amount"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
        />
    );
}

describe('payment field paste guard', () => {
    it.each([
        ['address field', false],
        ['address combobox', true],
    ])('strips whitespace and zero-width characters at the edges of the %s', (_label, combobox) => {
        render(<AddressHarness combobox={combobox} />);

        fireEvent.paste(screen.getByLabelText('Destination'), {
            clipboardData: { getData: () => ' \u200Bbc1qrecipient\uFEFF\n' },
        });

        expect(screen.getByLabelText('Destination')).toHaveValue('bc1qrecipient');
    });

    it.each([
        ['address field', false],
        ['address combobox', true],
    ])('refuses embedded hidden characters in the %s before URI handling', (_label, combobox) => {
        const onPaste = vi.fn();
        render(<AddressHarness combobox={combobox} onPaste={onPaste} />);

        fireEvent.paste(screen.getByLabelText('Destination'), {
            clipboardData: { getData: () => 'bitcoin:bc1qrecip\u200Bient?amount=1.25' },
        });

        expect(onPaste).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Destination')).toHaveValue('');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Pasted text contains hidden characters. Check it and try again.',
        );
    });

    it('passes a valid payment URI to the host without changing its parsed values', () => {
        const uri = 'bitcoin:bc1qrecipient?amount=1.2500&message=Lunch';
        const onPaste = vi.fn((event) => event.preventDefault());
        render(<AddressHarness combobox onPaste={onPaste} />);

        fireEvent.paste(screen.getByLabelText('Destination'), {
            clipboardData: { getData: () => ` \u200B${uri}\uFEFF\n` },
        });

        expect(onPaste).toHaveBeenCalledOnce();
        expect(onPaste.mock.calls[0][0].clipboardData.getData('text')).toBe(uri);
    });

    it('guards a direct decimal input that does not use AmountField', () => {
        render(<DirectAmountHarness />);

        fireEvent.paste(screen.getByLabelText('Additional amount'), {
            clipboardData: { getData: () => '\u200B 2.500 \uFEFF' },
        });

        expect(screen.getByLabelText('Additional amount')).toHaveValue('2.500');
    });

    it('strips edge artifacts from an amount without changing the decimal value', () => {
        const onAmountFieldChange = vi.fn();
        render(
            <AmountField
                amount=""
                tick="BTC"
                onAmountFieldChange={onAmountFieldChange}
            />,
        );

        fireEvent.paste(screen.getByRole('textbox', { name: 'Amount (BTC)' }), {
            clipboardData: { getData: () => '\u200B 1.2500 \uFEFF' },
        });

        expect(onAmountFieldChange).toHaveBeenCalledWith('1.2500', 6);
    });

    it('refuses an amount containing an embedded hidden character', () => {
        const onAmountFieldChange = vi.fn();
        render(
            <AmountField
                amount=""
                tick="BTC"
                onAmountFieldChange={onAmountFieldChange}
            />,
        );

        fireEvent.paste(screen.getByRole('textbox', { name: 'Amount (BTC)' }), {
            clipboardData: { getData: () => '1.2\u200B5' },
        });

        expect(onAmountFieldChange).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Pasted text contains hidden characters. Check it and try again.',
        );
    });
});
