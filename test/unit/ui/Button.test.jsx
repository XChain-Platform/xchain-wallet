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

    it('aligns picker and address controls to the shared size tokens', () => {
        const readCss = (path) => readFileSync(`packages/core/src/${path}`, 'utf8');
        const chainPickerCss = readCss('ui/ChainPicker.module.css');
        const iconSelectCss = readCss('ui/IconSelect.module.css');

        for (const size of ['sm', 'md', 'lg']) {
            const chainBlock = chainPickerCss.match(
                new RegExp(`\\.${size}\\s*\\{[^}]*\\}`, 's'),
            )?.[0] || '';
            expect(chainBlock).toMatch(new RegExp(
                `--chain-picker-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
            ));
            expect(chainBlock).toMatch(new RegExp(
                `--chain-picker-icon-size:\\s*var\\(--xc-control-icon-${size},`,
            ));
            expect(chainBlock).toMatch(new RegExp(
                `--chain-picker-padding-x:\\s*var\\(--xc-control-pad-x-${size},`,
            ));
            expect(chainBlock).toMatch(new RegExp(
                `--chain-picker-font-size:\\s*var\\(--xc-control-font-${size},`,
            ));

            const iconSelectBlock = iconSelectCss.match(
                new RegExp(`\\.${size}\\s*\\{[^}]*\\}`, 's'),
            )?.[0] || '';
            expect(iconSelectBlock).toMatch(new RegExp(
                `--xc-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
            ));
            expect(iconSelectBlock).toMatch(new RegExp(
                `--xc-control-icon-size:\\s*var\\(--xc-control-icon-${size},`,
            ));
            expect(iconSelectBlock).toMatch(new RegExp(
                `--xc-control-padding-x:\\s*var\\(--xc-control-pad-x-${size},`,
            ));
            expect(iconSelectBlock).toMatch(new RegExp(
                `--xc-control-font-size:\\s*var\\(--xc-control-font-${size},`,
            ));
        }

        const chainTrigger = chainPickerCss.match(/\.trigger\s*\{[^}]*\}/s)?.[0] || '';
        expect(chainTrigger).toMatch(/box-sizing:\s*border-box/);
        expect(chainTrigger).toMatch(/height:\s*var\(--chain-picker-control-height\)/);
        expect(chainTrigger).toMatch(/padding:\s*0 var\(--chain-picker-padding-x\)/);
        expect(chainTrigger).toMatch(/font-size:\s*var\(--chain-picker-font-size\)/);
        expect(chainTrigger).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);

        const iconSelectTrigger = iconSelectCss.match(/\.trigger\s*\{[^}]*\}/s)?.[0] || '';
        expect(iconSelectTrigger).toMatch(/box-sizing:\s*border-box/);
        expect(iconSelectTrigger).toMatch(/height:\s*var\(--xc-control-height\)/);
        expect(iconSelectTrigger).toMatch(/min-height:\s*var\(--xc-control-height\)/);
        expect(iconSelectCss).not.toMatch(/(?:width|height):\s*26px/);

        for (const component of ['AddressField', 'AddressCombobox']) {
            const css = readCss(`ui/${component}.module.css`);
            const source = readFileSync(`packages/core/src/ui/${component}.jsx`, 'utf8');
            expect(source).toMatch(/styles\[size\] \|\| ''/);
            expect(source).toMatch(
                /paddingInlineEnd: 'calc\(var\(--address-control-height\) \+ var\(--xc-space-2\)\)'/,
            );
            for (const size of ['sm', 'md', 'lg']) {
                const block = css.match(new RegExp(`\\.${size}\\s*\\{[^}]*\\}`, 's'))?.[0] || '';
                expect(block).toMatch(new RegExp(
                    `--address-control-height:\\s*var\\(--xc-control-h-${size}\\)`,
                ));
                expect(block).toMatch(new RegExp(
                    `--xc-icon-size:\\s*var\\(--xc-control-icon-${size},`,
                ));
            }
            const iconButton = css.match(/\.iconButton\s*\{[^}]*\}/s)?.[0] || '';
            expect(iconButton).toMatch(/width:\s*var\(--address-control-height\)/);
            expect(iconButton).toMatch(/height:\s*var\(--address-control-height\)/);
            expect(iconButton).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
            expect(iconButton).toMatch(/align-items:\s*center/);
            expect(iconButton).toMatch(/justify-content:\s*center/);
        }

        const addressFieldCss = readCss('ui/AddressField.module.css');
        const readOnlyValue = addressFieldCss.match(/\.readOnlyValue\s*\{[^}]*\}/s)?.[0] || '';
        expect(readOnlyValue).toMatch(/inset-inline-start:\s*var\(--address-control-padding-x\)/);
        expect(readOnlyValue).toMatch(/font-size:\s*var\(--address-control-font-size\)/);

        const networkFilterCss = readCss('shared/components/NetworkFilter.module.css');
        const expectedNetworkIcons = { sm: 'sm', md: 'md', lg: 'md' };
        for (const [size, iconSize] of Object.entries(expectedNetworkIcons)) {
            const block = networkFilterCss.match(
                new RegExp(`\\.${size}\\s*\\{[^}]*\\}`, 's'),
            )?.[0] || '';
            expect(block).toMatch(new RegExp(`--xc-icon-size:\\s*var\\(--xc-icon-${iconSize}\\)`));
            expect(block).toMatch(/--network-filter-icon-size:\s*var\(--xc-icon-size\)/);
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
