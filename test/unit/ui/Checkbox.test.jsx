// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../../packages/core/src/ui/Checkbox.jsx';
import styles from '../../../packages/core/src/ui/Checkbox.module.css';
import { COMPONENT_MATRIX } from '../../../packages/web/src/style-guide/ComponentStateMatrix.jsx';
import { SECTIONS } from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';

describe('<Checkbox>', () => {
    it('keeps native checkbox semantics and makes the label interactive', () => {
        const onChange = vi.fn();
        render(
            <Checkbox
                label="Keep signed in"
                description="Use only on this device."
                name="remember"
                onChange={onChange}
            />,
        );

        const input = screen.getByRole('checkbox', { name: 'Keep signed in' });
        expect(input).toHaveAttribute('type', 'checkbox');
        expect(input).toHaveAttribute('name', 'remember');
        expect(input).toHaveAccessibleDescription('Use only on this device.');
        fireEvent.click(screen.getByText('Keep signed in'));
        expect(input).toBeChecked();
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('sets and clears the native indeterminate state', () => {
        const ref = createRef();
        const view = render(<Checkbox ref={ref} label="Select files" indeterminate />);

        expect(ref.current).toBe(screen.getByRole('checkbox'));
        expect(ref.current.indeterminate).toBe(true);
        expect(ref.current).toHaveAttribute('aria-checked', 'mixed');

        view.rerender(<Checkbox ref={ref} label="Select files" indeterminate={false} />);
        expect(ref.current.indeterminate).toBe(false);
        expect(ref.current).not.toHaveAttribute('aria-checked');
    });

    it('connects error text and exposes disabled and invalid states', () => {
        render(
            <Checkbox
                label="Accept terms"
                description="Required to continue."
                error="Confirm your acceptance."
                disabled
            />,
        );

        const input = screen.getByRole('checkbox', { name: 'Accept terms' });
        expect(input).toBeDisabled();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(
            'Required to continue. Confirm your acceptance.',
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Confirm your acceptance.');
        expect(input.closest('label')).toHaveClass(styles.disabled, styles.invalid);
    });

    it('uses the shared visual tokens and a 44px label hit area', () => {
        const css = readFileSync('packages/core/src/ui/Checkbox.module.css', 'utf8');

        expect(css).toMatch(/\.root\s*\{[^}]*min-height:\s*44px/s);
        expect(css).toContain('var(--xc-control-icon-md, var(--xc-icon-md))');
        expect(css).toContain('border-radius: var(--xc-radius-sm)');
        expect(css).toMatch(/\.input:focus-visible \+ \.box\s*\{/);
        expect(css).toMatch(/\.input:checked \+ \.box/);
        expect(css).toMatch(/\.input:indeterminate \+ \.box/);
        expect(css).toMatch(/\.disabled \.box\s*\{/);
        expect(css).toMatch(/\.invalid \.box\s*\{/);
        expect(css).toContain('@media (forced-colors: active)');
    });

    it('appears in the live style guide and state matrix', () => {
        const section = SECTIONS.find(({ id }) => id === 'checkbox');

        expect(section?.primitives).toContain('Checkbox');
        expect(COMPONENT_MATRIX.Checkbox).toEqual(expect.objectContaining({
            nativeSizes: [],
            themes: ['light', 'dark'],
        }));
    });
});
