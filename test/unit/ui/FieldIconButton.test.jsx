// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldIconButton } from '../../../packages/core/src/ui/FieldIconButton.jsx';

describe('<FieldIconButton>', () => {
    it('uses its required label as the accessible name and title', () => {
        render(<FieldIconButton icon={<span aria-hidden="true">+</span>} label="Choose address" />);

        const button = screen.getByRole('button', { name: 'Choose address' });
        expect(button).toHaveAttribute('title', 'Choose address');
        expect(button).toHaveTextContent('+');
    });

    it('calls onClick and honours disabled', () => {
        const onClick = vi.fn();
        const { rerender } = render(
            <FieldIconButton icon={<span>+</span>} label="Open picker" onClick={onClick} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open picker' }));
        expect(onClick).toHaveBeenCalledOnce();

        rerender(
            <FieldIconButton
                icon={<span>+</span>}
                label="Open picker"
                onClick={onClick}
                disabled
            />,
        );
        const disabled = screen.getByRole('button', { name: 'Open picker' });
        expect(disabled).toBeDisabled();
        fireEvent.click(disabled);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('passes supported disclosure state to the button', () => {
        render(
            <FieldIconButton
                icon={<span>+</span>}
                label="Open picker"
                aria-pressed
                aria-expanded={false}
                aria-controls="picker"
            />,
        );

        expect(screen.getByRole('button', { name: 'Open picker' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Open picker' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('button', { name: 'Open picker' })).toHaveAttribute('aria-controls', 'picker');
    });
});
