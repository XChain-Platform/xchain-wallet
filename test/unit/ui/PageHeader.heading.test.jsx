// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pin the shared page chrome's semantics and its narrow-screen layout
// constraints so every route inherits one accessible, single-scroll shell.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { Screen } from '../../../packages/core/src/ui/Screen.jsx';

const pageHeaderCss = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');
const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

afterEach(() => cleanup());

describe('PageHeader', () => {
    it('renders the title as the level-one heading', () => {
        render(<PageHeader title="Decentralized Exchange" onBack={() => {}} />);
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toBe('Decentralized Exchange');
    });

    it('gives the back button a useful default label and runs its action', () => {
        const onBack = vi.fn();
        render(<PageHeader title="Wallet details" onBack={onBack} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('expands a generic back label to name its destination', () => {
        render(<PageHeader title="Publish file" onBack={() => {}} backLabel="Back" />);

        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    });

    it('uses a route-specific back label and keeps a disabled action inert', () => {
        const onBack = vi.fn();
        render(
            <PageHeader
                title="Action"
                onBack={onBack}
                backLabel="Back to history"
                backDisabled
            />,
        );

        const back = screen.getByRole('button', { name: 'Back to history' });
        expect(back).toBeDisabled();
        fireEvent.click(back);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('wraps a long title in a shrinkable lane between fixed actions at 320px', () => {
        const header = rule(pageHeaderCss, '.header');
        const title = rule(pageHeaderCss, '.title');
        const trailingButton = rule(pageHeaderCss, '.trailing button:not([role="menuitem"])');

        expect(header).toMatch(/--xc-page-header-side:\s*38px/);
        expect(header).toMatch(
            /grid-template-columns:\s*var\(--xc-page-header-side\)\s+minmax\(0,\s*1fr\)\s+var\(--xc-page-header-side\)/,
        );
        expect(title).toMatch(/overflow-wrap:\s*anywhere/);
        expect(title).toMatch(/white-space:\s*normal/);
        expect(title).not.toMatch(/text-overflow:\s*ellipsis/);
        expect(trailingButton).toMatch(/width:\s*var\(--xc-page-header-side\)/);
    });
});

describe('Screen layout', () => {
    it('uses landmarks around one focusable main scroll container', () => {
        render(
            <Screen
                header={<PageHeader title="Settings" />}
                footer={<button type="button">Save</button>}
            >
                <p>Preferences</p>
            </Screen>,
        );

        expect(screen.getByRole('banner')).toBeInTheDocument();
        expect(screen.getByRole('main')).toHaveAttribute('id', 'xc-main');
        expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    });

    it('keeps the document safe area and gives scrolling to Screen body only', () => {
        const body = rule(tokensCss, 'body');
        const viewport = tokensCss.match(/--xc-viewport-h:\s*calc\(100vh[^;]+;/)?.[0] || '';
        const shell = rule(screenCss, '.screen');
        const scrollBody = rule(screenCss, '.body');

        expect(body).toMatch(/padding-top:\s*env\(safe-area-inset-top,\s*0\)/);
        expect(body).toMatch(/padding-left:\s*env\(safe-area-inset-left,\s*0\)/);
        expect(body).toMatch(/padding-right:\s*env\(safe-area-inset-right,\s*0\)/);
        expect(viewport).toMatch(/100vh\s*-\s*env\(safe-area-inset-top,\s*0px\)/);
        expect(shell).toMatch(/overflow:\s*hidden/);
        expect(scrollBody).toMatch(/min-height:\s*0/);
        expect(scrollBody).toMatch(/overflow-y:\s*auto/);
        expect(scrollBody).toMatch(/overflow-x:\s*hidden/);
        expect(scrollBody).toMatch(/scrollbar-gutter:\s*stable/);
    });
});
