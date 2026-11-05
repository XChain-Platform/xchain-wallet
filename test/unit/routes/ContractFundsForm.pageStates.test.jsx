// ContractFundsForm: every wrap() call lays out through a page template.
//
// wrap() is a bare Screen. The load error, the loading line and the
// broadcast result each reach the page through FormPage, like the form and
// review stages, and the token list through ListPage, so no state draws
// straight into the Screen content box. ResultScreen is a template of its
// own, so the queued and unsigned branches pass it as is.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '@babel/parser';
import { describe, it, expect } from 'vitest';

function routePath(fileName) {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src', 'shared', 'routes'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('packages/core/src/shared/routes not found above the cwd');
        dir = up;
    }
    return join(dir, 'packages', 'core', 'src', 'shared', 'routes', fileName);
}

function wrapCallRoots(fileName) {
    const tree = parse(readFileSync(routePath(fileName), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const roots = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression'
            && node.callee.type === 'Identifier'
            && node.callee.name === 'wrap'
        ) {
            const arg = node.arguments[0];
            const line = node.loc.start.line;
            if (arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier') {
                roots.push({ line, name: arg.openingElement.name.name });
            } else {
                roots.push({ line, name: arg?.type || 'none' });
            }
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(tree.program);
    return roots;
}

describe('ContractFundsForm: every wrap() call passes a page template', () => {
    it('roots the load error, loading line, results, picker, review and form in FormPage, ListPage or ResultScreen', () => {
        const roots = wrapCallRoots('ContractFundsForm.jsx');
        expect(roots.length).toBeGreaterThanOrEqual(8);
        const faults = roots
            .filter(({ name }) => !['FormPage', 'ListPage', 'ResultScreen'].includes(name))
            .map(({ line, name }) => `ContractFundsForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });
});
