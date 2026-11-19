// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListRow } from '../../../packages/core/src/ui/ListRow.jsx';

describe('<ListRow>', () => {
    it('renders an onClick row as a native button with every slot', () => {
        const onClick = vi.fn();
        render(
            <ListRow
                leading={<span data-testid="leading">L</span>}
                title="Account"
                subtitle="Primary address"
                trailing="12.50 XCH"
                chevron
                onClick={onClick}
            />,
        );

        const row = screen.getByRole('button', { name: /Account/ });
        expect(row).toHaveAttribute('type', 'button');
        expect(screen.getByTestId('leading')).toBeInTheDocument();
        expect(row).toHaveTextContent('Primary address');
        expect(row).toHaveTextContent('12.50 XCH');
        expect(row.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        fireEvent.click(row);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('puts a tooltip on the row element without replacing its heading', () => {
        render(<ListRow title="Market" tooltip="Needs a network connection" onClick={() => {}} disabled />);
        const row = screen.getByRole('button', { name: 'Market' });
        expect(row).toHaveAttribute('title', 'Needs a network connection');
        expect(row).toBeDisabled();
    });

    it('renders an href row as a native link', () => {
        render(<ListRow href="/activity/1" title="Activity" />);

        expect(screen.getByRole('link', { name: 'Activity' }))
            .toHaveAttribute('href', '/activity/1');
    });

    it('renders a display-only row as a div outside the tab order', () => {
        const { container } = render(<ListRow title="Network status" />);
        const row = container.firstElementChild;

        expect(row?.tagName).toBe('DIV');
        expect(row).not.toHaveAttribute('tabindex');
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('keeps the label and test id on a disabled native button', () => {
        const onClick = vi.fn();
        render(
            <ListRow
                data-testid="account-row"
                disabled
                title="Disabled account"
                onClick={onClick}
            />,
        );

        const row = screen.getByTestId('account-row');
        expect(row).toHaveAccessibleName('Disabled account');
        expect(row).toBeDisabled();
        fireEvent.click(row);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('uses the shared large control height and semantic interaction tokens', () => {
        const css = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');
        const historyCss = readFileSync('packages/core/src/shared/routes/History.module.css', 'utf8');

        expect(css).toMatch(/min-height:\s*var\(--xc-control-h-lg,\s*24px\)/);
        expect(css).toMatch(/\.interactive:hover:not\(:disabled\)\s*\{[^}]*var\(--xc-row-hover-bg\)/s);
        expect(css).toMatch(/\.interactive:active:not\(:disabled\)\s*\{[^}]*var\(--xc-row-hover-bg\)[^}]*box-shadow:\s*none/s);
        expect(css).toMatch(/\.interactive:is\([^}]*var\(--xc-row-active-bg\)[^}]*box-shadow:\s*none/s);
        expect(css).toMatch(/\.interactive:is\([^}]*\):hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(css).toMatch(/\.interactive:focus-visible\s*\{[^}]*var\(--xc-control-focus-ring\)/s);
        expect(css).toMatch(/\.interactive:disabled\s*\{[^}]*var\(--xc-control-disabled-bg\)/s);
        expect(css).toMatch(/\.interactive\[data-xc-split-row\]\s*\{[^}]*width:\s*100%;[^}]*margin-inline:\s*0;[^}]*border-radius:\s*0;/s);
        expect(historyCss).toMatch(/\.row\.row\[data-xc-split-row\]\[aria-current='true'\]\s*\{[^}]*var\(--xc-row-active-bg\)[^}]*box-shadow:\s*none/s);
        expect(historyCss).not.toContain('var(--xc-shadow-nav-indicator)');
        expect(css).not.toContain('var(--xc-page-gutter)');
    });

    // G21: an expandable row's chevron points right while closed and down while
    // open. The slot shows only the middle third of a 32px box, so a down glyph
    // drawn in it loses its arms; the open state turns the whole clipped box.
    it('turns the standard chevron down on an open expandable row instead of drawing a down glyph in the slot', () => {
        const css = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');
        expect(css).toMatch(/\.interactive\[aria-expanded='true'\]\s*>\s*\.chevron\s*\{[^}]*transform:\s*rotate\(90deg\)/s);
        expect(css).toMatch(/\[dir='rtl'\]\)\s*\.interactive\[aria-expanded='true'\]\s*>\s*\.chevron\s*\{[^}]*transform:\s*rotate\(-90deg\)/s);

        render(<ListRow title="Transaction 1" chevron aria-expanded onClick={() => {}} />);
        const row = screen.getByRole('button', { name: 'Transaction 1' });
        expect(row).toHaveAttribute('aria-expanded', 'true');
        expect(row.querySelector('svg path')).toHaveAttribute('d', 'm9 18 6-6-6-6');

        for (const file of [
            'packages/core/src/shared/routes/BatchComposerForm.jsx',
            'packages/core/src/shared/components/MultiSendRecipients.jsx',
        ]) {
            expect(readFileSync(file, 'utf8'), file).not.toMatch(/chevron=\{[^}]*ChevronDownIcon/);
        }
    });
});
