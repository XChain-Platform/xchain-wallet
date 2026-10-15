// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '@babel/parser';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from '../../../packages/core/src/ui/EmptyState.jsx';

function workspaceRoot() {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src', 'shared', 'routes'))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error('wallet workspace not found');
        dir = parent;
    }
    return dir;
}

function jsxFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return jsxFiles(path);
        return entry.name.endsWith('.jsx') ? [path] : [];
    });
}

function visit(node, callback) {
    if (!node || typeof node !== 'object') return;
    callback(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
        else if (value && typeof value === 'object') visit(value, callback);
    }
}

describe('empty-state consistency', () => {
    it('keeps geometry and type in the shared tokenized stylesheet', () => {
        const stylesheet = readFileSync(join(
            workspaceRoot(),
            'packages',
            'core',
            'src',
            'ui',
            'EmptyState.module.css',
        ), 'utf8');

        expect(stylesheet).toMatch(/\.wrap\s*\{[^}]*padding:\s*var\(--xc-space-6\) var\(--xc-space-4\)/s);
        expect(stylesheet).toMatch(/\.icon\s*\{[^}]*--xc-icon-size:\s*var\(--xc-icon-xl\)/s);
        expect(stylesheet).toMatch(/\.title\s*\{[^}]*font-size:\s*var\(--xc-type-card-title-size\)[^}]*font-weight:\s*var\(--xc-type-card-title-weight\)/s);
        expect(stylesheet).toMatch(/\.body\s*\{[^}]*max-width:\s*var\(--xc-prose-max-width\)[^}]*font-size:\s*var\(--xc-type-body-size\)/s);
        expect(stylesheet).toMatch(/\.actions\s*\{[^}]*display:\s*flex[^}]*gap:\s*var\(--xc-space-2\)/s);
        expect(stylesheet).not.toMatch(/\.icon svg\s*\{[^}]*(?:width|height):\s*32px/s);
    });

    it('keeps primary and outline actions ordered inside the shared state', () => {
        const onPrimary = vi.fn();
        const onSecondary = vi.fn();
        render(
            <EmptyState
                data-testid="route-empty-state"
                title="No items"
                body="Items appear here."
                actionLabel="Create item"
                onAction={onPrimary}
                secondaryActionLabel="Learn more"
                onSecondaryAction={onSecondary}
            />,
        );

        const state = screen.getByTestId('route-empty-state');
        const actions = within(state).getAllByRole('button');
        expect(actions.map((button) => button.textContent)).toEqual(['Create item', 'Learn more']);
        expect(actions[0].className).toMatch(/primary/);
        expect(actions[1].className).toMatch(/secondary/);
        fireEvent.click(actions[0]);
        fireEvent.click(actions[1]);
        expect(onPrimary).toHaveBeenCalledOnce();
        expect(onSecondary).toHaveBeenCalledOnce();
    });

    it('keeps every route on the shared component without geometry overrides', () => {
        const routes = join(workspaceRoot(), 'packages', 'core', 'src', 'shared', 'routes');
        const faults = [];
        let states = 0;

        for (const file of jsxFiles(routes)) {
            const source = readFileSync(file, 'utf8');
            const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
            const importsSharedState = tree.program.body.some((statement) => (
                statement.type === 'ImportDeclaration'
                && statement.source.value === '@xchain-wallet/core/ui'
                && statement.specifiers.some((specifier) => (
                    specifier.type === 'ImportSpecifier'
                    && specifier.imported.name === 'EmptyState'
                ))
            ));

            visit(tree.program, (node) => {
                if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return;
                if (node.name.name === 'EmptyStateNudge') {
                    faults.push(`${file}: uses legacy EmptyStateNudge`);
                    return;
                }
                if (node.name.name !== 'EmptyState') return;
                states += 1;
                if (!importsSharedState) faults.push(`${file}: EmptyState is not imported from the UI kit`);
                for (const attribute of node.attributes) {
                    if (attribute.type === 'JSXAttribute'
                        && ['className', 'style'].includes(attribute.name.name)) {
                        faults.push(`${file}:${node.loc.start.line} overrides ${attribute.name.name}`);
                    }
                }
            });
        }

        expect(states).toBeGreaterThan(0);
        expect(faults).toEqual([]);
    });
});
