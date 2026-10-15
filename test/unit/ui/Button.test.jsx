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
import { withEnglishCopy } from '../../helpers/englishSource.js';
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

    it('loading disables re-submit while preserving the accessible label and layout content', () => {
        render(<Button loading icon={<SendIcon />}>Signing</Button>);
        const btn = screen.getByRole('button');
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');

        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
        expect(btn).toHaveAccessibleName('Signing');
        expect(btn.querySelector(`.${styles.spinner}`)).toHaveAttribute('aria-hidden', 'true');
        expect(btn.querySelector(`.${styles.icon}`)).toBeInTheDocument();
        expect(btn.querySelector(`.${styles.label}`)).toHaveTextContent('Signing');
        // Button overlays the kit Spinner through .busySpinner so the shared .spinner stays an inline loader.
        expect(css).toMatch(/\.busySpinner\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s);
        expect(css).toMatch(/\.spinnerStatus\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
        expect(css).toMatch(/\.loading \.icon,\s*\.loading \.label\s*\{[^}]*opacity:\s*0/s);
    });

    it('keeps audited route action labels stable while their kit buttons are busy', () => {
        const readSource = (path) => withEnglishCopy(readFileSync(`packages/core/src/shared/${path}`, 'utf8'));
        const order = readSource('components/PlaceOrderPanel.jsx');
        const dispenser = readSource('routes/DispenserForm.jsx');
        const vote = readSource('routes/CreatePollForm.jsx');
        const create = readSource('routes/CreateWallet.jsx');
        const imported = readSource('routes/ImportWallet.jsx');

        expect(order).toMatch(/loading=\{accountLoading \|\| actionConfirm\.composing\}[\s\S]*?\{singleEncode \? t\('components\.placeOrderPanel\.placeOrder', \{ side \}\) : t\('common\.review'\)\}/);
        expect(dispenser).toMatch(/loading=\{derivingGetAddress \|\| actionConfirm\.composing\}[\s\S]*?>\s*Create\s*<\/Button>/);
        expect(vote).not.toMatch(/actionConfirm\.composing \? 'Preparing review/);
        expect(create).toMatch(/<Button loading icon=\{<Icon\.CheckIcon \/>\}>Create wallet<\/Button>/);
        expect(imported).not.toMatch(/\{busy \? t\('importWallet\.(?:importing|restoring)'\)/);
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

    it('gives link actions the shared inline-link treatment', () => {
        render(<Button variant="link" icon={null}>Learn more</Button>);
        const button = screen.getByRole('button');
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
        const linkRule = /\.link\s*\{([^}]*)\}/.exec(css)?.[1];

        expect(button).toHaveClass(styles.btn, styles.link);
        expect(linkRule).toMatch(/color:\s*var\(--xc-accent-text\)/);
        expect(linkRule).toMatch(/text-decoration:\s*underline/);
        expect(linkRule).toMatch(/text-underline-offset:\s*0\.15em/);
        expect(linkRule).toMatch(/min-height:\s*var\(--xc-tap-min\)/);
    });

    it.each([
        'shared/components/DraftDiscardButton.jsx',
        'shared/components/LearnNote.jsx',
        'shared/routes/BetFeedDetail.jsx',
        'shared/routes/ContactsList.jsx',
        'shared/routes/CreateOrderForm.jsx',
        'shared/routes/Locked.jsx',
    ])('%s uses the link variant for its text action', (path) => {
        const source = readFileSync(`packages/core/src/${path}`, 'utf8');

        expect(source).toMatch(/<Button\b[^>]*variant="link"[^>]*icon=\{null\}/);
    });

    it('keeps kit styles when a caller adds a contextual class', () => {
        render(<Button className="context-action">Go</Button>);
        expect(screen.getByRole('button')).toHaveClass(styles.btn, styles.md, 'context-action');
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
        const sizes = [['sm', '28'], ['md', '36'], ['lg', '44']];
        const followsSharedScale = (candidate) => sizes.every(([size, height]) => new RegExp(
            `\\.${size}\\s*\\{[^}]*min-height:\\s*var\\(--xc-control-h-${size},\\s*${height}px\\)`,
            's',
        ).test(candidate));
        for (const [size] of sizes) {
            expect(css).toMatch(new RegExp(
                `\\.${size}\\s*\\{[^}]*--xc-button-height:\\s*var\\(--xc-control-h-${size}\\)`
                + `[^}]*--xc-button-font-size:\\s*var\\(--xc-control-font-${size},\\s*\\d+(?:\\.\\d+)?(?:px|rem)\\)`
                + `[^}]*--xc-button-padding-x:\\s*var\\(--xc-button-pad-x-${size},\\s*\\d+px\\)`
                + `[^}]*--xc-icon-size:\\s*var\\(--xc-control-icon-${size},\\s*\\d+px\\)`,
                's',
            ));
        }
        expect(followsSharedScale(css)).toBe(true);
        const shortened = css.replace(
            'min-height: var(--xc-control-h-sm, 28px)',
            'min-height: 20px',
        );
        expect(shortened).not.toBe(css);
        expect(followsSharedScale(shortened)).toBe(false);
        expect(css).toMatch(/\.btn\s*\{[^}]*padding-block:\s*0[^}]*padding-inline:\s*var\(--xc-button-padding-x,\s*16px\)/s);
        expect(css).toMatch(/\.btn\s*\{[^}]*border-radius:\s*var\(--xc-control-radius,\s*8px\)/s);
        expect(css).toMatch(/\.btn\s*\{[^}]*font-size:\s*var\(--xc-button-font-size,\s*14px\)/s);
        expect(css).toMatch(/\.btn\s*\{[^}]*line-height:\s*var\(--xc-control-line,\s*1\.25\)/s);
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
            if (component === 'AddressField') {
                // The end padding clears the icon action alone, or Paste and
                // the icon together when the field shows the in-field Paste.
                expect(source).toMatch(/'--address-end-room': endRoom/);
                expect(source).toMatch(
                    /'calc\(var\(--address-control-height\) \+ var\(--xc-space-2\)\)'/,
                );
                expect(source).toMatch(
                    /'calc\(var\(--address-paste-width\) \+ var\(--address-control-height\)\)'/,
                );
            }
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
            expect(iconButton).toMatch(/align-items:\s*center/);
            expect(iconButton).toMatch(/justify-content:\s*center/);
            if (component === 'AddressField') {
                // AddressField wraps the kit Button, which takes its square box from the size prop.
                expect(source).toMatch(/<Button[\s\S]*?size=\{size\}/);
                continue;
            }
            expect(iconButton).toMatch(/width:\s*var\(--address-control-height\)/);
            expect(iconButton).toMatch(/height:\s*var\(--address-control-height\)/);
            expect(iconButton).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
            expect(iconButton).toMatch(/align-items:\s*center/);
            expect(iconButton).toMatch(/justify-content:\s*center/);
        }

        const addressComboboxCss = readCss('ui/AddressCombobox.module.css');
        const addressComboboxSource = readFileSync('packages/core/src/ui/AddressCombobox.jsx', 'utf8');
        const addressPaste = addressComboboxCss.match(/\.pasteAction button\s*\{[^}]*\}/s)?.[0] || '';
        expect(addressComboboxSource).toMatch(/className=\{styles\.pasteAction\}/);
        // Paste sits inside the field box, inset from its end edge.
        expect(addressPaste).toMatch(/inset-inline-end:\s*var\(--xc-space-1\)/);
        // At the field's inner height: the control height less the inset.
        expect(addressPaste).toMatch(/height:\s*calc\(var\(--address-control-height\) - var\(--xc-space-2\)\)/);
        expect(addressPaste).toMatch(/min-height:\s*calc\(var\(--address-control-height\) - var\(--xc-space-2\)\)/);

        const amountCss = readCss('shared/components/AmountField.module.css');
        const amountSource = readFileSync('packages/core/src/shared/components/AmountField.jsx', 'utf8');
        const amountActions = amountCss.match(/\.amountFieldWrap \.pasteAction button,\s*\.amountFieldWrap \.maxAction\s*\{[^}]*\}/s)?.[0] || '';
        expect(amountSource).toMatch(/className=\{styles\.pasteAction\}/);
        expect(amountSource).toMatch(/className=\{styles\.maxAction\}/);
        expect(amountActions).toMatch(/position:\s*absolute/);
        expect(amountActions).toMatch(/height:\s*calc\(var\(--amount-control-height\) - var\(--xc-space-2\)\)/);
        expect(amountActions).toMatch(/min-height:\s*calc\(var\(--amount-control-height\) - var\(--xc-space-2\)\)/);
        expect(amountCss).toMatch(/\.maxAction\s*\{[^}]*inset-inline-end:\s*var\(--xc-space-1\)/s);

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
        expect(button).toHaveAttribute('title', 'Send');
        expect(css).toMatch(/\.iconOnly\s*\{[^}]*width:\s*var\(--xc-button-height\)[^}]*min-width:\s*var\(--xc-button-height\)/s);
        expect(css).toMatch(/@media \(pointer:\s*coarse\), \(hover:\s*none\)[\s\S]*?\.sm::before\s*\{[^}]*width:\s*max\(100%,\s*var\(--xc-control-hit-min,\s*24px\)\)[^}]*height:\s*max\(100%,\s*var\(--xc-control-hit-min,\s*24px\)\)/s);
    });

    it('rejects an icon-only button without an accessible name', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const preventExpectedError = (event) => event.preventDefault();
        window.addEventListener('error', preventExpectedError);
        try {
            expect(() => render(<Button icon={<SendIcon />} />))
                .toThrow('Icon-only Button requires an aria-label or aria-labelledby.');
        } finally {
            window.removeEventListener('error', preventExpectedError);
            consoleError.mockRestore();
        }
    });

    it('centres an icon-only button icon with no label span or gap beside it', () => {
        render(<Button icon={<SendIcon />} aria-label="Lock wallet" />);
        const button = screen.getByRole('button', { name: 'Lock wallet' });
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');

        expect(button.children).toHaveLength(1);
        expect(button.querySelector(`.${styles.label}`)).toBeNull();
        expect(css).toMatch(/\.iconOnly\s*\{[^}]*gap:\s*0[^}]*justify-content:\s*center/s);
    });
});
