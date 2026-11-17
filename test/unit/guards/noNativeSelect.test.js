// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static guard for the wallet's dropdown rule (G96, G119): a user-facing page
// or component never renders a native `<select>`. A choice is the themed
// dropdown (IconSelect, or Select with options) with an icon per option. The
// source is parsed, so comments and prose never trip it. The shared kit under
// packages/core/src/ui is the one place a dropdown is built, so it is skipped.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;

const sources = import.meta.glob([
    '../../../packages/core/src/**/*.jsx',
    '!../../../packages/core/src/ui/**',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];
const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

/** Every native select or React.createElement('select') in one source, as line numbers. */
function nativeSelects(source) {
    const ast = parse(source, { sourceType: 'module', plugins: PLUGINS });
    const found = [];
    traverse(ast, {
        JSXOpeningElement(path) {
            const { name } = path.node;
            if (name.type === 'JSXIdentifier' && name.name === 'select') found.push(path.node.loc.start.line);
        },
        CallExpression(path) {
            const [first] = path.node.arguments;
            const callee = path.node.callee;
            const isCreate = (callee.type === 'Identifier' && callee.name === 'createElement')
                || (callee.type === 'MemberExpression' && callee.property.name === 'createElement');
            if (isCreate && first?.type === 'StringLiteral' && first.value === 'select') found.push(path.node.loc.start.line);
        },
    });
    return found;
}

describe('no native select on a user page', () => {
    it('scans the wallet sources', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
    });

    it('finds a native select in a sample and ignores prose', () => {
        expect(nativeSelects('const a = <div><select><option>x</option></select></div>;')).toHaveLength(1);
        expect(nativeSelects("const b = React.createElement('select', null);")).toHaveLength(1);
        expect(nativeSelects('// <select>\nconst c = <p>A native <code>select</code> is out.</p>;')).toEqual([]);
    });

    it('renders no raw select in packages/core/src outside the kit', () => {
        const offenders = [];
        for (const [key, source] of Object.entries(sources)) {
            for (const line of nativeSelects(source)) offenders.push(`${relPath(key)}:${line}`);
        }
        expect(offenders, 'use IconSelect or Select with an icon per option instead').toEqual([]);
    });
});
