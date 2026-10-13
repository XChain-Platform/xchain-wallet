// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const sourceRoots = [
    resolve(process.cwd(), 'packages/core/src'),
    resolve(process.cwd(), 'packages/web/src'),
];

function sourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.[jt]sx$/.test(entry.name) ? [path] : [];
    });
}

function visit(node, callback) {
    if (!node || typeof node !== 'object') return;
    callback(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((item) => visit(item, callback));
        else if (value?.type) visit(value, callback);
    }
}

function emptyStates() {
    const found = [];
    for (const file of sourceRoots.flatMap(sourceFiles)) {
        const source = readFileSync(file, 'utf8');
        const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
        visit(ast, (node) => {
            if (node.type !== 'JSXOpeningElement' || node.name?.name !== 'EmptyState') return;
            const attributes = Object.fromEntries(node.attributes
                .filter((attribute) => attribute.type === 'JSXAttribute')
                .map((attribute) => [attribute.name.name, attribute]));
            found.push({ file, line: node.loc.start.line, attributes });
        });
    }
    return found;
}

function staticValue(attribute) {
    return attribute?.value?.type === 'StringLiteral' ? attribute.value.value : null;
}

describe('EmptyState copy', () => {
    it('gives every empty state a title and one body line', () => {
        const failures = [];
        for (const state of emptyStates()) {
            if (!state.attributes.title || !state.attributes.body) {
                failures.push(`${state.file}:${state.line} is missing title or body`);
                continue;
            }
            const title = staticValue(state.attributes.title);
            const body = staticValue(state.attributes.body);
            if (title && /[.!?]$/.test(title)) failures.push(`${state.file}:${state.line} has a sentence title`);
            if (body && (body.match(/[.!?](?:\s|$)/g) || []).length !== 1) {
                failures.push(`${state.file}:${state.line} does not have one body sentence`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('pairs action labels with handlers and excludes navigation-only actions', () => {
        const failures = [];
        for (const state of emptyStates()) {
            const hasLabel = Boolean(state.attributes.actionLabel);
            const hasHandler = Boolean(state.attributes.onAction);
            if (hasLabel !== hasHandler) failures.push(`${state.file}:${state.line} has an incomplete action`);
            if (/^(Back|Cancel|Close)$/.test(staticValue(state.attributes.actionLabel) || '')) {
                failures.push(`${state.file}:${state.line} has a navigation-only action`);
            }
        }
        expect(failures).toEqual([]);
    });
});
