// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceRoots = [
    join(root, 'packages', 'core', 'src'),
    join(root, 'packages', 'extension', 'src'),
    join(root, 'packages', 'desktop', 'renderer'),
    join(root, 'packages', 'web', 'src'),
];
const requireFromVite = createRequire(
    createRequire(join(root, 'packages', 'web', 'package.json')).resolve('vite'),
);
const postcss = requireFromVite('postcss');

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.isFile() && entry.name.endsWith('.module.css') ? [path] : [];
    });
}

const files = sourceRoots.flatMap(cssModules);
files.push(join(root, 'packages', 'core', 'src', 'ui', 'tokens.css'));

const hoverSelector = /:hover\b/;
const selectedSelector = /aria-current|aria-selected=['"]true['"]|data-selected=['"]true['"]|\.(?:selectedRow|rowSelected|rowActive|itemActive|optionActive|entryActive|walletRowActive|chainPickerOptionActive|convItemActive)(?:\W|$)/;
const menuSelector = /role=['"]menu|role=['"]menuitem|data-xc-menu-(?:list|item)/;
const rowDataSelector = /data-xc-(?:row-state|split-row)/;
const rowClass = /^(?:row|item|option|entry|selectedRow|groupCard|marketRow|walletRow|convItem|chainPickerOption|abRow|copyMenuItem|addMenuItem|headerMoreItem|actionRow|fileLink)(?:$|[A-Z_-])/;
const controlClass = /^(?:tab|segment|toggle|chip|range|sliderTick|hiddenToggle|portion|pick|button|btn|iconButton|quickAction|tile|eye|dot)/;

function stateClassBefore(selector, marker) {
    const prefix = marker ? selector.slice(0, selector.indexOf(marker)) : selector;
    const classes = [...prefix.matchAll(/\.([A-Za-z_][\w-]*)/g)];
    return classes.at(-1)?.[1] ?? '';
}

function isRowOrMenuState(file, selector, state) {
    if (/aria-(?:pressed|checked)/.test(selector)) return false;
    if (menuSelector.test(selector) || rowDataSelector.test(selector)) return true;

    const stateClass = stateClassBefore(selector, state === 'hover' ? ':hover' : '');
    if (controlClass.test(stateClass)) return false;
    if (rowClass.test(stateClass)) return true;

    if (state === 'selected' && /ActivityRow\.module\.css$/.test(file) && selector.includes('.selected')) {
        return true;
    }
    if (state === 'selected' && /ListRow\.module\.css$/.test(file)) return true;
    return false;
}

function stateBackgroundFailures() {
    const failures = [];
    for (const path of files) {
        const file = relative(root, path).split('\\').join('/');
        const sheet = postcss.parse(readFileSync(path, 'utf8'), { from: path });
        sheet.walkRules((rule) => {
            const selector = rule.selector ?? '';
            const positiveSelector = selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
            const selected = selectedSelector.test(positiveSelector);
            const hovered = hoverSelector.test(selector);
            const state = selected ? 'selected' : hovered ? 'hover' : null;
            if (!state || !isRowOrMenuState(file, positiveSelector, state)) return;
            const expected = selected ? 'var(--xc-row-active-bg)' : 'var(--xc-row-hover-bg)';
            rule.walkDecls(/^background(?:-color)?$/, (decl) => {
                const value = decl.value.trim();
                if (value === expected || value === 'transparent' || ['Highlight', 'Canvas'].includes(value)) return;
                failures.push(`${file}:${decl.source.start.line} ${selector} uses ${value}; expected ${expected}`);
            });
        });
    }
    return failures;
}

describe('list row and menu state tokens', () => {
    it('uses the side-menu tokens for row and menu hover and selection fills', () => {
        expect(stateBackgroundFailures()).toEqual([]);
    });

    it('has no nav-indicator shadow or selected leading rail on rows and menus', () => {
        const failures = [];
        for (const path of files) {
            const file = relative(root, path).split('\\').join('/');
            const source = readFileSync(path, 'utf8');
            if (source.includes('--xc-shadow-nav-indicator')) {
                failures.push(`${file} uses --xc-shadow-nav-indicator`);
            }
            const sheet = postcss.parse(source, { from: path });
            sheet.walkRules((rule) => {
                const selector = rule.selector ?? '';
                if (!selectedSelector.test(selector)
                    || !isRowOrMenuState(file, selector, 'selected')) return;
                rule.walkDecls(/^(?:border-left|border-inline-start)(?:-.+)?$/, (decl) => {
                    failures.push(`${file}:${decl.source.start.line} ${selector} uses ${decl.prop}`);
                });
            });
        }
        expect(failures).toEqual([]);
    });

    it('leaves toggle, tab and chip selections on the solid toggle token', () => {
        const read = (file) => readFileSync(join(root, file), 'utf8');
        const segmented = read('packages/core/src/ui/SegmentedControl.module.css');
        const tabs = read('packages/core/src/ui/Tabs.jsx');
        const chip = read('packages/core/src/ui/Chip.module.css');

        expect(segmented).toMatch(/\.segment:is\(\[aria-checked='true'\], \[aria-selected='true'\]\)\s*\{[^}]*background:\s*var\(--xc-toggle-selected-bg\)/s);
        expect(tabs).toContain("import toggle from './SegmentedControl.module.css'");
        expect(chip).toMatch(/\.pressed\s*\{[^}]*background:\s*var\(--xc-toggle-selected-bg\)/s);
        expect(segmented).not.toContain('var(--xc-row-active-bg)');
        expect(chip).not.toContain('var(--xc-row-active-bg)');
    });
});
