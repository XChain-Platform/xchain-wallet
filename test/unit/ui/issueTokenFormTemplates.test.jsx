// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// IssueTokenForm draws every state through a page template: the load error,
// the loading line, the result panels and the form reach Screen through the
// route's wrap() helper with a FormPage or ListPage as the content. Review
// uses the shared ConfirmActionModal, so no state puts bare content into Screen.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '@babel/parser';
import { describe, it, expect } from 'vitest';

function routePath() {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src', 'shared', 'routes'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('packages/core/src/shared/routes not found above the cwd');
        dir = up;
    }
    return join(dir, 'packages', 'core', 'src', 'shared', 'routes', 'IssueTokenForm.jsx');
}

// FormFrame (the Wallet Form Standard's frame) renders a FormPage.
const TEMPLATES = ['FormPage', 'FormFrame', 'ListPage'];

function walk(node, visit, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node, ancestors);
    const next = typeof node.type === 'string' ? [...ancestors, node] : ancestors;
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit, next));
        else if (value && typeof value === 'object') walk(value, visit, next);
    }
}

const jsxName = (element) => (element?.type === 'JSXElement' && element.openingElement.name.type === 'JSXIdentifier'
    ? element.openingElement.name.name
    : null);

describe('IssueTokenForm: every state renders through a page template', () => {
    const tree = parse(readFileSync(routePath(), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });

    const wrapCalls = [];
    const screens = [];
    walk(tree.program, (node, ancestors) => {
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
            wrapCalls.push(node);
        }
        if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && node.name.name === 'Screen') {
            screens.push({ node, ancestors });
        }
    });

    it('templates every wrap() path and uses ConfirmActionModal for review', () => {
        expect(wrapCalls.length).toBeGreaterThanOrEqual(6);
        expect(readFileSync(routePath(), 'utf8')).toContain('<ConfirmActionModal');
        const roots = wrapCalls.map((call) => `line ${call.loc.start.line}: ${jsxName(call.arguments[0]) ?? call.arguments[0]?.type}`);
        const bare = roots.filter((_, i) => !TEMPLATES.includes(jsxName(wrapCalls[i].arguments[0])));
        expect(bare, 'each wrap() argument is a FormPage or ListPage').toEqual([]);
    });

    it('draws Screen only inside the wrap helper', () => {
        expect(screens.length).toBe(1);
        const inWrap = screens[0].ancestors.some((ancestor) => ancestor.type === 'VariableDeclarator'
            && ancestor.id.type === 'Identifier'
            && ancestor.id.name === 'wrap');
        expect(inWrap).toBe(true);
    });
});
