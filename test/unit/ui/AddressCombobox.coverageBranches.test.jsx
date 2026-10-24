// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressCombobox } from '../../../packages/core/src/ui/AddressCombobox.jsx';

const suggestions = [
    { address: 'bc1qfirst', label: 'First', source: 'contact' },
    { address: 'bc1qsecond', label: 'Second', source: 'history' },
];

function Harness({ forwardedRef, ...props }) {
    const [value, setValue] = useState('');
    return (
        <AddressCombobox
            ref={forwardedRef}
            label="Destination"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            suggestions={suggestions}
            {...props}
        />
    );
}

afterEach(() => {
    delete navigator.clipboard;
});

describe('<AddressCombobox> remaining interaction branches', () => {
    it('moves upward from a later active option and accepts both ref shapes', () => {
        const callbackRef = vi.fn();
        const view = render(<Harness forwardedRef={callbackRef} />);
        const input = screen.getByLabelText('Destination');
        expect(callbackRef).toHaveBeenCalledWith(input);

        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

        const objectRef = createRef();
        view.rerender(<Harness forwardedRef={objectRef} icon="unknown" />);
        expect(objectRef.current).toBe(screen.getByLabelText('Destination'));
    });

    it('rejects hidden text delivered by the native paste event', () => {
        render(<Harness />);
        const input = screen.getByLabelText('Destination');

        fireEvent.paste(input, {
            clipboardData: { getData: () => 'bc1qhid\u200Bden' },
        });

        expect(screen.getByRole('alert')).toHaveTextContent('hidden characters');
        expect(input).toHaveValue('');
    });

    it('uses a custom trailing-action label without requiring a handler', () => {
        render(<Harness icon="contacts" iconLabel="Pick a contact" />);
        const input = screen.getByLabelText('Destination');
        fireEvent.focus(input);

        fireEvent.click(screen.getByRole('button', { name: 'Pick a contact' }));

        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
