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
import fieldIconStyles from '../../../packages/core/src/ui/FieldIconButton.module.css';
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
    it.each([320, 360])('keeps the destination icon action inside the control at %ipx', (width) => {
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
        const label = document.querySelector(`label[for="${input.id}"]`);
        const action = screen.getByRole('button', { name: 'Open address book' });
        expect(label).not.toContainElement(action);
        expect(input.parentElement).toContainElement(action);
        expect(input.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(input.style.getPropertyValue('--address-end-room')).toBe('');
        expect(addressComboboxStyles).toMatch(/\.wrap input\s*\{[^}]*min-width:\s*0/s);
    });

    it.each(['md', 'lg'])('keeps a %s input with a plain in-field action', (size) => {
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
            .toHaveClass(fieldIconStyles.button);
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

    it('runs the contacts action from inside the editable field', () => {
        const onIconClick = vi.fn();
        render(
            <AddressField
                label="Destination"
                icon="contacts"
                value=""
                onChange={() => {}}
                onIconClick={onIconClick}
            />,
        );

        const input = screen.getByLabelText('Destination');
        const action = screen.getByRole('button', { name: 'Open address book' });
        expect(input.parentElement).toContainElement(action);
        fireEvent.click(action);
        expect(onIconClick).toHaveBeenCalledOnce();
    });

    it('keeps the read-only overlay clear of its in-field action', () => {
        const { container } = render(
            <AddressField
                label="From"
                icon="addresses"
                value="bc1qsourceaddress"
                readOnly
                onIconClick={() => {}}
            />,
        );

        const overlay = container.querySelector('[class*="readOnlyValue"]');
        expect(overlay.parentElement.className).toContain('hasFieldAction');
        expect(screen.getByLabelText('From').parentElement)
            .toContainElement(screen.getByRole('button', { name: 'Choose address' }));
    });

    it('does not render a phantom action when icon is absent', () => {
        render(<AddressField label="Destination" value="" onChange={() => {}} />);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
