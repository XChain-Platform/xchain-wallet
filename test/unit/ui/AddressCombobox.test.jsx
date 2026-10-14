// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';

const suggestions = [
    { address: 'bc1qalice', label: 'Alice', source: 'contact' },
    { address: 'bc1qbob', label: 'Bob', source: 'contact' },
    { address: 'bc1qrecent', label: 'bc1qr...ecent', source: 'history' },
];

afterEach(() => {
    delete navigator.clipboard;
});

function ControlledCombobox(props) {
    const { value: initialValue = '', ...rest } = props;
    const [value, setValue] = useState(initialValue);
    return (
        <AddressCombobox
            label="To"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            suggestions={suggestions}
            {...rest}
        />
    );
}

describe('<AddressCombobox>', () => {
    it('finds a contact by name and selects it with the keyboard', () => {
        render(<ControlledCombobox />);
        const input = screen.getByLabelText('To');

        fireEvent.change(input, { target: { value: 'ali' } });
        expect(screen.getByRole('option')).toHaveTextContent('Alice');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant');
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('bc1qalice');
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('composes caller keyboard and focus handlers with list navigation', () => {
        const onFocus = vi.fn();
        const onKeyDown = vi.fn();
        render(<ControlledCombobox onFocus={onFocus} onKeyDown={onKeyDown} />);
        const input = screen.getByLabelText('To');

        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });

        expect(onFocus).toHaveBeenCalledOnce();
        expect(onKeyDown).toHaveBeenCalledOnce();
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('trims a plain paste but preserves a host-consumed URI paste', () => {
        const { rerender } = render(<ControlledCombobox />);
        let input = screen.getByLabelText('To');
        fireEvent.paste(input, {
            clipboardData: { getData: () => '\n bc1qpasted \t' },
        });
        expect(input).toHaveValue('bc1qpasted');

        rerender(
            <ControlledCombobox
                onPaste={(event) => {
                    event.preventDefault();
                    event.currentTarget.value = 'bc1qfromuri';
                    fireEvent.change(event.currentTarget);
                }}
            />,
        );
        input = screen.getByLabelText('To');
        fireEvent.paste(input, {
            clipboardData: { getData: () => ' bitcoin:bc1qfromuri?amount=1 ' },
        });
        expect(input).toHaveValue('bc1qfromuri');
    });

    it('trims clipboard button text and explains denied clipboard access', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockResolvedValue('  bc1qclipboard\n') },
        });
        const view = render(<ControlledCombobox />);

        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('bc1qclipboard'));

        navigator.clipboard.readText.mockResolvedValueOnce(' bitcoin:bc1qfromuri?amount=1 ');
        view.rerender(
            <ControlledCombobox
                onPaste={(event) => {
                    event.preventDefault();
                    event.currentTarget.value = 'bc1qfromuri';
                    fireEvent.change(event.currentTarget);
                }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('bc1qfromuri'));

        navigator.clipboard.readText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Clipboard access was denied. Paste manually instead.',
        );
    });

    it('clears the value and resets keyboard selection', () => {
        render(<ControlledCombobox value="Alice" />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant');

        fireEvent.change(input, { target: { value: '' } });

        expect(input).toHaveValue('');
        expect(input).not.toHaveAttribute('aria-activedescendant');
        expect(screen.getAllByRole('option')).toHaveLength(suggestions.length);
    });

    it('keeps a per-chain validation message associated with the input', () => {
        render(
            <ControlledCombobox error="This is not a valid Dogecoin testnet address." />,
        );

        expect(screen.getByLabelText('To')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('valid Dogecoin testnet address');
    });

    it('closes suggestions before running the trailing action', () => {
        const onIconClick = vi.fn();
        render(<ControlledCombobox icon="contacts" onIconClick={onIconClick} />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Open address book' }));

        expect(onIconClick).toHaveBeenCalledOnce();
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
