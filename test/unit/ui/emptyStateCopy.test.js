// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { NO_CHAINS_BODY, NO_CHAINS_TITLE } from '../../../packages/core/src/shared/utils/chainAvailability.js';

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

function staticVariants(node) {
    if (!node) return [];
    if (node.type === 'JSXExpressionContainer') return staticVariants(node.expression);
    if (node.type === 'StringLiteral') return [node.value];
    if (node.type === 'TemplateLiteral') {
        return [node.quasis.map((part) => part.value.cooked).join('{value}')];
    }
    if (node.type === 'ConditionalExpression') {
        return [...staticVariants(node.consequent), ...staticVariants(node.alternate)];
    }
    if (node.type === 'JSXFragment') {
        return [node.children.map((child) => {
            if (child.type === 'JSXText') return child.value;
            if (child.type === 'JSXExpressionContainer') return '{value}';
            return '';
        }).join('').replace(/\s+/g, ' ').trim()];
    }
    return [];
}

function forwardedCopy() {
    const propNames = {
        EmptyState: { title: 'title', body: 'body' },
        BalanceList: { title: 'emptyTitle', body: 'emptyBody' },
        CollectiblesView: { title: 'emptyTitle', body: 'emptyBody' },
        ChainGroup: { title: 'emptyTitle', body: 'emptyText' },
    };
    const found = [];
    for (const file of sourceRoots.flatMap(sourceFiles)) {
        const source = readFileSync(file, 'utf8');
        const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
        visit(ast, (node) => {
            if (node.type !== 'JSXOpeningElement') return;
            const names = propNames[node.name?.name];
            if (!names) return;
            const attributes = Object.fromEntries(node.attributes
                .filter((attribute) => attribute.type === 'JSXAttribute')
                .map((attribute) => [attribute.name.name, attribute]));
            found.push({
                component: node.name.name,
                file,
                line: node.loc.start.line,
                titles: staticVariants(attributes[names.title]?.value),
                bodies: staticVariants(attributes[names.body]?.value),
            });
        });
    }
    return found;
}

function localeCopy() {
    return Object.entries(en)
        .filter(([key]) => key.includes('.empty.') || /^history\.recipients\.no(?:Holders|Recipients)(?:Found|Body)$/.test(key))
        .map(([key, value]) => ({
            file: 'English locale',
            line: key,
            titles: /(?:Title|Found)$/.test(key) ? [value] : [],
            bodies: /Body$/.test(key) ? [value] : [],
        }));
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

    it('keeps direct, forwarded, shared, and localized copy concise', () => {
        const failures = [];
        const copy = [
            ...forwardedCopy(),
            ...localeCopy(),
            {
                file: 'chainAvailability.js',
                line: 'NO_CHAINS',
                titles: [NO_CHAINS_TITLE],
                bodies: [NO_CHAINS_BODY],
            },
        ];
        for (const state of copy) {
            for (const title of state.titles) {
                if (title.trim().split(/\s+/).length > 6 || /[.!?]$/.test(title)) {
                    failures.push(`${state.file}:${state.line} has a long or sentence-style title: ${title}`);
                }
            }
            for (const body of state.bodies) {
                if ((body.match(/[.!?](?:\s|$)/g) || []).length !== 1) {
                    failures.push(`${state.file}:${state.line} does not have one body sentence: ${body}`);
                }
            }
        }
        expect(failures).toEqual([]);
    });

    it('does not repeat the absence at the start of an empty-state body', () => {
        const failures = forwardedCopy().flatMap((state) => state.bodies
            .filter((body) => state.component !== 'EmptyState' && /^No\s/i.test(body))
            .map((body) => `${state.file}:${state.line} starts its body with "No": ${body}`));
        expect(failures).toEqual([]);
    });

    it('uses the platform pattern for localized History empty states', () => {
        expect({
            noAddresses: en['history.empty.noAddressesBody'],
            noMatches: en['history.empty.noMatchesBody'],
            noCrossChain: en['history.empty.noCrossChainBody'],
            noActivity: en['history.empty.noActivityBody'],
        }).toEqual({
            noAddresses: 'History appears here after you generate an address and send or receive funds.',
            noMatches: 'Matching history appears here after you reset or change the filters.',
            noCrossChain: 'Cross-chain transfers appear here after you send or receive one.',
            noActivity: 'Activity appears here after you send or receive on a selected chain.',
        });
    });
});
