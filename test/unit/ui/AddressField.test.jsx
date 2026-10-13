// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';

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
