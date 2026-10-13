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
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { Screen } from '../../../packages/core/src/ui/Screen.jsx';

const traverse = _traverse.default || _traverse;
const routeSources = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

const pageHeaderCss = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');
const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

function jsxName(node) {
    if (!node) return '';
    if (node.type === 'JSXIdentifier') return node.name;
    if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${jsxName(node.property)}`;
    return '';
}

function findNode(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end'].includes(key)) continue;
        if (Array.isArray(value)) {
            for (const child of value) {
                const found = findNode(child, predicate);
                if (found) return found;
            }
        } else {
            const found = findNode(value, predicate);
            if (found) return found;
        }
    }
    return null;
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

    it('truncates a long title between mirrored fixed actions at every width', () => {
        const header = rule(pageHeaderCss, '.header');
        const title = rule(pageHeaderCss, '.title');
        const trailingButton = rule(pageHeaderCss, '.trailing button:not([role="menuitem"])');

        expect(header).toMatch(/--xc-page-header-side:\s*38px/);
        expect(header).toMatch(
            /grid-template-columns:\s*var\(--xc-page-header-side\)\s+minmax\(0,\s*1fr\)\s+var\(--xc-page-header-side\)/,
        );
        expect(title).toMatch(/overflow-wrap:\s*anywhere/);
        expect(title).toMatch(/white-space:\s*normal/);
        expect(title).toMatch(/-webkit-line-clamp:\s*1/);
        expect(title).toMatch(/overflow:\s*hidden/);
        expect(trailingButton).toMatch(/width:\s*var\(--xc-page-header-side\)/);
        expect(trailingButton).toMatch(/height:\s*var\(--xc-page-header-side\)/);
        expect(trailingButton).toMatch(/--xc-icon-size:\s*var\(--xc-icon-md\)/);
        expect(pageHeaderCss).not.toMatch(/@media/);
    });

    it('keeps every route on the shared back row and icon-only trailing action contract', () => {
        let headerCount = 0;
        const handRolledBackRows = [];
        const invalidTrailingActions = [];

        for (const [file, source] of Object.entries(routeSources)) {
            const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
            traverse(ast, {
                JSXElement(path) {
                    const opening = path.node.openingElement;
                    const name = jsxName(opening.name);
                    if (['div', 'header'].includes(name)) {
                        const className = opening.attributes.find(
                            (attribute) => attribute.type === 'JSXAttribute'
                                && attribute.name.name === 'className',
                        );
                        const usesHeaderClass = findNode(
                            className?.value,
                            (node) => node.type === 'MemberExpression'
                                && node.property?.name === 'header',
                        );
                        const containsBackIcon = findNode(
                            path.node.children,
                            (node) => node.type === 'JSXOpeningElement'
                                && jsxName(node.name).endsWith('BackIcon'),
                        );
                        if (usesHeaderClass && containsBackIcon) handRolledBackRows.push(file);
                    }
                    if (name !== 'PageHeader') return;
                    headerCount += 1;
                    const trailing = opening.attributes.find(
                        (attribute) => attribute.type === 'JSXAttribute'
                            && attribute.name.name === 'trailing',
                    );
                    if (!trailing) return;
                    const action = findNode(
                        trailing.value,
                        (node) => node.type === 'JSXElement'
                            && jsxName(node.openingElement.name) === 'Button',
                    );
                    const attributes = action?.openingElement.attributes || [];
                    const hasLabel = attributes.some(
                        (attribute) => attribute.type === 'JSXAttribute'
                            && attribute.name.name === 'aria-label',
                    );
                    const hasIcon = attributes.some(
                        (attribute) => attribute.type === 'JSXAttribute'
                            && attribute.name.name === 'icon',
                    ) || Boolean(findNode(
                        action?.children,
                        (node) => node.type === 'JSXOpeningElement'
                            && jsxName(node.name).startsWith('Icon.'),
                    ));
                    if (!action || !hasLabel || !hasIcon) invalidTrailingActions.push(file);
                },
            });
        }

        expect(headerCount).toBeGreaterThan(90);
        expect(handRolledBackRows).toEqual([]);
        expect(invalidTrailingActions).toEqual([]);
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
