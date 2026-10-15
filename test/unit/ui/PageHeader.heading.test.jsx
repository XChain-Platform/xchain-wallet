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
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { Screen } from '../../../packages/core/src/ui/Screen.jsx';
import * as Icons from '../../../packages/core/src/ui/icons/index.jsx';

const traverse = _traverse.default || _traverse;
const sharedSources = import.meta.glob(
    '../../../packages/core/src/shared/**/*.jsx',
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

function findNodes(node, predicate, matches = []) {
    if (!node || typeof node !== 'object') return matches;
    if (predicate(node)) matches.push(node);
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end'].includes(key)) continue;
        if (Array.isArray(value)) {
            for (const child of value) findNodes(child, predicate, matches);
        } else {
            findNodes(value, predicate, matches);
        }
    }
    return matches;
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
        const back = rule(pageHeaderCss, '.back');
        const title = rule(pageHeaderCss, '.title');
        const trailingButton = rule(pageHeaderCss, '.trailing button:not([role="menuitem"])');

        expect(header).toMatch(/--xc-page-header-side:\s*var\(--xc-control-h-md\)/);
        expect(header).toMatch(
            /grid-template-columns:\s*var\(--xc-page-header-side\)\s+minmax\(0,\s*1fr\)\s+var\(--xc-page-header-side\)/,
        );
        expect(back).toMatch(/width:\s*var\(--xc-page-header-side\)/);
        expect(back).toMatch(/height:\s*var\(--xc-page-header-side\)/);
        expect(back).toMatch(/padding:\s*0/);
        expect(back).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
        expect(title).toMatch(/overflow-wrap:\s*anywhere/);
        expect(title).toMatch(/white-space:\s*normal/);
        expect(title).toMatch(/-webkit-line-clamp:\s*1/);
        expect(title).toMatch(/overflow:\s*hidden/);
        expect(trailingButton).toMatch(/width:\s*var\(--xc-control-h-sm\)/);
        expect(trailingButton).toMatch(/height:\s*var\(--xc-control-h-sm\)/);
        expect(trailingButton).toMatch(/border-radius:\s*var\(--xc-control-radius\)/);
        expect(trailingButton).toMatch(/--xc-icon-size:\s*var\(--xc-icon-md\)/);
        expect(pageHeaderCss).not.toMatch(/@media/);
    });

    it('keeps every shared screen on the back row and renders a non-zero trailing action icon', () => {
        let headerCount = 0;
        const handRolledBackRows = [];
        const invalidTrailingActions = [];
        const pageHeaderActions = [];

        for (const [file, source] of Object.entries(sharedSources)) {
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
                    const actions = findNodes(
                        trailing.value,
                        (node) => node.type === 'JSXElement'
                            && jsxName(node.openingElement.name) === 'Button',
                    ).filter((action) => !action.openingElement.attributes.some(
                        (attribute) => attribute.type === 'JSXAttribute'
                            && attribute.name.name === 'role'
                            && attribute.value?.value === 'menuitem',
                    ));
                    if (actions.length === 0) {
                        invalidTrailingActions.push(file);
                        return;
                    }
                    for (const action of actions) {
                        const attributes = action.openingElement.attributes || [];
                        const iconAttribute = attributes.find(
                            (attribute) => attribute.type === 'JSXAttribute'
                                && attribute.name.name === 'icon',
                        );
                        const hasLabel = attributes.some(
                            (attribute) => attribute.type === 'JSXAttribute'
                                && attribute.name.name === 'aria-label',
                        );
                        const propIconNode = findNode(
                            iconAttribute?.value,
                            (node) => node.type === 'JSXOpeningElement'
                                && jsxName(node.name).startsWith('Icon.'),
                        );
                        const childIconNode = findNode(
                            action.children,
                            (node) => node.type === 'JSXOpeningElement'
                                && jsxName(node.name).startsWith('Icon.'),
                        );
                        const iconNode = propIconNode || childIconNode;
                        if (!hasLabel || !iconNode) {
                            invalidTrailingActions.push(file);
                            continue;
                        }
                        pageHeaderActions.push({
                            file,
                            iconName: jsxName(iconNode.name).slice(5),
                            iconMode: propIconNode
                                ? 'prop'
                                : iconAttribute ? 'null-prop-child' : 'child',
                        });
                    }
                },
            });
        }

        expect(headerCount).toBeGreaterThan(90);
        expect(handRolledBackRows).toEqual([]);
        expect(invalidTrailingActions).toEqual([]);
        expect(pageHeaderActions.length).toBeGreaterThan(10);

        expect(pageHeaderActions.some(({ iconMode }) => iconMode === 'prop')).toBe(true);
        expect(pageHeaderActions.some(({ iconMode }) => iconMode !== 'prop')).toBe(true);

        for (const { file, iconName, iconMode } of pageHeaderActions) {
            const ActionIcon = Icons[iconName];
            expect(ActionIcon, `${file} must use an exported icon`).toBeTypeOf('function');
            const action = iconMode === 'prop' ? (
                <Button icon={<ActionIcon />} aria-label={`Action from ${file}`} />
            ) : (
                <Button
                    {...(iconMode === 'null-prop-child' ? { icon: null } : {})}
                    aria-label={`Action from ${file}`}
                >
                    <ActionIcon />
                </Button>
            );
            const view = render(
                <PageHeader
                    title="Action inventory"
                    trailing={action}
                />,
            );
            const svg = screen.getByRole('button', { name: `Action from ${file}` })
                .querySelector('svg[data-xc-icon]');
            expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(0);
            expect(Number(svg?.getAttribute('height'))).toBeGreaterThan(0);
            view.unmount();
        }

        const trailingButton = rule(pageHeaderCss, '.trailing button:not([role="menuitem"])');
        const trailingIcon = rule(
            pageHeaderCss,
            '.trailing button:not([role="menuitem"]) svg[data-xc-icon]',
        );
        expect(trailingButton).toMatch(/padding:\s*0/);
        expect(trailingButton).toMatch(/gap:\s*0/);
        expect(trailingIcon).toMatch(/min-width:\s*var\(--xc-icon-size\)/);
        expect(trailingIcon).toMatch(/flex:\s*0 0 var\(--xc-icon-size\)/);
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
        // Safari 16 lacks scrollbar-gutter, so the reservation sits behind @supports.
        expect(screenCss).toMatch(/@supports \(scrollbar-gutter: stable\)\s*\{\s*\.body\s*\{[^}]*scrollbar-gutter:\s*stable/s);
    });
});
