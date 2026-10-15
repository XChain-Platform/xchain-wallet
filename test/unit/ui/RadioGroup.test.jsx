// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RadioGroup } from '../../../packages/core/src/ui/RadioGroup.jsx';

const OPTIONS = [
    { value: 'private', label: 'Private', description: 'Only the recipient can read it.' },
    { value: 'public', label: 'Public', description: 'Readable by anyone.' },
    { value: 'scheduled', label: 'Scheduled', disabled: true },
];

function ControlledRadioGroup(props) {
    const [value, setValue] = useState('private');
    return (
        <RadioGroup
            legend="Visibility"
            name="visibility"
            value={value}
            onChange={setValue}
            options={OPTIONS}
            {...props}
        />
    );
}

describe('RadioGroup', () => {
    it('uses native grouped inputs and updates the controlled value through the label', () => {
        render(<ControlledRadioGroup />);

        expect(screen.getByRole('group', { name: 'Visibility' })).toBeInTheDocument();
        const privateOption = screen.getByRole('radio', { name: 'Private' });
        const publicOption = screen.getByRole('radio', { name: 'Public' });
        const scheduledOption = screen.getByRole('radio', { name: 'Scheduled' });

        for (const option of [privateOption, publicOption, scheduledOption]) {
            expect(option.tagName).toBe('INPUT');
            expect(option).toHaveAttribute('type', 'radio');
            expect(option).toHaveAttribute('name', 'visibility');
        }
        expect(privateOption).toBeChecked();
        expect(scheduledOption).toBeDisabled();

        fireEvent.click(screen.getByText('Public'));
        expect(publicOption).toBeChecked();
        expect(privateOption).not.toBeChecked();
    });

    it('associates option descriptions and replaces the hint with an announced error', () => {
        const { rerender } = render(<ControlledRadioGroup hint="Choose one visibility." />);
        const privateOption = screen.getByRole('radio', { name: 'Private' });
        const descriptionIds = privateOption.getAttribute('aria-describedby').split(' ');

        expect(descriptionIds.map((id) => document.getElementById(id)?.textContent))
            .toEqual(['Only the recipient can read it.', 'Choose one visibility.']);

        rerender(<ControlledRadioGroup hint="Choose one visibility." error="Select a visibility." />);
        expect(screen.queryByText('Choose one visibility.')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Select a visibility.');
        expect(screen.getByRole('radio', { name: 'Private' })).toHaveAttribute('aria-invalid', 'true');
    });

    it('disables every native input when the group is disabled', () => {
        render(<ControlledRadioGroup disabled />);

        for (const option of screen.getAllByRole('radio')) {
            expect(option).toBeDisabled();
        }
    });

    it('uses token-driven circles, visible states, and a 44px label hit area', () => {
        const css = readFileSync('packages/core/src/ui/RadioGroup.module.css', 'utf8');

        expect(css).toMatch(/--xc-control-icon-md:\s*var\(--xc-icon-md\)/);
        expect(css).toMatch(/\.input\s*\{[^}]*width:\s*var\(--xc-control-icon-md\)[^}]*height:\s*var\(--xc-control-icon-md\)/s);
        expect(css).toMatch(/\.option\s*\{[^}]*min-height:\s*44px/s);
        expect(css).toMatch(/\.input:checked\s*\{[^}]*var\(--xc-control-selected\)/s);
        expect(css).toMatch(/\.input:focus-visible\s*\{[^}]*var\(--xc-control-focus-ring\)/s);
        expect(css).toMatch(/\.input:disabled\s*\{[^}]*var\(--xc-control-disabled-bg\)/s);
        expect(css).toMatch(/\.invalid \.input\s*\{[^}]*var\(--xc-danger\)/s);
        expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    });
});
