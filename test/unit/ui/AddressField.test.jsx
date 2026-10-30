// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';

const addressComboboxStyles = readFileSync(
    'packages/core/src/ui/AddressCombobox.module.css',
    'utf8',
);

function ControlledField(props) {
    const { value: initialValue = '', ...rest } = props;
    const [value, setValue] = useState(initialValue);
    return (
        <AddressField
            label="Destination"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            {...rest}
        />
    );
}

describe('<AddressField>', () => {
    it.each([320, 360])('keeps the destination icon action clear of text at %ipx', (width) => {
        render(
            <div style={{ width }}>
                <AddressCombobox
                    label="To"
                    value=""
                    onChange={() => {}}
                    icon="contacts"
                    onIconClick={() => {}}
                />
            </div>,
        );

        const input = screen.getByRole('combobox', { name: 'To' });
        expect(input.style.getPropertyValue('--address-end-room'))
            .toBe('calc(var(--address-control-height) + var(--xc-space-2))');
        expect(screen.getByRole('button', { name: 'Open address book' })).toBeInTheDocument();
        expect(addressComboboxStyles).toMatch(/\.wrap input\s*\{[^}]*min-width:\s*0/s);
    });

    it.each(['md', 'lg'])('gives the input and inline actions the same %s size class', (size) => {
        const { unmount } = render(
            <AddressField
                label="From"
                size={size}
                icon="addresses"
                value="bc1qsource"
                readOnly
                onChange={() => {}}
            />,
        );

        const input = screen.getByLabelText('From');
        expect(input.parentElement.parentElement).toHaveClass(inputStyles[size]);
        expect(screen.getByRole('button', { name: 'Choose address' }))
            .toHaveClass(buttonStyles[size]);
        unmount();

        render(
            <AmountField
                size={size}
                amount="1"
                tick="BTC"
                onAmountFieldChange={() => {}}
                onMax={() => {}}
            />,
        );

        const amountInput = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        expect(amountInput.parentElement.parentElement).toHaveClass(inputStyles[size]);
        expect(screen.getByRole('button', { name: 'Use max available amount' }))
            .toHaveClass(buttonStyles[size]);
    });

    it('trims surrounding whitespace from a plain pasted address', () => {
        render(<ControlledField />);

        fireEvent.paste(screen.getByLabelText('Destination'), {
            clipboardData: { getData: () => '  bc1qrecipient  \n' },
        });

        expect(screen.getByLabelText('Destination')).toHaveValue('bc1qrecipient');
    });

    it('leaves a consumed URI paste to the host handler', () => {
        render(
            <ControlledField
                onPaste={(event) => {
                    event.preventDefault();
                    event.currentTarget.value = 'bc1qfromuri';
                    fireEvent.change(event.currentTarget);
                }}
            />,
        );

        fireEvent.paste(screen.getByLabelText('Destination'), {
            clipboardData: { getData: () => ' bitcoin:bc1qfromuri?amount=1 ' },
        });

        expect(screen.getByLabelText('Destination')).toHaveValue('bc1qfromuri');
    });

    it('renders per-chain errors through the accessible error slot', () => {
        const { rerender } = render(
            <AddressField label="Destination" value="bad" onChange={() => {}} error="This is not a valid Bitcoin address." />,
        );
        expect(screen.getByLabelText('Destination')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('valid Bitcoin address');

        rerender(
            <AddressField label="Destination" value="bad" onChange={() => {}} error="This is not a valid Litecoin testnet address." />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('valid Litecoin testnet address');
    });

    it('runs the own-address scan action without submitting', () => {
        const onIconClick = vi.fn();
        const onSubmit = vi.fn((event) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <AddressField
                    label="From"
                    icon="addresses"
                    value="bc1qsource"
                    readOnly
                    onIconClick={onIconClick}
                />
            </form>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
        expect(onIconClick).toHaveBeenCalledOnce();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not render a phantom action when icon is absent', () => {
        render(<AddressField label="Destination" value="" onChange={() => {}} />);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
