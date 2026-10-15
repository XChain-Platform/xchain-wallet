// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Chip } from '../../../packages/core/src/ui/Chip.jsx';

describe('<Chip>', () => {
    it('renders static content without button semantics', () => {
        render(<Chip>BTC / LTC</Chip>);

        const chip = screen.getByText('BTC / LTC');
        expect(chip.tagName).toBe('SPAN');
        expect(chip).not.toHaveAttribute('aria-pressed');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders a controlled toggle and reports the next pressed state', () => {
        const onPressedChange = vi.fn();
        const { rerender } = render(
            <Chip pressed={false} onPressedChange={onPressedChange}>Watchlist</Chip>,
        );

        const chip = screen.getByRole('button', { name: 'Watchlist' });
        expect(chip).toHaveAttribute('type', 'button');
        expect(chip).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(chip);
        expect(onPressedChange).toHaveBeenCalledWith(true);

        rerender(<Chip pressed onPressedChange={onPressedChange}>Watchlist</Chip>);
        expect(chip).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps the label and test id on a disabled pressed toggle', () => {
        const onPressedChange = vi.fn();
        render(
            <Chip
                data-testid="date-preset"
                pressed
                disabled
                onPressedChange={onPressedChange}
            >7 days</Chip>,
        );

        const chip = screen.getByTestId('date-preset');
        expect(chip).toHaveAccessibleName('7 days');
        expect(chip).toHaveAttribute('aria-pressed', 'true');
        expect(chip).toBeDisabled();
        fireEvent.click(chip);
        expect(onPressedChange).not.toHaveBeenCalled();
    });

    it('uses the shared small-control geometry and a Chrome 102-safe focus ring', () => {
        const css = readFileSync('packages/core/src/ui/Chip.module.css', 'utf8');

        expect(css).toMatch(/height:\s*var\(--xc-control-h-sm\)/);
        expect(css).toMatch(/\.toggle\s*\{[^}]*min-height:\s*var\(--xc-tap-min\)/s);
        expect(css).toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(css).toMatch(/\.toggle:focus-visible\s*{[^}]*outline:\s*2px solid var\(--xc-control-focus-ring\)/s);
        expect(css).toMatch(/\.pressed[^}]*background:\s*var\(--xc-control-selected\)/s);
        expect(css).toMatch(/\.toggle:disabled\s*{[^}]*border-color:\s*var\(--xc-control-disabled-border\)/s);
        expect(css).not.toMatch(/color-mix\(|:has\(/);
    });
});
