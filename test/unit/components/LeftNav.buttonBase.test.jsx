// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import navStyles from '../../../packages/core/src/shared/components/LeftNav.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const baseProps = {
    currentView: 'home',
    onSelect: vi.fn(),
    onOpenSettings: vi.fn(),
    onLock: vi.fn(),
    hasVmAddress: true,
};

function navRows(container) {
    return [...container.querySelectorAll('nav li > button, nav button[title]')]
        .filter((button) => button.classList.contains(navStyles.item));
}

function classesOf(button) {
    return [...button.classList];
}

// Every destination row in the left navigation stands on the shared Button
// base (one variant, one size) while keeping its own full-row nav look.
describe('LeftNav rows use the shared Button base', () => {
    it('gives every primary, secondary and Settings row the Button base, one variant and the md size', () => {
        const { container } = render(<LeftNav {...baseProps} />);
        const rows = navRows(container);
        const names = rows.map((row) => row.getAttribute('title'));

        expect(rows.length).toBeGreaterThan(5);
        expect(names).toContain('Home');
        expect(names).toContain('Settings');
        for (const row of rows) {
            const classes = classesOf(row);
            expect(classes, row.title).toContain(buttonStyles.btn);
            expect(classes, row.title).toContain(buttonStyles.ghost);
            expect(classes, row.title).toContain(buttonStyles.md);
            expect(classes, row.title).toContain(navStyles.item);
            expect(row.tagName).toBe('BUTTON');
            expect(row.getAttribute('type')).toBe('button');
        }
    });

    it('keeps exactly one variant and one size class on each row', () => {
        const { container } = render(<LeftNav {...baseProps} />);
        const variants = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
        const sizes = ['sm', 'md', 'lg'];
        for (const row of navRows(container)) {
            const classes = classesOf(row);
            expect(variants.filter((v) => classes.includes(buttonStyles[v])), row.title).toHaveLength(1);
            expect(sizes.filter((s) => classes.includes(buttonStyles[s])), row.title).toHaveLength(1);
        }
    });

    it.each([
        ['home', 'Home'],
        ['settings', 'Settings'],
    ])('marks the active row for %s with itemActive beside the Button base', (currentView, label) => {
        const { container } = render(<LeftNav {...baseProps} currentView={currentView} />);
        const active = container.querySelectorAll('[aria-current="page"]');

        expect(active).toHaveLength(1);
        expect(active[0]).toHaveTextContent(label);
        const classes = classesOf(active[0]);
        expect(classes).toContain(buttonStyles.btn);
        expect(classes).toContain(navStyles.item);
        expect(classes).toContain(navStyles.itemActive);
        for (const row of navRows(container).filter((r) => r !== active[0])) {
            expect(classesOf(row), row.title).not.toContain(navStyles.itemActive);
        }
    });

    it('restates the nav row look after the Button base so rows keep their layout', () => {
        const css = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/LeftNav.module.css'),
            'utf8',
        ).replace(/\/\*[\s\S]*?\*\//g, '');
        const item = css.match(/(^|\n)\.item\s*\{([^}]*)\}/)?.[2] ?? '';

        expect(item).toMatch(/justify-content:\s*flex-start\s*;/);
        expect(item).toMatch(/font-weight:\s*400\s*;/);
        expect(item).toMatch(/font-size:\s*var\(--xc-text-sm\)\s*;/);
        expect(item).toMatch(/padding:\s*var\(--xc-space-2\) var\(--xc-space-4\)\s*;/);
        expect(item).toMatch(/--xc-button-hover-bg:\s*var\(--xc-surface\)\s*;/);
        expect(item).toMatch(/--xc-button-hover-border:\s*transparent\s*;/);
        expect(css).not.toMatch(/composes:[^;]*Button\.module\.css/);

        const source = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/LeftNav.jsx'),
            'utf8',
        );
        // The Button sheet loads ahead of the nav sheet, so equal-specificity
        // nav rules win the cascade.
        const buttonImport = source.indexOf("import buttonStyles from '../../ui/Button.module.css'");
        const navImport = source.indexOf("import styles from './LeftNav.module.css'");
        expect(buttonImport).toBeGreaterThan(-1);
        expect(buttonImport).toBeLessThan(navImport);
    });
});
