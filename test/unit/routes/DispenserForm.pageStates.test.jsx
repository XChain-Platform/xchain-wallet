// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// DispenserForm's wrap() helper is a bare Screen. The load error, the loading
// line and the dispenser-opened panel reach the page through the ListPage each
// wrap() call passes, the review and form stages through FormPage, and the two
// ResultScreen states through the shared result screen, so no state draws
// straight into the Screen content box.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, it, expect } from 'vitest';

const source = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'DispenserForm.jsx',
);

function wrapRoots() {
    const tree = parse(readFileSync(source, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const roots = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
            const arg = node.arguments[0];
            const name = arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                ? arg.openingElement.name.name
                : (arg?.type || 'none');
            roots.push({ line: node.loc.start.line, name, arg });
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(tree.program);
    return roots;
}

const holds = (node, test) => {
    if (!node || typeof node !== 'object') return false;
    if (test(node)) return true;
    return Object.values(node).some((value) => (Array.isArray(value)
        ? value.some((item) => holds(item, test))
        : (value && typeof value === 'object' ? holds(value, test) : false)));
};

describe('DispenserForm: every wrap() call passes a page template', () => {
    it('roots each wrap() call in ListPage, FormPage or ResultScreen', () => {
        const roots = wrapRoots();
        expect(roots.length).toBeGreaterThanOrEqual(7);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage', 'ResultScreen'].includes(name))
            .map(({ line, name }) => `DispenserForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('keeps the load error, the loading line and the dispenser-opened panel inside ListPage', () => {
        const roots = wrapRoots();
        const rootsHolding = (test) => roots.filter(({ arg }) => holds(arg, test)).map(({ name }) => name);
        expect(rootsHolding((node) => node.type === 'Identifier' && node.name === 'loadError')).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Loading…'))).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Dispenser opened'))).toEqual(['ListPage']);
    });
});
