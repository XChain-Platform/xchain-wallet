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

    it('uses the shared large control height and existing interaction tokens', () => {
        const css = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');

        expect(css).toMatch(/min-height:\s*var\(--xc-control-h-lg,\s*24px\)/);
        expect(css).toMatch(/\.interactive:hover:not\(:disabled\)\s*\{[^}]*var\(--xc-bg-muted\)/s);
        expect(css).toMatch(/\.interactive:focus-visible\s*\{[^}]*var\(--xc-focus-ring\)/s);
        expect(css).not.toContain('var(--xc-page-gutter)');
    });
});
