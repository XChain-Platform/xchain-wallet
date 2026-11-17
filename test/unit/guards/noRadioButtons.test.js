// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static guard for ruling G119, no radio buttons: a single choice among a few
// options is a labelled field that shows the current choice and opens the
// wallet's themed dropdown (IconSelect, or Select with options), with an icon
// per option. No route or component may render a RadioGroup, an
// `<input type="radio">` (ChoiceControl type="radio" included), or an element
// with role="radio" or role="radiogroup".
//
// The source is parsed, so comments and prose in JSX text never trip it; only
// a rendered element or attribute does. A control that keeps radio semantics
// by design is listed in EXCEPTIONS with the reason, and each listed file must
// still render one, so a stale entry is caught too.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob([
    '../../../packages/core/src/**/*.jsx',
    '../../../packages/extension/src/**/*.jsx',
    '../../../packages/web/src/**/*.jsx',
    '../../../packages/mobile/src/**/*.jsx',
    '../../../packages/desktop/**/*.jsx',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];

const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

// Files that may keep radio semantics, keyed by file. Each says why.
const EXCEPTIONS = new Map([
    ['packages/core/src/ui/SegmentedControl.jsx',
        'a tab-like view toggle (Grouped / Flat and kin) drawn as a segmented bar, not a form choice; role="radio" is its assistive-tech semantics, and the G119 ruling leaves it alone'],
    ['packages/core/src/shared/components/TileLookFields.jsx',
        'the wallet tile colour swatch picker, a grid of colour chips with role="radio" for assistive tech; the G119 ruling leaves it alone'],
    ['packages/core/src/ui/RadioGroup.jsx',
        'the retired kit primitive\'s own definition, still a barrel export until it is removed; this guard is what keeps every screen from rendering it'],
]);

const RADIO_ROLES = new Set(['radio', 'radiogroup']);

function elementName(name) {
    if (name.type === 'JSXIdentifier') return name.name;
    if (name.type === 'JSXMemberExpression') return name.property.name;
    return '';
}

// The literal text of an attribute value: "radio", {'radio'} or {`radio`}.
function literalValue(value) {
    if (!value) return null;
    if (value.type === 'StringLiteral') return value.value;
    if (value.type === 'JSXExpressionContainer') {
        const e = value.expression;
        if (e.type === 'StringLiteral') return e.value;
        if (e.type === 'TemplateLiteral' && e.expressions.length === 0) return e.quasis[0].value.cooked;
    }
    return null;
}

/** Every radio rendered in one source, as `line: what` strings. */
function radioUses(source) {
    const ast = parse(source, { sourceType: 'module', plugins: PARSER_PLUGINS });
    const found = [];
    traverse(ast, {
        JSXOpeningElement(path) {
            const { node } = path;
            const line = node.loc?.start.line;
            if (elementName(node.name) === 'RadioGroup') found.push(`${line}: <RadioGroup>`);
            for (const a of node.attributes) {
                if (a.type !== 'JSXAttribute' || !a.name) continue;
                const value = literalValue(a.value);
                if (a.name.name === 'type' && value === 'radio') found.push(`${line}: type="radio"`);
                if (a.name.name === 'role' && RADIO_ROLES.has(value)) found.push(`${line}: role="${value}"`);
            }
        },
    });
    return found;
}

describe('no radio buttons (G119)', () => {
    it('scans the wallet sources', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
    });

    it('finds every radio form in a sample', () => {
        expect(radioUses(`const a = (
            <div>
                <RadioGroup legend="x" />
                <UI.RadioGroup legend="y" />
                <input type="radio" />
                <ChoiceControl type={'radio'} />
                <span role="radiogroup"><b role={\`radio\`} /></span>
            </div>
        );`)).toHaveLength(6);
        // Prose and comments are not controls.
        expect(radioUses(`// <RadioGroup> type="radio"
            const b = <p>Never a <code>RadioGroup</code> or type="radio".</p>;`)).toEqual([]);
    });

    it('renders no RadioGroup, radio input or radio role on any screen', () => {
        const offenders = [];
        for (const [key, source] of Object.entries(sources)) {
            const file = relPath(key);
            if (EXCEPTIONS.has(file)) continue;
            for (const use of radioUses(source)) offenders.push(`${file}:${use}`);
        }
        expect(offenders, 'use IconSelect with an icon per option instead (G119)').toEqual([]);
    });

    it('keeps every exception live and explained', () => {
        for (const [file, reason] of EXCEPTIONS) {
            const key = Object.keys(sources).find((k) => relPath(k) === file);
            expect(key, `${file} is still in the tree`).toBeTruthy();
            expect(radioUses(sources[key]).length, `${file} still renders a radio, or drop its exception`).toBeGreaterThan(0);
            expect(reason.length, `${file} says why`).toBeGreaterThan(20);
        }
    });
});
