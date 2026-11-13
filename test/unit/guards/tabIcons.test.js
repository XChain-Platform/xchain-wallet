// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static guard for the app-wide tab icon rule:
//
//   1. Every tab carries an icon: a `role="tab"` element renders an icon (an
//      `icon` prop or the shared tabIcon wrapper), and every item of a
//      `<Tabs items>` bar or of a tab array (`tabs`, `tabItems`, `sectionItems`,
//      `detailTabs`, `subtabs`) has an icon in its label or an `icon` field.
//   2. The same meaning uses the same icon everywhere: an Actions tab uses
//      ZapIcon, a Details tab uses InfoIcon, and an Activity or History tab
//      uses HistoryIcon.
//
// A tab bar that cannot carry icons by design is listed in EXCEPTIONS with the
// reason, so a new bar cannot skip the rule unnoticed.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob([
    '../../../packages/core/src/**/*.jsx',
    '../../../packages/extension/src/**/*.jsx',
    '../../../packages/desktop/**/*.jsx',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];

const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

// Tab bars that are not icon tabs, keyed by file. Each says why.
const EXCEPTIONS = new Map([
    ['packages/core/src/ui/Tabs.jsx',
        'the shared tab primitive renders each item label as given; every <Tabs items> use is checked at its call site'],
    ['packages/core/src/shared/components/PortfolioChart.jsx',
        'the chart range pills (1D, 1W, 1M) are time ranges, a short text pill each, not view tabs'],
    ['packages/core/src/shared/routes/OnboardingCarousel.jsx',
        'the carousel page dots are role="tab" for assistive tech only and carry no label'],
]);

// Tab meaning (by tab id) to the one icon every bar uses for it.
const STANDARD_ICONS = new Map([
    ['actions', 'ZapIcon'],
    ['details', 'InfoIcon'],
    ['activity', 'HistoryIcon'],
    ['history', 'HistoryIcon'],
]);

const TAB_ARRAY_NAMES = /^(tabs|tabItems|sectionItems|detailTabs|subtabs)$/;

// Text that shows an icon is drawn: an Icon.X element or reference, a
// tabLabel/tabIcon helper call, a Glyph component, an `icon` field or the
// shared tabIcon class.
const ICON_TEXT = /\bIcon\.\w+Icon\b|\btab(Label|Icon)\(|Glyph\b|\bicon\s*[:=]|\.tabIcon\b|\blabelIcon\b/;

function isTabsElement(node) {
    const name = node.openingElement.name;
    return name.type === 'JSXIdentifier' && name.name === 'Tabs';
}

function attr(opening, name) {
    return opening.attributes.find(
        (a) => a.type === 'JSXAttribute' && a.name && a.name.name === name,
    );
}

// The object literals that define tabs inside an items value: an array,
// possibly spread or conditional, whose elements are objects.
function collectTabObjects(node, out) {
    if (!node) return;
    if (node.type === 'ArrayExpression') {
        for (const el of node.elements) collectTabObjects(el, out);
    } else if (node.type === 'SpreadElement') {
        collectTabObjects(node.argument, out);
    } else if (node.type === 'ConditionalExpression') {
        collectTabObjects(node.consequent, out);
        collectTabObjects(node.alternate, out);
    } else if (node.type === 'LogicalExpression') {
        collectTabObjects(node.right, out);
    } else if (node.type === 'ObjectExpression') {
        out.push(node);
    }
}

function tabId(obj) {
    for (const prop of obj.properties) {
        if (prop.type !== 'ObjectProperty') continue;
        const key = prop.key.name || prop.key.value;
        if (key === 'id' && prop.value.type === 'StringLiteral') return prop.value.value;
    }
    return null;
}

/**
 * Scan one source file and return the tab-icon violations as strings.
 * @param {string} code
 * @param {string} file
 */
export function findTabIconViolations(code, file) {
    const violations = [];
    if (!/role=["']tab["']|<Tabs\b|(tabs|tabItems|sectionItems|detailTabs|subtabs)\s*=/.test(code)) return violations;
    const ast = parse(code, { sourceType: 'module', plugins: PARSER_PLUGINS });
    const slice = (node) => code.slice(node.start, node.end);
    const at = (node) => `${file}:${node.loc.start.line}`;
    const tabObjects = [];
    const seen = new Set();
    const addObjects = (node) => {
        const found = [];
        collectTabObjects(node, found);
        for (const obj of found) {
            if (!seen.has(obj)) {
                seen.add(obj);
                tabObjects.push(obj);
            }
        }
    };

    traverse(ast, {
        JSXElement(path) {
            const node = path.node;
            const opening = node.openingElement;
            const roleAttr = attr(opening, 'role');
            if (roleAttr && roleAttr.value && roleAttr.value.value === 'tab') {
                const text = slice(node);
                if (!/\bicon=|\.tabIcon\b|\{[\w.]*\bicon\}/.test(text)) {
                    violations.push(`${at(node)}: a role="tab" element renders no icon`);
                }
            }
            if (isTabsElement(node)) {
                const items = attr(opening, 'items');
                const expr = items && items.value && items.value.expression;
                if (!expr) return;
                if (expr.type === 'Identifier') {
                    const binding = path.scope.getBinding(expr.name);
                    const init = binding && binding.path.node.init;
                    addObjects(init);
                } else if (expr.type === 'ArrayExpression') {
                    addObjects(expr);
                } else if (!ICON_TEXT.test(slice(expr))) {
                    violations.push(`${at(expr)}: <Tabs items> is built without icons`);
                }
            }
        },
        VariableDeclarator(path) {
            const id = path.node.id;
            if (id.type === 'Identifier' && TAB_ARRAY_NAMES.test(id.name)) addObjects(path.node.init);
        },
    });

    for (const obj of tabObjects) {
        const text = slice(obj);
        const id = tabId(obj);
        if (!ICON_TEXT.test(text)) {
            violations.push(`${at(obj)}: tab "${id}" has no icon`);
            continue;
        }
        const expected = STANDARD_ICONS.get(id);
        if (expected && !new RegExp(`\\b${expected}\\b`).test(text)) {
            violations.push(`${at(obj)}: tab "${id}" must use ${expected}`);
        }
    }
    return violations;
}

describe('tab icons', () => {
    it('every tab carries an icon and Actions, Details and Activity use the standard ones', () => {
        const violations = [];
        let scanned = 0;
        for (const [key, code] of Object.entries(sources)) {
            const file = relPath(key);
            if (EXCEPTIONS.has(file)) continue;
            scanned += 1;
            violations.push(...findTabIconViolations(code, file));
        }
        expect(scanned).toBeGreaterThan(50);
        expect(violations).toEqual([]);
    });

    it('lists only exceptions that still hold a tab bar', () => {
        for (const file of EXCEPTIONS.keys()) {
            const entry = Object.entries(sources).find(([key]) => relPath(key) === file);
            expect(entry, `${file} no longer exists`).toBeTruthy();
            expect(/role=["']tab["']|<Tabs\b/.test(entry[1]), `${file} has no tab bar`).toBe(true);
        }
    });

    it('flags a tab bar without icons or with a non-standard icon', () => {
        const bare = `const tabs = [{ id: 'a', label: 'A' }];\nconst x = <Tabs items={tabs} />;`;
        expect(findTabIconViolations(bare, 'x.jsx')).toHaveLength(1);
        const wrong = `const tabItems = [{ id: 'actions', label: tabLabel(Icon.GearIcon, 'Actions') }];`;
        expect(findTabIconViolations(wrong, 'x.jsx')[0]).toMatch(/must use ZapIcon/);
        const wrongHistory = `const x = <Tabs items={[{ id: 'activity', label: tabLabel(Icon.LineChartIcon, 'Activity') }]} />;`;
        expect(findTabIconViolations(wrongHistory, 'x.jsx')[0]).toMatch(/must use HistoryIcon/);
        const rawTab = `const x = <button role="tab">Label</button>;`;
        expect(findTabIconViolations(rawTab, 'x.jsx')).toHaveLength(1);
        const good = `const tabs = [{ id: 'details', label: tabLabel(Icon.InfoIcon, 'Details') }];`;
        expect(findTabIconViolations(good, 'x.jsx')).toEqual([]);
    });
});
