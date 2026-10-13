// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import styles from '../../../packages/core/src/ui/Button.module.css';
import { SendIcon } from '../../../packages/core/src/ui/icons/index.jsx';

describe('<Button>', () => {
    it('renders children as label', () => {
        render(<Button>Submit</Button>);
        expect(screen.getByRole('button')).toHaveTextContent('Submit');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Go</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('loading implies disabled and aria-busy', () => {
        render(<Button loading>Signing</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('explicit disabled works independently of loading', () => {
        render(<Button disabled>Stopped</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('type defaults to button (no accidental form submits)', () => {
        render(<Button>Harmless</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('submits via type=submit when set', () => {
        render(<Button type="submit">Confirm</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('forwards arbitrary props like aria-label', () => {
        render(<Button aria-label="Advance">→</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Advance');
    });

    it('uses the shared size scale and hides decorative icons', () => {
        render(
            <>
                <Button data-testid="sm" size="sm" icon={<SendIcon />}>Send</Button>
                <Button data-testid="md">Receive</Button>
                <Button data-testid="lg" size="lg">Approve</Button>
            </>,
        );
        const icon = screen.getByTestId('sm').querySelector('svg');
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');

        // Attributes hold a plain pixel fallback; var() there renders at 300px
        // on Android WebView 102. The size scale comes from the tokens.css rule.
        expect(icon).toHaveAttribute('width', '18');
        expect(icon).toHaveAttribute('height', '18');
        expect(icon).toHaveAttribute('data-xc-icon');
        expect(readFileSync('packages/core/src/ui/tokens.css', 'utf8'))
            .toMatch(/svg\[data-xc-icon\]\)\s*\{[^}]*width:\s*var\(--xc-icon-size,\s*var\(--xc-icon-md\)\)/s);
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(screen.getByTestId('sm')).toHaveClass(styles.sm);
        expect(screen.getByTestId('md')).toHaveClass(styles.md);
        expect(screen.getByTestId('lg')).toHaveClass(styles.lg);
        const sizes = [['sm', '32'], ['md', '40'], ['lg', '48']];
        const followsSharedScale = (candidate) => sizes.every(([size, height]) => new RegExp(
            `\\.${size}\\s*\\{[^}]*min-height:\\s*var\\(--xc-control-h-${size},\\s*${height}px\\)`,
            's',
        ).test(candidate));
        const iconSizes = { sm: 'sm', md: 'md', lg: 'md' };
        for (const [size] of sizes) {
            expect(css).toMatch(new RegExp(
                `\\.${size}\\s*\\{[^}]*--xc-button-height:\\s*var\\(--xc-control-h-${size}\\)`
                + `[^}]*--xc-icon-size:\\s*var\\(--xc-icon-${iconSizes[size]}\\)`,
                's',
            ));
        }
        expect(followsSharedScale(css)).toBe(true);
        const shortened = css.replace(
            'min-height: var(--xc-control-h-sm, 32px)',
            'min-height: 20px',
        );
        expect(shortened).not.toBe(css);
        expect(followsSharedScale(shortened)).toBe(false);
        expect(css).toMatch(/\.btn\s*\{[^}]*padding:\s*0 var\(--xc-control-pad-x\)/s);
        expect(css).toMatch(/\.btn\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s);
        expect(css).toMatch(/\.btn\s*\{[^}]*font-size:\s*var\(--xc-control-font\)/s);
        expect(css).not.toMatch(/min-height:\s*(?:28|36)px/);
    });

    it('passes shared icon tokens through controls, adornments, rows, and tabs', () => {
        const readCss = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
        const sizedControls = [
            {
                css: readCss('ui/ChainPicker.module.css'),
                forwardedToken: '--chain-picker-icon-size',
            },
            {
                css: readCss('shared/components/NetworkFilter.module.css'),
                forwardedToken: '--network-filter-icon-size',
            },
        ];
        const expectedSizes = { sm: 'sm', md: 'md', lg: 'md' };

        for (const { css, forwardedToken } of sizedControls) {
            for (const [controlSize, iconSize] of Object.entries(expectedSizes)) {
                const block = css.match(new RegExp(`\\.${controlSize}\\s*\\{[^}]*\\}`, 's'))?.[0] || '';
                expect(block).toMatch(new RegExp(`--xc-icon-size:\\s*var\\(--xc-icon-${iconSize}\\)`));
                expect(block).toMatch(new RegExp(`${forwardedToken}:\\s*var\\(--xc-icon-size\\)`));
            }
        }

        for (const path of ['ui/AddressField.module.css', 'ui/AddressCombobox.module.css']) {
            const iconButton = readCss(path).match(/\.iconButton\s*\{[^}]*\}/s)?.[0] || '';
            expect(iconButton).toMatch(/--xc-icon-size:\s*var\(--xc-icon-md\)/);
            expect(iconButton).toMatch(/align-items:\s*center/);
            expect(iconButton).toMatch(/justify-content:\s*center/);
        }

        const tabCss = readCss('shared/components/BottomTabBar.module.css');
        for (const selector of ['tabIcon', 'sheetIcon']) {
            const block = tabCss.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, 's'))?.[0] || '';
            expect(block).toMatch(/--xc-icon-size:\s*var\(--xc-icon-md\)/);
            expect(block).toMatch(/align-items:\s*center/);
            expect(block).toMatch(/justify-content:\s*center/);
        }

        const chevron = readFileSync('packages/core/src/ui/ChainPicker.icons.jsx', 'utf8');
        expect(chevron).not.toMatch(/--xc-icon-size/);
    });

    it('keeps icon-only buttons square with an invisible coarse-pointer hit area', () => {
        render(<Button size="sm" icon={<SendIcon />} aria-label="Send" data-testid="send" />);
        const button = screen.getByTestId('send');
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');

        expect(button).toHaveClass(styles.sm, styles.iconOnly);
        expect(css).toMatch(/\.iconOnly\s*\{[^}]*width:\s*var\(--xc-button-height\)[^}]*min-width:\s*var\(--xc-button-height\)/s);
        expect(css).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*?\.btn::after\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    });
});
