// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';

const traverse = _traverse.default || _traverse;
const sources = import.meta.glob([
    '../../../packages/core/src/**/*.{js,jsx}',
    '../../../packages/extension/src/**/*.{js,jsx}',
    '!../../../packages/**/node_modules/**',
], { query: '?raw', import: 'default', eager: true });

const PARSER_PLUGINS = ['jsx', 'importAssertions', 'topLevelAwait', 'classProperties'];
const NOTICE_NAMES = new Set(['Notice', 'StatusMessage', 'FormNotice']);
const BOLD_NAMES = new Set(['strong', 'b']);
const relPath = (key) => key.replace(/^(\.\.\/)+/, '');

function elementName(node) {
    return node?.openingElement?.name?.type === 'JSXIdentifier'
        ? node.openingElement.name.name
        : '';
}

function firstRenderedChild(children) {
    return children.find((child) => {
        if (child.type === 'JSXText') return child.value.trim() !== '';
        if (child.type === 'JSXExpressionContainer') return child.expression.type !== 'JSXEmptyExpression';
        return true;
    });
}

function inlineTitleUses(source) {
    const ast = parse(source, { sourceType: 'module', plugins: PARSER_PLUGINS });
    const found = [];
    traverse(ast, {
        JSXElement(path) {
            const notice = path.node;
            if (!NOTICE_NAMES.has(elementName(notice))) return;
            let first = firstRenderedChild(notice.children);
            if (first?.type === 'JSXElement' && elementName(first) === 'p') {
                first = firstRenderedChild(first.children);
            }
            if (first?.type === 'JSXElement' && BOLD_NAMES.has(elementName(first))) {
                found.push(`${first.loc.start.line}: <${elementName(first)}>`);
            }
        },
    });
    return found;
}

describe('notice titles use the block title prop (G120)', () => {
    it('detects strong and b tags that open a notice body', () => {
        expect(inlineTitleUses(`const sample = <>
            <Notice><strong>Title</strong> Body</Notice>
            <StatusMessage><p><b>Title</b> Body</p></StatusMessage>
            <FormNotice title="Title">Body</FormNotice>
            <Notice>Body with <strong>mid-sentence emphasis</strong>.</Notice>
        </>;`)).toHaveLength(2);
    });

    it('finds no inline title in wallet notice bodies', () => {
        const offenders = [];
        for (const [key, source] of Object.entries(sources)) {
            for (const use of inlineTitleUses(source)) offenders.push(`${relPath(key)}:${use}`);
        }
        expect(offenders, 'move the bold lead-in to the notice title prop').toEqual([]);
    });
});
