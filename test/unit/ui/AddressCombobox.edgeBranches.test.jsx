// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';

const suggestions = [
    { address: 'bc1qalice', label: 'Alice', source: 'contact', sublabel: 'Savings' },
    { address: 'bc1qbob', label: 'Bob', source: 'history' },
];

function Harness(props) {
    const [value, setValue] = useState('');
    return (
        <AddressCombobox
            label="To"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            suggestions={suggestions}
            {...props}
        />
    );
}

describe('<AddressCombobox> edge branches', () => {
    it('wraps upward, tracks mouse hover, and selects through the metadata callback', () => {
        const onSuggestionSelect = vi.fn();
        render(<Harness onSuggestionSelect={onSuggestionSelect} />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);

        fireEvent.keyDown(input, { key: 'ArrowUp' });
        const options = screen.getAllByRole('option');
        expect(options[1]).toHaveAttribute('aria-selected', 'true');

        fireEvent.mouseEnter(options[0]);
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.mouseDown(options[0]);

        expect(onSuggestionSelect).toHaveBeenCalledWith(suggestions[0]);
        expect(input).toHaveValue('');
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('respects a caller that prevents keyboard navigation', () => {
        render(<Harness onKeyDown={(event) => event.preventDefault()} />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });

        expect(screen.getAllByRole('option').every(
            (option) => option.getAttribute('aria-selected') === 'false',
        )).toBe(true);
        expect(input).not.toHaveAttribute('aria-activedescendant');
    });

    it('keeps suggestions open for focus inside the field and closes outside it', () => {
        render(<Harness icon="addresses" />);
        const input = screen.getByLabelText('To');
        const icon = screen.getByRole('button', { name: 'Choose address' });
        fireEvent.focus(input);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.blur(input, { relatedTarget: icon });
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.blur(icon, { relatedTarget: document.body });
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes an empty suggestion session on Escape without preventing the key', () => {
        const onKeyDown = vi.fn();
        render(<Harness suggestions={[]} onKeyDown={onKeyDown} />);
        const input = screen.getByLabelText('To');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(onKeyDown).toHaveBeenCalledOnce();
        expect(onKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
        expect(input).toHaveAttribute('aria-expanded', 'false');
    });
});
