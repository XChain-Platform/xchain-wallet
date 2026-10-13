// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

function expectSingleDescription(control, text) {
    const ids = control.getAttribute('aria-describedby').split(' ');
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0])).toHaveTextContent(text);
}

describe('<Textarea>', () => {
    it('associates its label and hint and passes native props through', () => {
        const onChange = vi.fn();
        render(
            <Textarea
                id="notes"
                label="Notes"
                hint="Keep it short"
                rows={4}
                value="Draft"
                onChange={onChange}
                style={{ minHeight: 80 }}
            />,
        );
        const control = screen.getByRole('textbox', { name: 'Notes' });
        expect(control).toHaveAttribute('id', 'notes');
        expect(control).toHaveAttribute('rows', '4');
        expect(control).toHaveValue('Draft');
        expect(control).toHaveStyle({ minHeight: '80px', resize: 'vertical' });
        expectSingleDescription(control, 'Keep it short');
        fireEvent.change(control, { target: { value: 'Final' } });
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('announces an error without referencing the hidden hint', () => {
        render(<Textarea label="Notes" hint="Optional" error="Too long" />);
        const control = screen.getByRole('textbox', { name: 'Notes' });
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Optional')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Too long');
        expectSingleDescription(control, 'Too long');
    });

    it('supports unlabelled and disabled states', () => {
        render(<Textarea aria-label="Private note" disabled />);
        expect(screen.getByRole('textbox', { name: 'Private note' })).toBeDisabled();
    });
});

describe('<Select>', () => {
    it('associates its label and hint and emits native changes', () => {
        const onChange = vi.fn();
        render(
            <Select label="Priority" hint="Choose a speed" value="normal" onChange={onChange}>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
            </Select>,
        );
        const control = screen.getByRole('combobox', { name: 'Priority' });
        expect(control).toHaveValue('normal');
        expectSingleDescription(control, 'Choose a speed');
        fireEvent.change(control, { target: { value: 'fast' } });
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('announces an error without referencing the hidden hint', () => {
        render(
            <Select label="Priority" hint="Choose a speed" error="Required">
                <option value="">Choose</option>
            </Select>,
        );
        const control = screen.getByRole('combobox', { name: 'Priority' });
        expect(control).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Choose a speed')).not.toBeInTheDocument();
        expectSingleDescription(control, 'Required');
    });

    it('passes disabled and accessible-name props to the select', () => {
        render(
            <Select aria-label="Network" disabled>
                <option>Bitcoin</option>
            </Select>,
        );
        expect(screen.getByRole('combobox', { name: 'Network' })).toBeDisabled();
    });
});
