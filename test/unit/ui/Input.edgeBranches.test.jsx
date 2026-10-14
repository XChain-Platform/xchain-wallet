// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
    window.matchMedia = originalMatchMedia;
});

function ControlledInput(props) {
    const { initialValue = '', ...inputProps } = props;
    const [value, setValue] = useState(initialValue);
    return (
        <Input
            label="Amount"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            {...inputProps}
        />
    );
}

describe('<Input> edge branches', () => {
    it('inserts a normalized guarded paste over the current selection', () => {
        render(<ControlledInput initialValue="1234" />);
        const input = screen.getByLabelText('Amount');
        input.setSelectionRange(1, 3);

        fireEvent.paste(input, {
            clipboardData: { getData: () => ' 9 ' },
        });

        expect(input).toHaveValue('194');
    });

    it('lets a host consume normalized guarded text before insertion', () => {
        const onPaste = vi.fn((event) => event.preventDefault());
        render(<ControlledInput initialValue="12" onPaste={onPaste} />);
        const input = screen.getByLabelText('Amount');

        fireEvent.paste(input, {
            clipboardData: { getData: () => ' 34 ' },
        });

        expect(onPaste).toHaveBeenCalledOnce();
        expect(onPaste.mock.calls[0][0].clipboardData.getData('text')).toBe('34');
        expect(input).toHaveValue('12');
    });

    it('passes unguarded and unreadable clipboard events to the caller', () => {
        const onPaste = vi.fn();
        const { rerender } = render(<Input label="Name" onPaste={onPaste} />);
        const name = screen.getByLabelText('Name');
        fireEvent.paste(name, { clipboardData: { getData: () => ' raw ' } });
        expect(onPaste).toHaveBeenCalledOnce();

        rerender(<Input label="Amount" inputMode="decimal" onPaste={onPaste} />);
        fireEvent.paste(screen.getByLabelText('Amount'), { clipboardData: {} });
        expect(onPaste).toHaveBeenCalledTimes(2);
    });

    it('tracks matchMedia changes and removes its listener on unmount', () => {
        let listener;
        const media = {
            matches: false,
            addEventListener: vi.fn((_name, callback) => { listener = callback; }),
            removeEventListener: vi.fn(),
        };
        window.matchMedia = vi.fn(() => media);
        const view = render(
            <Input
                label="Destination"
                placeholder="Automatically filled from the active wallet address"
                compactPlaceholder="Wallet address"
            />,
        );
        const input = screen.getByLabelText('Destination');
        expect(input).toHaveAttribute('placeholder', 'Automatically filled from the active wallet address');

        media.matches = true;
        act(() => listener());
        expect(input).toHaveAttribute('placeholder', 'Wallet address');

        view.unmount();
        expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
    });

    it('focuses the control only when the empty hit area receives the pointer', () => {
        render(<Input label="Name" />);
        const input = screen.getByLabelText('Name');
        const hitArea = input.parentElement;

        fireEvent.pointerDown(hitArea);
        expect(input).toHaveFocus();

        input.blur();
        fireEvent.pointerDown(input);
        expect(input).not.toHaveFocus();
    });
});
