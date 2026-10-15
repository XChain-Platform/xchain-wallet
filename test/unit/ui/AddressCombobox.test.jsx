// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddressCombobox, syncPasteWidth } from '../../../packages/core/src/ui/AddressCombobox.jsx';

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
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Clipboard access was denied. Paste manually instead.');
        // The failure is the field's own error under the field, not a second
        // message inside the field box beside the Paste button.
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByLabelText('To').getAttribute('aria-describedby')).toContain(alert.id);
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

    it('keeps suggestion addresses out of the tab order', () => {
        render(
            <ControlledCombobox
                suggestions={[{ address: 'demo1erincallowaybtc0000000000000000001', label: 'Erin', source: 'contact' }]}
            />,
        );
        fireEvent.focus(screen.getByLabelText('To'));

        const option = screen.getByRole('option');
        expect(option.querySelectorAll('[tabindex]')).toHaveLength(0);
    });
});

describe('in-field Paste width', () => {
    function pasteButton(width, inset = '4px') {
        const button = document.createElement('button');
        button.style.setProperty('inset-inline-end', inset);
        button.getBoundingClientRect = () => ({ width });
        document.body.appendChild(button);
        return button;
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('sizes the room for Paste from the button it measures, rounded up, with its inset on both sides', () => {
        const wrap = document.createElement('div');
        // Default text: Paste is 68px, which keeps the stylesheet estimate.
        expect(syncPasteWidth(wrap, pasteButton(67.6))).toBe(76);
        expect(wrap.style.getPropertyValue('--address-paste-width')).toBe('76px');
        // Largest text: Paste grows to about 89px and the room follows it.
        expect(syncPasteWidth(wrap, pasteButton(88.78))).toBe(97);
        expect(wrap.style.getPropertyValue('--address-paste-width')).toBe('97px');
    });

    it('leaves the stylesheet estimate alone when there is nothing to measure', () => {
        const wrap = document.createElement('div');
        expect(syncPasteWidth(wrap, null)).toBeNull();
        expect(syncPasteWidth(wrap, pasteButton(0))).toBeNull();
        expect(wrap.style.getPropertyValue('--address-paste-width')).toBe('');
    });

    it('lays the address book and the input text out against the measured Paste width', () => {
        const rect = vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 88.78, height: 36, top: 0, left: 0, right: 88.78, bottom: 36, x: 0, y: 0 });
        try {
            const { container } = render(<ControlledCombobox icon="contacts" onIconClick={() => {}} />);
            const wrap = container.firstElementChild;
            expect(wrap.style.getPropertyValue('--address-paste-width')).toMatch(/^\d+px$/);
            expect(Number.parseFloat(wrap.style.getPropertyValue('--address-paste-width'))).toBeGreaterThanOrEqual(89);
            const input = screen.getByRole('combobox', { name: 'To' });
            expect(input.style.getPropertyValue('--address-end-room'))
                .toBe('calc(var(--address-paste-width) + var(--address-control-height))');
        } finally {
            rect.mockRestore();
        }
    });
});
