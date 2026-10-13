// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';

const OPTIONS = [
    { value: 'private', label: 'Encrypted', sub: 'Private', icon: <span>lock</span> },
    { value: 'public', label: 'Plain text', sub: 'Public', icon: <span>globe</span> },
];

describe('<IconSelect>', () => {
    it('opens a named listbox and marks the selected option', () => {
        render(<IconSelect label="Encryption" value="private" options={OPTIONS} onChange={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Encryption: Encrypted' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Encrypted/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: /Plain text/ })).toHaveAttribute('aria-selected', 'false');
    });

    it('selects an option and closes the popup', () => {
        const onChange = vi.fn();
        render(<IconSelect label="Encryption" value="private" options={OPTIONS} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Encryption: Encrypted' }));
        fireEvent.click(screen.getByRole('option', { name: /Plain text/ }));
        expect(onChange).toHaveBeenCalledWith('public');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on Escape and an outside pointer action', () => {
        render(<IconSelect label="Encryption" value="private" options={OPTIONS} onChange={() => {}} />);
        const trigger = screen.getByRole('button', { name: 'Encryption: Encrypted' });
        fireEvent.click(trigger);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        fireEvent.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('does not open while disabled', () => {
        render(<IconSelect label="Encryption" value="private" options={OPTIONS} onChange={() => {}} disabled />);
        const trigger = screen.getByRole('button', { name: 'Encryption: Encrypted' });
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('uses the placeholder in the accessible name for an empty value', () => {
        render(<IconSelect label="Encryption" value="" options={[]} placeholder="Choose mode" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Encryption: Choose mode' })).toBeInTheDocument();
    });
});
