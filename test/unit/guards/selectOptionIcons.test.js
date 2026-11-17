// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static guard for the wallet's dropdown rule: every Select and IconSelect in
// the app's screens and components gives each option an icon. A native
// <option> child carries no icon, so a Select built from <option> fails; the
// choice is written <Select.Option icon={...}> instead. An `options` array
// (IconSelect, or Select with options=) must give every { value, label }
// object an `icon`. An options value the scan cannot follow into this file
// (a prop, an import) must be listed in UNRESOLVED with the reason it is safe,
// so a new hard-to-read list cannot slip past unchecked.

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob([
    '../../../packages/core/src/**/*.jsx',
    '!../../../packages/core/src/ui/**',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];
const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

// Options lists the scan cannot read, keyed `file :: options source`. Each
// value says where the icons are checked or why the list is safe.
const UNRESOLVED = new Map([
    ['packages/core/src/shared/routes/ListCreateForm.jsx :: options',
        'the Action field receives its options from the caller, and every caller builds them with an icon per action'],
]);

function nameOf(node) {
    if (!node) return '';
    if (node.type === 'JSXIdentifier') return node.name;
    if (node.type === 'JSXMemberExpression') return `${nameOf(node.object)}.${node.property.name}`;
    return '';
}

function hasAttr(opening, attr) {
    return opening.attributes.some((a) => a.type === 'JSXSpreadAttribute'
        || (a.type === 'JSXAttribute' && a.name.name === attr));
}

function keyName(prop) {
    if (prop.type !== 'ObjectProperty' && prop.type !== 'ObjectMethod') return null;
    if (prop.key.type === 'Identifier') return prop.key.name;
    if (prop.key.type === 'StringLiteral') return prop.key.value;
    return null;
}

// Every top-level binding and function-scope declaration by name, so an
// options value written as an identifier or a call can be followed in-file.
function declarations(ast) {
    const found = new Map();
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
            if (!found.has(node.id.name)) found.set(node.id.name, node.init);
        }
        if (node.type === 'FunctionDeclaration' && node.id) found.set(node.id.name, node);
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'start' || key === 'end') continue;
            visit(node[key]);
        }
    };
    visit(ast.program);
    return found;
}

// Collect the { value, ... } objects an options expression can produce.
function optionObjects(expr, decls, seen = new Set()) {
    const objects = [];
    let unresolved = false;
    const walk = (node, depth = 0) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach((n) => walk(n, depth)); return; }
        if (node.type === 'Identifier' || (node.type === 'CallExpression' && node.callee.type === 'Identifier')) {
            const name = node.type === 'Identifier' ? node.name : node.callee.name;
            if (decls.has(name)) {
                if (!seen.has(name)) { seen.add(name); walk(decls.get(name), depth + 1); }
            } else if (depth === 0 && node.name !== 'undefined') {
                // Only the options value itself must resolve; names inside an
                // option object (labels, icon components) are data.
                unresolved = true;
            }
            if (node.type === 'CallExpression') walk(node.arguments, depth + 1);
            return;
        }
        if (node.type === 'ObjectExpression') {
            const keys = node.properties.map(keyName);
            if (keys.includes('value') && (keys.includes('label') || keys.includes('sub'))) {
                objects.push(node);
                return;
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'start' || key === 'end') continue;
            walk(node[key], depth + 1);
        }
    };
    walk(expr);
    return { objects, unresolved };
}

function findViolations(file, code) {
    const ast = parse(code, { sourceType: 'module', plugins: PLUGINS });
    const decls = declarations(ast);
    const problems = [];
    const used = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (node.type === 'JSXElement') {
            const tag = nameOf(node.openingElement.name);
            if (tag === 'Select' || tag === 'IconSelect') {
                const line = node.loc.start.line;
                const optionsAttr = node.openingElement.attributes
                    .find((a) => a.type === 'JSXAttribute' && a.name.name === 'options');
                if (optionsAttr && optionsAttr.value?.type === 'JSXExpressionContainer') {
                    const { objects, unresolved } = optionObjects(optionsAttr.value.expression, decls);
                    const key = `${file} :: options`;
                    if (unresolved && UNRESOLVED.has(key)) used.push(key);
                    else if (unresolved) problems.push(`${file}:${line} ${tag} options cannot be followed; list it in UNRESOLVED`);
                    for (const o of objects) {
                        if (!o.properties.some((p) => p.type === 'SpreadElement' || keyName(p) === 'icon')) {
                            problems.push(`${file}:${o.loc.start.line} ${tag} option has no icon`);
                        }
                    }
                }
                const inner = (n) => {
                    if (!n || typeof n !== 'object') return;
                    if (Array.isArray(n)) { n.forEach(inner); return; }
                    if (n.type === 'JSXElement') {
                        const childTag = nameOf(n.openingElement.name);
                        if (childTag === 'option') {
                            problems.push(`${file}:${n.loc.start.line} native <option> inside ${tag} has no icon; use <Select.Option icon>`);
                        } else if (childTag === 'Select.Option' && !hasAttr(n.openingElement, 'icon')) {
                            problems.push(`${file}:${n.loc.start.line} Select.Option has no icon`);
                        }
                    }
                    for (const key of Object.keys(n)) {
                        if (key === 'loc' || key === 'start' || key === 'end') continue;
                        inner(n[key]);
                    }
                };
                inner(node.children);
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'start' || key === 'end') continue;
            visit(node[key]);
        }
    };
    visit(ast.program);
    return { problems, used };
}

describe('every Select and IconSelect option carries an icon', () => {
    const all = Object.entries(sources).map(([key, code]) => [relPath(key), code])
        .filter(([, code]) => /<(Icon)?Select\b/.test(code));

    it('scans the screens and components that render a dropdown', () => {
        expect(all.length).toBeGreaterThan(30);
    });

    it('finds no option without an icon', () => {
        const problems = [];
        const used = new Set();
        for (const [file, code] of all) {
            const r = findViolations(file, code);
            problems.push(...r.problems);
            r.used.forEach((u) => used.add(u));
        }
        expect(problems).toEqual([]);
        // An allowlist entry that no longer covers anything must go.
        expect([...UNRESOLVED.keys()].filter((k) => !used.has(k))).toEqual([]);
    });

    it('catches a native option and an icon-less object (the guard can fail)', () => {
        const bad = `
            const L = [{ value: 'a', label: 'A' }];
            export const X = () => (<><Select><option value="a">A</option></Select>
              <IconSelect options={L} /><Select><Select.Option value="a">A</Select.Option></Select></>);`;
        expect(findViolations('x.jsx', bad).problems).toHaveLength(3);
    });
});
