// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';

const OPTIONS = [
    { value: 'first', label: 'First' },
    { value: 'middle', label: 'Middle' },
    { value: 'last', label: 'Last' },
];

describe('<IconSelect> remaining keyboard and dismissal branches', () => {
    it('opens upward at the last fallback and wraps in both directions', () => {
        render(<IconSelect label="Mode" value="" options={OPTIONS} onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Mode: Select…' });

        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        const options = screen.getAllByRole('option');
        expect(options[2]).toHaveFocus();

        fireEvent.keyDown(options[2], { key: 'ArrowDown' });
        expect(options[0]).toHaveFocus();
        fireEvent.keyDown(options[0], { key: 'ArrowUp' });
        expect(options[2]).toHaveFocus();
        fireEvent.keyDown(options[2], { key: 'Home' });
        expect(options[0]).toHaveFocus();

        fireEvent.keyDown(options[0], { key: 'Tab' });
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('ignores inside pointer actions and toggles closed from the trigger', () => {
        render(<IconSelect value="middle" options={OPTIONS} onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Middle' });
        fireEvent.click(trigger);

        fireEvent.mouseDown(trigger);
        fireEvent.mouseDown(screen.getByRole('listbox'));
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
