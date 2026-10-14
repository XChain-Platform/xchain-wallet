// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;
const sources = import.meta.glob(
    '../../../packages/core/src/shared/**/*.{js,jsx}',
    { query: '?raw', import: 'default', eager: true },
);

function hookCall(path, name) {
    const init = path.node.init;
    return init?.type === 'CallExpression'
        && init.callee.type === 'Identifier'
        && init.callee.name === name;
}

function functionalUpdateReadsState(setterBinding) {
    return setterBinding?.referencePaths.some((reference) => {
        const call = reference.parentPath;
        if (!call?.isCallExpression() || call.node.callee !== reference.node) return false;
        const updater = call.get('arguments.0');
        if (!updater?.isFunction()) return false;
        const parameter = updater.get('params.0');
        if (!parameter?.isIdentifier()) return false;
        return parameter.scope.getBinding(parameter.node.name)?.referenced === true;
    }) || false;
}

function isCurrentWrite(reference) {
    const member = reference.parentPath;
    if (!member?.isMemberExpression()) return false;
    if (member.node.object !== reference.node || member.node.computed) return false;
    if (member.node.property.type !== 'Identifier' || member.node.property.name !== 'current') return false;
    const assignment = member.parentPath;
    return assignment?.isAssignmentExpression()
        && assignment.node.left === member.node
        && assignment.node.operator === '=';
}

function deadHooks(source, file) {
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const failures = [];
    traverse(ast, {
        VariableDeclarator(path) {
            if (hookCall(path, 'useState') && path.node.id.type === 'ArrayPattern') {
                const [value, setter] = path.node.id.elements;
                if (value?.type !== 'Identifier' || setter?.type !== 'Identifier') return;
                const valueBinding = path.scope.getBinding(value.name);
                const setterBinding = path.scope.getBinding(setter.name);
                if (valueBinding?.referenced || functionalUpdateReadsState(setterBinding)) return;
                failures.push(`${file}:${path.node.loc.start.line} unread state ${value.name}`);
                return;
            }
            if (!hookCall(path, 'useRef') || path.node.id.type !== 'Identifier') return;
            const binding = path.scope.getBinding(path.node.id.name);
            if (binding?.referencePaths.some((reference) => !isCurrentWrite(reference))) return;
            failures.push(`${file}:${path.node.loc.start.line} unread ref ${path.node.id.name}`);
        },
    });
    return failures;
}

describe('shared hooks retain only observable state', () => {
    it('distinguishes dead hook storage from functional state reads', () => {
        const source = [
            'function Example() {',
            '    const [dead, setDead] = useState(false);',
            '    setDead(true);',
            '    const deadRef = useRef(null);',
            "    deadRef.current = 'value';",
            '    const [collector, setCollector] = useState({});',
            '    setCollector((previous) => ({ ...previous, next: true }));',
            '}',
        ].join('\n');

        expect(deadHooks(source, 'fixture.jsx')).toEqual([
            'fixture.jsx:2 unread state dead',
            'fixture.jsx:4 unread ref deadRef',
        ]);
    });

    it('has no unread state values or write-only refs', () => {
        const failures = Object.entries(sources).flatMap(([file, source]) => deadHooks(source, file));
        expect(failures).toEqual([]);
    });
});
