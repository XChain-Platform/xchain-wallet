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

    it('shares small-button type and radius without replacing Chip geometry', () => {
        const css = readFileSync('packages/core/src/ui/Chip.module.css', 'utf8');
        const buttonCss = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
        const ruleBody = (source, selector) => {
            const match = source.match(new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`));
            expect(match, `${selector} rule`).not.toBeNull();
            return match[1];
        };
        const declaration = (body, property) => {
            const match = body.match(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`));
            return match ? match[1].trim() : null;
        };

        const chip = ruleBody(css, '.chip');
        const toggle = ruleBody(css, '.toggle');
        const btn = ruleBody(buttonCss, '.btn');
        const sm = ruleBody(buttonCss, '.sm');

        expect(css).not.toMatch(/composes:\s*btn\b/);
        expect(declaration(chip, 'border')).toBe('1px solid var(--xc-control-border)');
        expect(declaration(chip, 'justify-content')).toBe('center');
        expect(declaration(chip, 'padding')).toBe('0 var(--xc-space-3)');
        expect(declaration(chip, 'height')).toBe('var(--xc-control-h-sm)');

        expect(declaration(toggle, 'border-radius')).toBe('var(--xc-control-radius)');
        expect(declaration(btn, 'border-radius')).toMatch(/^var\(--xc-control-radius\b/);

        expect(declaration(toggle, 'font-size')).toBe('var(--xc-control-font-sm)');
        expect(declaration(sm, '--xc-button-font-size')).toMatch(/^var\(--xc-control-font-sm\b/);
        expect(declaration(btn, 'font-size')).toMatch(/^var\(--xc-button-font-size\b/);

        expect(declaration(toggle, 'font-weight')).toBe(declaration(btn, 'font-weight'));
    });
});
